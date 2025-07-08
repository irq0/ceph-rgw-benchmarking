# Tools

## OpenStack
```
openstack project create rgw-sse-kms-test
openstack user create rgw --password rgw --domain default
openstack role add --project rgw-sse-kms-test --user rgw member
openstack role add --project rgw-sse-kms-test --user rgw admin
```

## Elbencho

```
elbencho --s3endpoints http://localhost:8000 --s3key asdf --s3secret h7GhxuBLTrlhVUyxSPUKUV8r/2EI4ngqJxD7iBdBYLhwluN30JaT3Q== \
--write --read \
--opslog elbencho/opslog.json --jsonfile elbencho/results.json \
--lathisto --latpercent --cpu --iodepth=16 --infloop --deldirs --delfiles --files 2048 \
--threads 4 --limitread=100 --limitwrite=100 --size 64k --dirs 1 \
rgw-sse-kms-test-7f3ec452-9044-4490-b777-d18a896cd580 rgw-sse-kms-test-53ae61ea-d7dd-453c-bd18-fb732de68076 rgw-sse-kms-test-651683bc-a91c-4e49-bf29-ac282e46e4e0 rgw-sse-kms-test-865a6963-6e69-482f-9b2c-d4f0f91ed34f rgw-sse-kms-test-1d5158f4-4de4-4ef4-ae3e-4b75db27d43e
```

## fio

```
S3_ACCESS_KEY=asdf S3_SECRET_KEY="h7GhxuBLTrlhVUyxSPUKUV8r/2EI4ngqJxD7iBdBYLhwluN30JaT3Q==" ~/WORKSPACE/fio/fio s3_breakpoint.fio
```


## RGW

vstart using OpenStack DevStack on 10.17.4.101

```
/compile2/ceph/wip/build/bin/radosgw -c /compile2/ceph/wip/build/ceph.conf --log-file=/compile2/ceph/wip/build/out/radosgw.8000.log --admin-socket=/compile2/ceph/wip/build/out/radosgw.8000.asok --pid-file=/compile2/ceph/wip/build/out/radosgw.8000.pid --rgw_luarocks_location=/compile2/ceph/wip/build/out/radosgw.8000.luarocks -n client.rgw.8000 '--rgw_frontends=beast port=8000' \
	--rgw_crypt_s3_kms_cache_enabled=true \
	--rgw_crypt_s3_kms_cache_max_size=5 \
	--rgw_crypt_s3_kms_cache_ttl=3600 \
	--rgw_crypt_s3_kms_backend=barbican \
	--rgw_keystone_url="http://10.17.4.101/identity/" \
	--rgw_barbican_url="http://10.17.4.101/key-manager/" \
	--rgw_keystone_barbican_user=rgw \
	--rgw_keystone_barbican_password=rgw \
	--rgw_keystone_barbican_project=rgw-sse-kms-test \
	--rgw_keystone_barbican_domain=Default \
	--rgw_crypt_require_ssl=false \
	-d --debug_rgw=5 \
	--log_to_graylog=true --err_to_graylog=true --log_graylog_host=localhost --log-graylog_port=12201
	--rgw_beast_enable_async=true &> last.log
```

## k6
Run mixed.js in GET mode. Write results to json, dashboard and prometheus remote write.

```
MODE=GET K6_PROMETHEUS_RW_TREND_STATS=p(95),p(99),min,max K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true OBJECTS=100000 k6 run \
	--out json=results-$(ts).json \
	--out experimental-prometheus-rw \
	--out web-dashboard \
	--tag testid=$(ts) mixed.js
```

# k6 Snippets

### seed buckets with random objects

```
const seedObjectsCreated = new Counter("seed_objects_created");

function seed(object_count, buckets) {
    console.log(`Warning: Seeding ${object_count} objects across ${buckets.length} buckets`);
    let requests = [];
    let keys = [];
    for (let i = 0; i < object_count; i++) {
        const bucket = buckets[i % buckets.length];
        const req = s3_put_random_request(bucket);
        keys.push({ bucket, key: req.key });
        requests.push(req.req);
    }
    const responses = http.batch(requests);
    responses.forEach((res, idx) => {
        if (!check(res, { "status is 200": (res) => res.status === 200 })) {
            fail(`seed obj PUT failed: ${res.status}`);
        }
        seedObjectsCreated.add(1);
    });
    return keys;
}

```

### S3 List

```
function s3_list_objects(bucket) {
  let query = { "list-type": "2", "max-keys": "1000" };
  let continuation = {};
  let objects = [];
  while (true) {
    const list_objects = s3_req("GET", `/${bucket}`, {}, query);
    if (
      !check(list_objects, { "status is 200": (res) => res.status === 200 })
    ) {
      fail(`Failed to list objects in bucket ${bucket}`);
    }
    const doc = parseHTML(list_objects.body).find("ListBucketResult");
    const page_objects = doc.children("Contents").map((_, el) => {
      const key = el.find("Key").contents().text();
      return { bucket, key };
    });
    objects.push(...page_objects);
    const truncated = doc.find("IsTruncated").contents().text() == "true";
    const next = doc.find("NextContinuationToken").contents().text();
    if (truncated) {
      query["continuation-token"] = next;
    } else {
      break;
    }
  }
  return objects;
}
```
