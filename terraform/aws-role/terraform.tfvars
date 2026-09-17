# Values for the ld-autofactory-cursor workstation role.
#
# gcp_azp / gcp_sub are the Instruqt participant node-pool service account
# (instruqt-participants-nodepool@participants-instruqt-prod.iam.gserviceaccount.com),
# the same identity the copilot-cleanup and ai-configs-intro roles trust. They
# are identifiers, not secrets. Re-check them by decoding a token on a
# workstation VM if Instruqt ever changes its node pool:
#   curl -sH "Metadata-Flavor: Google" \
#     "http://metadata/computeMetadata/v1/instance/service-accounts/default/identity?audience=x&format=full" \
#     | jq -R 'split(".") | .[1] | @base64d | fromjson | {azp, sub}'
#
# gcp_aud is this track's audience. It must match AUDIENCE in
# scripts/credentials.sh exactly, and it must differ from the other tracks'
# audiences so their tokens cannot assume this role.

account_id = "955116512041"
region     = "us-east-1"
role_name  = "InstruqtAutoFactoryCursorRole"
gcp_azp    = "105600785466274489511"
gcp_sub    = "105600785466274489511"
gcp_aud    = "instruqt-agentcontrol-cursor"
