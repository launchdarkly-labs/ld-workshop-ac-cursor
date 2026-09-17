#!/usr/bin/env python3
"""
Print the GitHub personal access token (PAT) for a pool user.

Usage:
    python3 -m pat current <username>

Mirrors lib/totp.py's shape: reads gh-copilot-workshop/<username>/pat
from Secrets Manager, returns just the token value on stdout.
"""

import json
import os
import re
import sys

import boto3

REGION = os.environ.get("AWS_REGION", "us-east-1")
SECRET_PREFIX = os.environ.get("POOL_SECRET_PREFIX", "gh-copilot-workshop")

# See note in pool.py: ARNs end with a `-XXXXXX` suffix that bare names don't.
_AWS_ARN_SUFFIX_RE = re.compile(r"-[A-Za-z0-9]{6}$")


def _resolve_secret(sm, secret_id: str) -> str:
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


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] != "current":
        sys.exit("usage: python3 -m pat current <username>")
    username = sys.argv[2]
    has_env_creds = all(
        os.environ.get(key) for key in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
    )
    if has_env_creds:
        session = boto3.Session(region_name=REGION)
    else:
        session = boto3.Session(region_name=REGION, profile_name="BasicProfile")
    sm = session.client("secretsmanager")
    print(_resolve_secret(sm, f"{SECRET_PREFIX}/{username}/pat"))


if __name__ == "__main__":
    main()
