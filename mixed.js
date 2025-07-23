import { parseHTML } from "k6/html";
import http from "k6/http";
import { check, fail } from "k6";
import {
  randomItem,
  tagWithCurrentStageIndex,
  tagWithCurrentStageProfile,
} from "https://jslib.k6.io/k6-utils/1.3.0/index.js";
import * as k6crypto from "k6/crypto";
import {
  AWSConfig,
  SignatureV4,
  Endpoint,
} from "https://jslib.k6.io/aws/0.13.0/signature.js";
import { Gauge, Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
const BUCKETS = (__ENV.BUCKETS || "k6-benchmark-bucket")
  .split(";")
  .filter((s) => s !== "");
const MODE = __ENV.MODE || "GET";
const OBJECTS_FILE = __ENV.OBJECTS || "objects.json";
const RESULTS_BUCKET = __ENV.RESULTS_BUCKET || false;
const OBJ_SIZE = parseInt(__ENV.OBJECT_SIZE) || 4 * 1024;
const VUS = parseInt(__ENV.VUS) || 500000;
const awsConfig = new AWSConfig({
  region: __ENV.AWS_REGION || "us-east-1",
  accessKeyId: __ENV.AWS_ACCESS_KEY || "asdfasdfasdfasdfasdf",
  secretAccessKey: __ENV.AWS_SECRET_KEY || "asdfasdfasdfasdfasdf",
});

const benchmarkBuckets = new Gauge("buckets");
const putObjectSize = new Gauge("put_object_size");
const httpServerErrors = new Counter("http_server_errors");
const httpCriticalErrors = new Counter("http_critical_errors");
const httpClientErrors = new Counter("http_client_errors");

function randomBytes(len) {
  return k6crypto.randomBytes(len);
}

const objects = new SharedArray("objects", function () {
  const result = JSON.parse(open(OBJECTS_FILE));
  console.log(`Object pool size: ${result.length}`);
  return result;
});

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
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: VUS,
      stages: [
        { duration: "30s", target: 100 }, // ramp up
        { duration: "3m", target: 100 },
        { duration: "30s", target: 250 }, // ramp up
        { duration: "3m", target: 250 },
        { duration: "30s", target: 500 }, // ramp up
        { duration: "3m", target: 500 },
        { duration: "30s", target: 750 }, // ramp up
        { duration: "3m", target: 750 },
        { duration: "30s", target: 1000 }, // ramp up
        { duration: "3m", target: 1000 },
        // { duration: "30s", target: 3000 }, // ramp up
        // { duration: "1m", target: 3000 },
        // { duration: "30s", target: 4000 }, // ramp up
        // { duration: "1m", target: 4000 },
        // { duration: "30s", target: 5000 }, // ramp up
        // { duration: "1m", target: 5000 },
        // { duration: "30s", target: 6000 }, // ramp up
        // { duration: "1m", target: 6000 },
        // { duration: "30s", target: 7000 }, // ramp up
        // { duration: "1m", target: 7000 },
        // { duration: "30s", target: 8000 }, // ramp up. limit: janelane
        // { duration: "1m", target: 8000 },
        // { duration: "30s", target: 9000 }, // ramp up
        // { duration: "1m", target: 9000 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.10"],
    http_req_duration: ["p(95)<100", "p(99)<1000"],
    http_client_errors: ["rate<0.01"],
    http_critical_errors: [
      {
        threshold: "count < 1",
        abortOnFail: false,
        delayAbortEval: "10s",
      },
    ],
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
  const res = http.request(req.method, req.url, body, req.params);
  check(res, {
    "status is 200": (res) => res.status === 200,
  });
  if (res.status >= 400 && res.status < 407) {
    httpCriticalErrors.add(1, { status: res.status });
  } else if (res.status >= 407 && res.status < 500) {
    httpClientErrors.add(1, { status: res.status });
  } else if (res.status >= 500 && res.status < 600) {
    httpServerErrors.add(1, { status: res.status });
  }
  return res;
}

function s3_put_random_request(bucket, buffer) {
  const key = "bench-" + crypto.randomUUID();
  const result = {
    key,
    req: create_s3_req(
      "PUT",
      `/${bucket}/${key}`,
      { "Content-Length": buffer.byteLength },
      {},
      buffer,
    ),
  };
  return result;
}

const buffer = randomBytes(OBJ_SIZE);

export function setup() {
  console.log("Access Key:", __ENV.AWS_ACCESS_KEY || "not set");
  console.log("Mode:", __ENV.MODE || "not set");
  const list_buckets = s3_req("GET", "/", {}, { "max-buckets": "1000" }, "");
  if (
    !check(list_buckets, {
      "status is 200": (res) => res.status === 200,
    })
  ) {
    fail("list bucket failed");
  }
  const buckets = parseHTML(list_buckets.body)
    .find("Buckets")
    .children()
    .map((_, el) => {
      return el.find("Name").contents().text();
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
  putObjectSize.add(buffer.byteLength);
}

export default function () {
  tagWithCurrentStageIndex();
  tagWithCurrentStageProfile();

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
    if (!buffer || buffer.byteLength < 10) {
      fail("data buffer empty?!");
    }
    const bucket = randomItem(BUCKETS);
    const req = s3_put_random_request(bucket, buffer);
    const res = http.put(req.req.url, buffer, req.req.params);
    if (res.status >= 400 && res.status < 407) {
      httpCriticalErrors.add(1, { status: res.status });
    } else if (res.status >= 407 && res.status < 500) {
      httpClientErrors.add(1, { status: res.status });
    } else if (res.status >= 500 && res.status < 600) {
      httpServerErrors.add(1, { status: res.status });
    }
    check(res, {
      "status is 200": (res) => res.status === 200,
    });
  }
}

export function handleSummary(data) {
  if (RESULTS_BUCKET) {
    const key = `result-${options.tags.testid}-${crypto.randomUUID()}.json`;
    const resp = s3_req(
      "PUT",
      `/${RESULTS_BUCKET}/${key}`,
      {},
      {},
      JSON.stringify(data),
    );
    if (resp.status != 200) {
      console.error("Could not send summary, got status " + resp.status);
    }
    console.log(`wrote results to ${RESULTS_BUCKET}/${key}`);
  }
}
