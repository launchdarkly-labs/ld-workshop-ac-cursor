# IAM role assumed by the Instruqt workstation VM through GCP -> AWS web-identity
# federation, for the ld-autofactory-cursor track.
#
# Modeled on ld-workshop-gh-copilot-cleanup/terraform/main.tf, which created the
# pool role for the copilot-cleanup track. Same trust shape, same three
# permission slices, different role name and audience so this track's tokens
# cannot assume the other track's role and vice versa.
#
# How it is used:
#   /opt/bin/credentials.sh on the VM (see scripts/credentials.sh) requests a
#   GCE identity token with audience var.gcp_aud, then calls
#   sts:AssumeRoleWithWebIdentity on this role. boto3 reaches that helper via
#   the `BasicProfile` profile's credential_process when no static AWS keys are
#   in the environment.
#
# What the workstation actually needs (image-requirements.md, "Pool and
# sweeper"): dynamodb:Query + UpdateItem on the shared pool table and its two
# GSIs, secretsmanager:GetSecretValue on gh-copilot-workshop/*, and
# secretsmanager:PutSecretValue on the refresh-token secrets because GitHub App
# refresh tokens are single-use and gh_auth.py persists the rotated one.
# Nothing else: no Bedrock (no local agents), no LaunchDarkly (that is an
# Instruqt secret, not AWS).
#
# Apply:
#   cd terraform/aws-role && terraform init && terraform apply
# Then confirm `terraform output role_arn` matches ROLE_ARN in
# scripts/credentials.sh.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# ---------- Variables ----------

variable "account_id" {
  description = "AWS account ID where the role, pool table, and secrets live"
  type        = string
}

variable "region" {
  description = "Region of the pool table and secrets (the pool client defaults to us-east-1)"
  type        = string
  default     = "us-east-1"
}

variable "role_name" {
  description = "Name of the IAM role the workstation assumes"
  type        = string
  default     = "InstruqtAutoFactoryCursorRole"
}

variable "gcp_azp" {
  description = "The azp (authorized party) claim from the GCP service account JWT. Maps to accounts.google.com:aud."
  type        = string
}

variable "gcp_aud" {
  description = "The aud (audience) claim from the GCP JWT: the audience string credentials.sh requests. Maps to accounts.google.com:oaud."
  type        = string
}

variable "gcp_sub" {
  description = "The sub (subject) claim from the GCP service account JWT: the numeric service account ID. Maps to accounts.google.com:sub."
  type        = string
}

variable "pool_table_name" {
  description = "DynamoDB table shared with the copilot-cleanup track. Must be the SAME table so two tracks never hand out the same GitHub account."
  type        = string
  default     = "gh-copilot-workshop-users"
}

variable "secret_prefix" {
  description = "Secrets Manager name prefix for pool secrets (password, pat, refresh-token, totp-seed, app/client-id, app/client-secret)"
  type        = string
  default     = "gh-copilot-workshop"
}

# ---------- Role with trust policy ----------

data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = ["accounts.google.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "accounts.google.com:aud"
      values   = [var.gcp_azp]
    }

    condition {
      test     = "StringEquals"
      variable = "accounts.google.com:oaud"
      values   = [var.gcp_aud]
    }

    condition {
      test     = "StringEquals"
      variable = "accounts.google.com:sub"
      values   = [var.gcp_sub]
    }
  }
}

resource "aws_iam_role" "workstation" {
  name                 = var.role_name
  description          = "Instruqt ld-autofactory-cursor workstation: GitHub account pool checkout via GCP web-identity federation"
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600

  tags = {
    track   = "ld-autofactory-cursor"
    purpose = "instruqt-workstation-pool-access"
  }
}

# ---------- Pool runtime (DynamoDB + Secrets Manager) ----------

data "aws_iam_policy_document" "pool_runtime" {
  statement {
    sid    = "PoolCheckout"
    effect = "Allow"
    actions = [
      "dynamodb:Query",
      "dynamodb:UpdateItem",
    ]
    resources = [
      "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.pool_table_name}",
      "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.pool_table_name}/index/*",
    ]
  }

  statement {
    sid    = "ReadPoolSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [
      "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:${var.secret_prefix}/*",
    ]
  }

  statement {
    sid    = "RotateRefreshTokens"
    effect = "Allow"
    actions = [
      "secretsmanager:PutSecretValue",
    ]
    resources = [
      "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:${var.secret_prefix}/*/refresh-token-*",
    ]
  }
}

resource "aws_iam_role_policy" "pool_runtime" {
  name   = "PoolRuntimeAccess"
  role   = aws_iam_role.workstation.id
  policy = data.aws_iam_policy_document.pool_runtime.json
}

# ---------- Outputs ----------

output "role_arn" {
  description = "ARN to plug into ROLE_ARN in scripts/credentials.sh"
  value       = aws_iam_role.workstation.arn
}

output "audience" {
  description = "Audience string credentials.sh must request; must match the oaud trust condition"
  value       = var.gcp_aud
}
