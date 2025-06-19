# Preparation

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
