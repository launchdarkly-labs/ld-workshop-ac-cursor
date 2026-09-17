#!/usr/bin/env python3
"""
Atomic checkout / release of GitHub workshop accounts from the DynamoDB pool.

Invoked from track_scripts/setup-workstation and track_scripts/cleanup-workstation.

Env:
  _SANDBOX_ID              required, set by Instruqt
  AWS_REGION               default us-east-2
  POOL_TABLE_NAME          default gh-copilot-workshop-users
  POOL_LOCK_TTL_SECS       default 7200 (matches track.yml timelimit)

Stdout (checkout):
  JSON: {"username": "...", "password": "..."}

Stdout (release):
  no output on success
"""

import json
import os
import random
import re
import sys
import time

import boto3
from botocore.exceptions import ClientError

import gh_auth

REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE = os.environ.get("POOL_TABLE_NAME", "gh-copilot-workshop-users")
LOCK_TTL = int(os.environ.get("POOL_LOCK_TTL_SECS", "7200"))

# Secrets Manager appends "-XXXXXX" (6 random alphanum) to the resource part
# of every ARN, but not to bare names. _resolve_secret needs to handle both
# so it can be called with either a name or a full ARN.
_AWS_ARN_SUFFIX_RE = re.compile(r"-[A-Za-z0-9]{6}$")


def _resolve_secret(sm, secret_id: str) -> str:
    """Plain or key/value (JSON) — extract value whose key matches the last
    path segment, with AWS's ARN suffix stripped if necessary."""
    raw = sm.get_secret_value(SecretId=secret_id)["SecretString"]
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return raw
    if isinstance(parsed, dict):
        last = secret_id.rstrip("/").split("/")[-1]
        for candidate in (last, _AWS_ARN_SUFFIX_RE.sub("", last)):
            if candidate in parsed:
                return parsed[candidate]
    return raw


def _sandbox_id() -> str:
    sid = os.environ.get("_SANDBOX_ID") or os.environ.get("INSTRUQT_SANDBOX_ID")
    if not sid:
        _die("_SANDBOX_ID is not set in env")
    return sid


def _die(msg: str) -> None:
    print(f"pool: {msg}", file=sys.stderr)
    sys.exit(1)


def checkout(ddb, sm) -> None:
    sandbox = _sandbox_id()
    resp = ddb.query(
        TableName=TABLE,
        IndexName="status-index",
        KeyConditionExpression="#s = :avail",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":avail": {"S": "available"}},
        Limit=12,
    )
    candidates = resp.get("Items", [])
    if not candidates:
        _die("no available users in pool")
    random.shuffle(candidates)

    now = int(time.time())
    expires = now + LOCK_TTL

    for item in candidates:
        username = item["username"]["S"]
        try:
            ddb.update_item(
                TableName=TABLE,
                Key={"username": {"S": username}},
                UpdateExpression=(
                    "SET #s = :checked, sandbox_id = :sid, "
                    "checked_out_at = :now, expires_at = :exp"
                ),
                ConditionExpression="#s = :avail",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={
                    ":checked": {"S": "checked_out"},
                    ":sid": {"S": sandbox},
                    ":now": {"N": str(now)},
                    ":exp": {"N": str(expires)},
                    ":avail": {"S": "available"},
                },
            )
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                continue
            raise

        password_ref = item.get("password_ref", {}).get("S")
        if not password_ref:
            _die(f"row for {username} has no password_ref")
        password = _resolve_secret(sm, password_ref)

        # Refresh the GitHub App user-access token while we hold the lock.
        # If this fails the lock is useless — release it before bailing,
        # regardless of failure type (SystemExit from known errors, boto
        # exceptions from missing secrets, network errors, etc.).
        try:
            github_token = gh_auth.refresh(username)
        except BaseException:
            release_owned(ddb, username)
            raise

        json.dump(
            {"username": username, "password": password, "github_token": github_token},
            sys.stdout,
        )
        sys.stdout.write("\n")
        return

    _die("pool exhausted by concurrent checkouts; raise pool size or retry")


def release_owned(ddb, username: str) -> None:
    """Release a specific row we know we hold. Used to roll back a failed checkout."""
    sandbox = _sandbox_id()
    try:
        ddb.update_item(
            TableName=TABLE,
            Key={"username": {"S": username}},
            UpdateExpression=(
                "SET #s = :avail "
                "REMOVE sandbox_id, checked_out_at, expires_at"
            ),
            ConditionExpression="sandbox_id = :sid",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":avail": {"S": "available"},
                ":sid": {"S": sandbox},
            },
        )
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise


def release(ddb) -> None:
    sandbox = _sandbox_id()
    resp = ddb.query(
        TableName=TABLE,
        IndexName="sandbox-index",
        KeyConditionExpression="sandbox_id = :sid",
        ExpressionAttributeValues={":sid": {"S": sandbox}},
    )
    for item in resp.get("Items", []):
        release_owned(ddb, item["username"]["S"])


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"checkout", "release"}:
        _die("usage: pool.py {checkout|release}")
    has_env_creds = all(
        os.environ.get(key) for key in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
    )
    if has_env_creds:
        session = boto3.Session(region_name=REGION)
    else:
        session = boto3.Session(region_name=REGION, profile_name="BasicProfile")
    ddb = session.client("dynamodb")
    if sys.argv[1] == "checkout":
        sm = session.client("secretsmanager")
        checkout(ddb, sm)
    else:
        release(ddb)


if __name__ == "__main__":
    main()
