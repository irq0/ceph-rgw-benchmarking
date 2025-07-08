import { parseHTML } from "k6/html";
import http from "k6/http";
import { check, fail } from "k6";
import { randomItem } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import * as k6crypto from "k6/crypto";
import {
  AWSConfig,
  SignatureV4,
  Endpoint,
} from "https://jslib.k6.io/aws/0.13.0/signature.js";
import { Gauge } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
const BUCKETS = (__ENV.BUCKETS || "k6-benchmark-bucket")
  .split(";")
  .filter((s) => s !== "");
const MODE = __ENV.MODE || "GET";
const OBJECTS_FILE = __ENV.OBJECTS || "objects.json";
const awsConfig = new AWSConfig({
  region: __ENV.AWS_REGION || "us-east-1",
  accessKeyId: __ENV.ACCESS_KEY || "test",
  secretAccessKey: __ENV.SECRET_KEY || "test",
});

const initialObjects = new Gauge("initial_objects");
const benchmarkBuckets = new Gauge("buckets");

function randomBytes(len) {
  return k6crypto.randomBytes(len);
}

const RANDOM_BUFFER = randomBytes(64 * 1024);

const signature = new SignatureV4({
  service: "s3",
  region: awsConfig.region,
  credentials: {
    accessKeyId: awsConfig.accessKeyId,
    secretAccessKey: awsConfig.secretAccessKey,
  },
  uriEscapePath: false,
  applyChecksum: true,
});

export const options = {
  scenarios: {
    load_test: {
      executor: "ramping-arrival-rate",
      startRate: 100,
      timeUnit: "1s",
      preAllocatedVUs: 10000,
      stages: [
        { duration: "30s", target: 1000 }, // ramp up
        { duration: "1m", target: 1000 },
        { duration: "30s", target: 2000 }, // ramp up
        { duration: "1m", target: 2000 },
        { duration: "30s", target: 3000 }, // ramp up
        { duration: "1m", target: 3000 },
        { duration: "30s", target: 4000 }, // ramp up
        { duration: "1m", target: 4000 },
        { duration: "30s", target: 5000 }, // ramp up
        { duration: "1m", target: 5000 },
        { duration: "30s", target: 6000 }, // ramp up
        { duration: "1m", target: 6000 },
        { duration: "30s", target: 7000 }, // ramp up
        { duration: "1m", target: 7000 },
        { duration: "30s", target: 8000 }, // ramp up. limit: janelane
        { duration: "1m", target: 8000 },
        { duration: "30s", target: 9000 }, // ramp up
        { duration: "1m", target: 9000 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
  },
  batch: 100,
  batchPerHost: 100,
  setupTimeout: "600m",
  summaryTrendStats: [
    "avg",
    "min",
    "med",
    "max",
    "p(90)",
    "p(95)",
    "p(99)",
    "p(99.9)",
    "count",
  ],
  summaryTimeUnit: "ms",
};

function create_s3_req(method, path, headers, query = {}, body = null) {
  const signed = signature.sign(
    {
      method,
      endpoint: new Endpoint(BASE_URL),
      path,
      headers,
      query,
      body,
    },
    {},
  );
  return {
    method: signed.method,
    url: signed.url,
    params: { headers: signed.headers },
  };
}

function s3_req(method, path, headers, query = {}, body = null) {
  const req = create_s3_req(method, path, headers, query, body);
  return http.request(req.method, req.url, body, req.params);
}

function s3_put_random_request(bucket) {
  const key = "seed-" + crypto.randomUUID();
  const result = {
    key,
    req: create_s3_req("PUT", `/${bucket}/${key}`, {}, RANDOM_BUFFER),
  };
  return result;
}

const objects = new SharedArray("some name", function () {
  const f = JSON.parse(open(OBJECTS_FILE));
  return f;
});

export function setup() {
  const list_buckets = s3_req("GET", "/", {});
  const buckets = parseHTML(list_buckets.body)
    .find("Buckets")
    .children()
    .map((_, el) => {
      return el.find("Name").contents().text();
    });
  check(list_buckets, {
    "status is 200": (res) => res.status === 200,
  });
  BUCKETS.forEach((bucket) => {
    if (
      !check(buckets, {
        "benchmark bucket exists": (res) => res.includes(bucket),
      })
    ) {
      fail(`benchmark bucket ${bucket} does not exists`);
    }
  });
  benchmarkBuckets.add(BUCKETS.length);
  initialObjects.add(objects.length);
}

export default function () {
  if (MODE == "GET") {
    if (objects.length === 0) {
      fail("No objects available for GET requests.");
    }
    const item = randomItem(objects);
    const res = s3_req("GET", `/${item[0]}/${item[1]}`, {});
    check(res, {
      "status is 200": (res) => res.status === 200,
    });
  } else if (MODE == "PUT") {
    const resp = http.request("PUT", req.req.url, req.req.body, req.req.params);
    const bucket = randomItem(BUCKETS);
    const req = s3_put_random_request(bucket);
    check(resp, {
      "status is 200": (res) => res.status === 200,
    });
  }
}
