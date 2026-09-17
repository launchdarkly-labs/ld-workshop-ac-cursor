#!/usr/bin/env python3
"""
Exchange a stored GitHub App refresh token for a short-lived access token,
rotate the refresh token back into Secrets Manager.

Refresh tokens are single-use; on every successful refresh GitHub returns a
new refresh token that supersedes the old one. We persist the new one before
returning so we don't lose access if the caller crashes.
"""

import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request

import boto3

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl.create_default_context()

REGION = os.environ.get("AWS_REGION", "us-east-1")
SECRET_PREFIX = os.environ.get("POOL_SECRET_PREFIX", "gh-copilot-workshop")
TOKEN_URL = "https://github.com/login/oauth/access_token"

has_env_creds = all(
    os.environ.get(key) for key in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
)
if has_env_creds:
    session = boto3.Session(region_name=REGION)
else:
    session = boto3.Session(region_name=REGION, profile_name="BasicProfile")
_sm = session.client("secretsmanager")

# See note in pool.py: ARNs end with a `-XXXXXX` suffix that bare names don't.
_AWS_ARN_SUFFIX_RE = re.compile(r"-[A-Za-z0-9]{6}$")


def _resolve(secret_id: str) -> str:
    """Plain or key/value (JSON) — extract value whose key matches the last
    path segment, with AWS's ARN suffix stripped if necessary."""
    raw = _sm.get_secret_value(SecretId=secret_id)["SecretString"]
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


def refresh(username: str) -> str:
    refresh_secret_id = f"{SECRET_PREFIX}/{username}/refresh-token"
    refresh_token = _resolve(refresh_secret_id)
    client_id = _resolve(f"{SECRET_PREFIX}/app/client-id")
    client_secret = _resolve(f"{SECRET_PREFIX}/app/client-secret")

    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={"Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, context=_SSL_CTX) as resp:
        body = json.loads(resp.read())

    if "error" in body:
        # When the stored refresh token is dead (expired, revoked, or already
        # consumed by another caller), the operator needs to rerun consent.py
        # for this user. Fail loudly with that signal rather than silently
        # returning nothing.
        sys.exit(
            f"gh_auth: refresh failed for {username}: {body.get('error')}: "
            f"{body.get('error_description', '')}. "
            f"Re-run infra/gh_app/consent.py {username}."
        )

    new_refresh = body.get("refresh_token")
    access = body.get("access_token")
    if not new_refresh or not access:
        sys.exit(f"gh_auth: unexpected token response: {body}")

    # Persist the rotated refresh token BEFORE returning the access token.
    # Match the key/value convention used by consent.py so the resolver
    # extracts cleanly on the next run.
    _sm.put_secret_value(
        SecretId=refresh_secret_id,
        SecretString=json.dumps({"refresh-token": new_refresh}),
    )
    return access


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] != "refresh":
        sys.exit("usage: gh_auth.py refresh <username>")
    print(refresh(sys.argv[2]))


if __name__ == "__main__":
    main()
