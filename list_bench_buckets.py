#!/usr/bin/env python3
import sys
import os
import boto3
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

S3_BASEURL = os.getenv("S3_BASEURL") or "http://localhost:8000"
S3_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY")
S3_SECRET_KEY = os.getenv("AWS_SECRET_KEY")
LIMIT = int(os.getenv("S3_LIST_LIMIT") or 2000000)


def list_bucket_objects(s3_client, bucket_name):
    bucket = s3_client.Bucket(bucket_name)
    objects = (obj.key for obj in bucket.objects.limit(LIMIT))
    return [(bucket_name, obj) for obj in objects]


def main():
    if len(sys.argv) != 2 or not sys.argv[1]:
        print('Usage: ./script.py "bucket1;bucket2;bucket3"', file=sys.stderr)
        sys.exit(1)

    buckets = [bucket for bucket in sys.argv[1].split(";") if bucket]

    s3 = boto3.resource(
        "s3",
        endpoint_url=S3_BASEURL,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
    )

    results = []
    with ThreadPoolExecutor(max_workers=len(buckets)) as executor:
        future_to_bucket = {
            executor.submit(list_bucket_objects, s3, bucket): bucket
            for bucket in buckets
        }
        for future in as_completed(future_to_bucket):
            results.extend(future.result())

    print(json.dumps(results))


if __name__ == "__main__":
    main()
