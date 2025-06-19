#!/usr/bin/env python3

import os
import random
import sys
import boto3
import uuid
import re
import concurrent.futures
from keystoneclient.auth import identity
from keystoneauth1 import session
from barbicanclient import client

S3_BASEURL = os.getenv("S3_BASEURL") or "http://localhost:8000"
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY")
SECRET_PREFIX = "rgw-sse-kms-test"
BUCKET_PREFIX = "rgw-sse-kms-test"
OPENSTACK_BASEURL_ID = (
    os.getenv("OPENSTACK_BASE_URL") or "http://10.17.4.101/identity/v3"
)
AUTH_USERNAME = os.getenv("AUTH_USERNAME") or "rgw"
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD") or "rgw"
AUTH_PROJECT = os.getenv("AUTH_PROJECT") or "rgw-sse-kms-test"
CONCURRENCY = int(os.getenv("CONCURRENCY") or 5)


def random_name():
    return str(uuid.uuid4())


def create_barbican_client() -> client:
    auth = identity.v3.Password(
        auth_url=OPENSTACK_BASEURL_ID,
        username=AUTH_USERNAME,
        user_domain_name="Default",
        password=AUTH_PASSWORD,
        project_name=AUTH_PROJECT,
        project_domain_name="Default",
    )
    sess = session.Session(auth=auth)
    barbican = client.Client(session=sess)
    return barbican


def create_random_secret(barbican: client):
    secret = barbican.secrets.create(
        name=f"{SECRET_PREFIX}_{random_name()}", payload=random.randbytes(256 // 8)
    )
    secret.store()
    key_id = re.findall(r"v1/secrets/([0-9a-fA-F-]+)$", secret.secret_ref)
    return key_id[0]


def create_bucket_with_sse(s3, key_id):
    name = f"{BUCKET_PREFIX}-{random_name()}"
    s3.create_bucket(Bucket=name)
    cfg = {
        "Rules": [
            {
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "aws:kms",
                    "KMSMasterKeyID": key_id,
                },
                "BucketKeyEnabled": True,
            }
        ]
    }
    s3.put_bucket_encryption(Bucket=name, ServerSideEncryptionConfiguration=cfg)
    return name


def create_bucket_and_secret():
    barbican = create_barbican_client()
    s3 = boto3.client(
        "s3",
        endpoint_url=S3_BASEURL,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
    )

    sec = create_random_secret(barbican)
    bucket = create_bucket_with_sse(s3, sec)
    return bucket


def main():
    if len(sys.argv) == 2:
        n_buckets = int(sys.argv[1])
    else:
        n_buckets = 1

    buckets = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = [executor.submit(create_bucket_and_secret) for _ in range(n_buckets)]
        for future in concurrent.futures.as_completed(futures):
            buckets.append(future.result())

    print("\n".join(buckets))


if __name__ == "__main__":
    main()
