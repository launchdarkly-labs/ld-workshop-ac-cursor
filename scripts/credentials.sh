#!/bin/bash
#
# AWS credential_process helper for the Instruqt workstation VM.
# Installed at /opt/bin/credentials.sh by scripts/build_script.sh and referenced
# from /root/.aws/config:
#
#   [profile BasicProfile]
#   credential_process = /opt/bin/credentials.sh
#
# The pool client (pool.py, gh_auth.py, pat.py, totp.py) opens BasicProfile
# whenever AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are absent from the
# environment. This script turns the VM's GCP identity into short-lived AWS
# credentials:
#
#   1. ask the GCE metadata server for an OIDC identity token for AUDIENCE
#   2. exchange it with sts:AssumeRoleWithWebIdentity for ROLE_ARN
#   3. print the credentials in the credential_process JSON contract
#
# The role's trust policy (terraform/aws-role) pins accounts.google.com:oaud to
# AUDIENCE, so AUDIENCE here and gcp_aud there must match exactly.
#
# Contract: stdout is EXACTLY one JSON object, nothing else. Any diagnostic
# goes to stderr, otherwise boto3 fails with a JSONDecodeError. Requires
# curl, jq, and the AWS CLI on PATH.

set -euo pipefail

AUDIENCE="instruqt-agentcontrol-cursor"
ROLE_ARN="arn:aws:iam::955116512041:role/InstruqtAutoFactoryCursorRole"
METADATA_URL="http://metadata/computeMetadata/v1/instance/service-accounts/default/identity"

die() { echo "credentials.sh: $*" >&2; exit 1; }

for tool in curl jq aws; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed"
done

jwt_token="$(curl -fsS -H "Metadata-Flavor: Google" \
  "${METADATA_URL}?audience=${AUDIENCE}&format=full&licenses=FALSE")" \
  || die "could not fetch a GCE identity token (not on a GCE VM, or metadata server unreachable)"

# Session name = the token's sub claim (the service account's numeric id).
jwt_sub="$(printf '%s' "$jwt_token" | jq -R 'split(".") | .[1] | @base64d | fromjson | .sub' -r)" \
  || die "could not decode the identity token"
[ -n "$jwt_sub" ] && [ "$jwt_sub" != "null" ] || die "identity token has no sub claim"

credentials="$(aws sts assume-role-with-web-identity \
  --role-arn "$ROLE_ARN" \
  --role-session-name "$jwt_sub" \
  --web-identity-token "$jwt_token" \
  --duration-seconds 3600 \
  --output json)" \
  || die "sts:AssumeRoleWithWebIdentity failed for ${ROLE_ARN} (check the role's trust policy accepts audience ${AUDIENCE})"

printf '%s' "$credentials" | jq -c '.Credentials | .Version = 1'
