#!/bin/bash
#
# Instruqt VM image build script — `launchdarkly/workshop-autofactory-cursor`.
#
# Implements image-requirements.md for the ld-autofactory-cursor track. Based on
# image/install.sh (the ai-configs-intro build) but with a different shape: this
# image runs NO agents. It opens a pull request, watches what Cursor's cloud
# automation sends back, and renders it. So: no Anthropic key, no Cursor key,
# no @cursor/sdk, no Bedrock, no code-server, no ToggleWear.
#
# Workflow:
#   1. In the Instruqt web console, start a VM from `launchdarkly/image-pov-python-v2`
#      (the copilot-cleanup image). That base already carries the three
#      load-bearing pieces: /opt/ld/util (pool client), /opt/ld/terraform-ld-student,
#      and python3 + boto3 + jq. This script verifies each and only rebuilds a
#      piece if it is missing, so it also works on a fresh Ubuntu LTS base as
#      long as POOL_LIB_REPO_URL / TF_STUDENT_REPO_URL are reachable.
#   2. Edit the variables below (at minimum confirm TRACK_REPO_REF).
#   3. Paste this entire script into the terminal as root (or run with sudo).
#   4. When it finishes, save the running VM as `launchdarkly/workshop-autofactory-cursor`.
#
# Idempotent: re-running refreshes the AutoFactory checkout and the game, leaves
# already-enabled services alone, and never touches the pool lib or the student
# Terraform if they are already present.
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Edit these before pasting:
# ---------------------------------------------------------------------------
# This track repo: game/ is copied to /opt/ld/factory-floor.
TRACK_REPO_URL="https://github.com/launchdarkly-labs/ld-workshop-ac-cursor.git"
TRACK_REPO_REF="main"

# AutoFactory tooling: checked out to /opt/ld/auto-factory, `npm ci` at bake time.
# Track setup runs `npm run bridge -- provision` from here.
AUTOFACTORY_REPO_URL="https://github.com/launchdarkly-labs/launchdarkly-auto-factory.git"
AUTOFACTORY_REF="main"

# Only used when the base image is NOT image-pov-python-v2 and these are missing.
POOL_LIB_REPO_URL="https://github.com/launchdarkly-labs/ld-workshop-gh-copilot-cleanup.git"   # lib/ -> /opt/ld/util
TF_STUDENT_REPO_URL="https://github.com/kevincloud/terraform-ld-student.git"                    # -> /opt/ld/terraform-ld-student

# AutoFactory declares engines.node >= 20 and pins .nvmrc to 20. 22.x is the
# current LTS line and satisfies it. Node 24 is NOT needed (that belongs to the
# GitHub Action's cursor provider path, which this track does not use).
NODE_VERSION="22.x"
TERRAFORM_VERSION="1.16.3"

# Pristine-tag smoke test targets (warn-only).
APP_REPO_ORG="launchdarkly-training"
APP_REPO_COUNT=12
# ---------------------------------------------------------------------------

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[warn] %s\033[0m\n' "$*"; }

export DEBIAN_FRONTEND=noninteractive
export GIT_TERMINAL_PROMPT=0

say "Updating apt"
apt-get -y update

say "Installing apt packages (system tools + python3)"
apt-get -y install \
    software-properties-common \
    unzip jq git curl wget gnupg ca-certificates lsb-release vim \
    python3 python3-venv python3-dev python3-pip

# ---------------------------------------------------------------------------
# boto3: the pool client imports it. The inherited setup script pip-installs
# it at lab time if missing; bake it so that branch never runs.
# ---------------------------------------------------------------------------
say "Ensuring python3 boto3 is importable"
if ! python3 -c 'import boto3' 2>/dev/null; then
    pip3 install --quiet boto3 2>/dev/null || pip3 install --quiet --break-system-packages boto3
fi
python3 -c 'import boto3; print("boto3", boto3.__version__)'

# ---------------------------------------------------------------------------
# Node >= 20 (NodeSource). Skip if a new-enough node is already present.
# ---------------------------------------------------------------------------
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [ -n "${NODE_MAJOR}" ] && [ "${NODE_MAJOR}" -ge 20 ]; then
    say "Node $(node -v) already present (>= 20); skipping NodeSource install"
else
    say "Installing Node.js ${NODE_VERSION} (via NodeSource)"
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION} nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get -y update
    apt-get -y install nodejs
fi
npm install -g npm@latest
node -v; npm -v

# ---------------------------------------------------------------------------
# gh CLI (official apt repo). Setup and every check script use it: repo reset,
# closing stale PRs, listing PRs and diffs. Auth comes from the pool user's
# installation token at lab time, never a login.
# ---------------------------------------------------------------------------
if command -v gh >/dev/null 2>&1; then
    say "gh $(gh --version | head -1 | awk '{print $3}') already present"
else
    say "Installing gh CLI"
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
    apt-get -y update
    apt-get -y install gh
fi
gh --version | head -1

# ---------------------------------------------------------------------------
# Terraform: the inherited setup runs `terraform apply` in /opt/ld/terraform-ld-student.
# The base image has it; install only if missing.
# ---------------------------------------------------------------------------
if command -v terraform >/dev/null 2>&1; then
    say "terraform already present: $(terraform version | head -1)"
else
    say "Installing terraform ${TERRAFORM_VERSION} (direct binary)"
    TF_ARCH="$(dpkg --print-architecture)"
    TF_ZIP="terraform_${TERRAFORM_VERSION}_linux_${TF_ARCH}.zip"
    curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/${TF_ZIP}" -o "/tmp/${TF_ZIP}"
    unzip -o "/tmp/${TF_ZIP}" -d /usr/local/bin
    chmod +x /usr/local/bin/terraform
    rm "/tmp/${TF_ZIP}"
    terraform version
fi

# ---------------------------------------------------------------------------
# Load-bearing pieces from image-pov-python-v2. Verify; rebuild only if absent.
# ---------------------------------------------------------------------------
mkdir -p /opt/ld
SCRATCH="$(mktemp -d)"

say "Checking /opt/ld/util (GitHub account pool client)"
if [ -f /opt/ld/util/pool.py ] && [ -f /opt/ld/util/gh_auth.py ] && [ -f /opt/ld/util/pat.py ] && [ -f /opt/ld/util/totp.py ]; then
    echo "present: $(ls /opt/ld/util/*.py | xargs -n1 basename | tr '\n' ' ')"
else
    warn "/opt/ld/util is incomplete; this is not the image-pov-python-v2 base. Rebuilding from ${POOL_LIB_REPO_URL} lib/"
    git clone --depth 1 "${POOL_LIB_REPO_URL}" "${SCRATCH}/pool-src"
    mkdir -p /opt/ld/util
    cp "${SCRATCH}/pool-src/lib/"*.py /opt/ld/util/
    chmod +x /opt/ld/util/*.py
fi
PYTHONPATH=/opt/ld/util python3 -c 'import pool, gh_auth, pat, totp; print("pool client imports OK")'

say "Checking /opt/ld/terraform-ld-student (one LD project per sandbox)"
if [ -f /opt/ld/terraform-ld-student/main.tf ]; then
    echo "present"
else
    warn "/opt/ld/terraform-ld-student missing; cloning ${TF_STUDENT_REPO_URL}"
    git clone --depth 1 "${TF_STUDENT_REPO_URL}" /opt/ld/terraform-ld-student
fi
if [ ! -d /opt/ld/terraform-ld-student/.terraform ]; then
    say "Pre-initializing terraform-ld-student so lab start does not download providers"
    (cd /opt/ld/terraform-ld-student && terraform init -input=false)
fi
# Only ONE LaunchDarkly project is needed. AutoFactory normally separates a
# factory project from an app project; this track collapses both into the
# project Terraform already creates. The Terraform needs no changes.

# ---------------------------------------------------------------------------
# AutoFactory tooling checkout with dependencies installed at bake time.
# A cold `npm ci` mid-lab costs minutes of dead time.
# ---------------------------------------------------------------------------
say "Cloning AutoFactory from ${AUTOFACTORY_REPO_URL}@${AUTOFACTORY_REF} into /opt/ld/auto-factory"
rm -rf /opt/ld/auto-factory
git clone --depth 1 --branch "${AUTOFACTORY_REF}" "${AUTOFACTORY_REPO_URL}" /opt/ld/auto-factory
cd /opt/ld/auto-factory
say "npm ci (workspaces: packages/*)"
npm ci --no-audit --no-fund
# Smoke: the bridge CLI is what setup calls. It runs TypeScript via tsx with no
# build step, so tsx must be resolvable from the repo root.
node -e 'import("tsx").then(() => console.log("tsx resolvable: bridge CLI can run"))'
test -f packages/config-bridge/src/cli.ts
test -d config/agentcontrol/ai-configs && echo "agent configs: $(ls config/agentcontrol/ai-configs/*.json | wc -l)"
test -f config/agentcontrol/graphs/auto-factory.json && echo "graph present"
cd /

# ---------------------------------------------------------------------------
# LaunchDarkly MCP server, pre-warmed (strongly recommended). The cloud chain
# gets MCP from Cursor's web config, not from here; baking it keeps the option
# of a workstation-side LaunchDarkly query without a cold `npx` stall.
# ---------------------------------------------------------------------------
say "Installing @launchdarkly/mcp-server globally"
npm install -g @launchdarkly/mcp-server --no-audit --no-fund
npm ls -g @launchdarkly/mcp-server --depth=0 | tail -1

# ---------------------------------------------------------------------------
# The game: game/ from the track repo -> /opt/ld/factory-floor, served on 7777
# by a `factory-floor` service that reads /opt/ld/factory-floor/.env.
# ---------------------------------------------------------------------------
say "Installing Factory Floor from ${TRACK_REPO_URL}@${TRACK_REPO_REF}"
git clone --depth 1 --branch "${TRACK_REPO_REF}" "${TRACK_REPO_URL}" "${SCRATCH}/track"
test -f "${SCRATCH}/track/game/server.mjs"
rm -rf /opt/ld/factory-floor
cp -R "${SCRATCH}/track/game" /opt/ld/factory-floor
# Zero npm dependencies by design: nothing to install. Assert that stays true.
if [ "$(node -e 'const p=require("/opt/ld/factory-floor/package.json"); console.log(Object.keys(p.dependencies||{}).length)')" != "0" ]; then
    echo "factory-floor package.json declares dependencies; the game must have none" >&2
    exit 1
fi
node --check /opt/ld/factory-floor/server.mjs
# .env is written by track setup. Not pre-created: the unit tolerates its absence
# (leading '-') and the game reports "AF_REPO is not set" until setup runs.

say "Installing factory-floor.service (Node on :7777)"
cat <<'UNIT' > /etc/systemd/system/factory-floor.service
[Unit]
Description=Factory Floor (AutoFactory chain visualization on :7777)
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=2
User=root
WorkingDirectory=/opt/ld/factory-floor
Environment=PORT=7777
EnvironmentFile=-/opt/ld/factory-floor/.env
ExecStart=/usr/bin/node /opt/ld/factory-floor/server.mjs

[Install]
WantedBy=multi-user.target
UNIT
# Track setup does `service factory-floor stop` then `start` after writing .env.
# NOT `restart`: that would not reload the environment file's new values into
# a process that has already read them. Same trap the ac-mcp track documents.
systemctl daemon-reload
systemctl enable factory-floor

say "Smoke-testing factory-floor (start, /api/health, stop)"
systemctl restart factory-floor
for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:7777/api/health >/dev/null 2>&1; then break; fi
    sleep 0.5
done
curl -fsS http://127.0.0.1:7777/api/health
echo
curl -fsS http://127.0.0.1:7777/api/state | python3 -c 'import json,sys; s=json.load(sys.stdin); print("runState:", s["runState"], "| pollError:", s["pollError"])'
systemctl stop factory-floor

# ---------------------------------------------------------------------------
# Git: non-interactive HTTPS. Setup clones with an x-access-token URL so no
# credential helper is needed; a committer identity is a fallback only (setup
# overwrites it per pool user).
# ---------------------------------------------------------------------------
say "Configuring git for non-interactive use"
cat <<'PROFILE' > /etc/profile.d/git-noninteractive.sh
export GIT_TERMINAL_PROMPT=0
PROFILE
git config --global user.email "workshops@launchdarkly.com"
git config --global user.name "LaunchDarkly Workshops"
git config --global init.defaultBranch main
git config --global advice.detachedHead false

# ---------------------------------------------------------------------------
# Writable scratch path: must NOT exist in the image. Setup removes and re-clones.
# ---------------------------------------------------------------------------
say "Ensuring /opt/ld/autofactory-app does not exist in the image"
rm -rf /opt/ld/autofactory-app

# ---------------------------------------------------------------------------
# Bake-time smoke test (warn-only): every org app repo has a `pristine` tag.
# Setup's `git checkout -B main refs/tags/pristine` fails hard without it.
# Repos are public, so this is unauthenticated.
# ---------------------------------------------------------------------------
say "Checking pristine tags on ${APP_REPO_ORG}/autofactory-01..$(printf '%02d' "${APP_REPO_COUNT}")"
MISSING_TAGS=0
for i in $(seq 1 "${APP_REPO_COUNT}"); do
    NN="$(printf '%02d' "$i")"
    if curl -fsS "https://api.github.com/repos/${APP_REPO_ORG}/autofactory-${NN}/git/ref/tags/pristine" >/dev/null 2>&1; then
        printf 'autofactory-%s ok\n' "${NN}"
    else
        warn "autofactory-${NN}: no pristine tag reachable (missing repo, missing tag, or API rate limit)"
        MISSING_TAGS=$((MISSING_TAGS + 1))
    fi
done
[ "${MISSING_TAGS}" -eq 0 ] || warn "${MISSING_TAGS} repo(s) failed the pristine check; fix before the first dry run"

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
say "Cleaning up"
rm -rf "${SCRATCH}"
npm cache clean --force >/dev/null 2>&1 || true
apt-get -y autoremove
apt-get -y clean

# ---------------------------------------------------------------------------
# Verification summary
# ---------------------------------------------------------------------------
say "Verification summary"
printf '%-28s %s\n' "node"                 "$(node -v)"
printf '%-28s %s\n' "npm"                  "$(npm -v)"
printf '%-28s %s\n' "gh"                   "$(gh --version | head -1 | awk '{print $3}')"
printf '%-28s %s\n' "jq"                   "$(jq --version)"
printf '%-28s %s\n' "terraform"            "$(terraform version | head -1 | awk '{print $2}')"
printf '%-28s %s\n' "python3"              "$(python3 --version | awk '{print $2}')"
printf '%-28s %s\n' "boto3"                "$(python3 -c 'import boto3; print(boto3.__version__)')"
printf '%-28s %s\n' "/opt/ld/util"         "$(ls /opt/ld/util/*.py | wc -l) files"
printf '%-28s %s\n' "/opt/ld/terraform-ld-student" "$( [ -d /opt/ld/terraform-ld-student/.terraform ] && echo initialized || echo NOT initialized)"
printf '%-28s %s\n' "/opt/ld/auto-factory" "$(git -C /opt/ld/auto-factory rev-parse --short HEAD) (node_modules: $( [ -d /opt/ld/auto-factory/node_modules ] && echo yes || echo NO))"
printf '%-28s %s\n' "@launchdarkly/mcp-server" "$(npm ls -g @launchdarkly/mcp-server --depth=0 2>/dev/null | grep -o '@launchdarkly/mcp-server@[0-9.]*' || echo missing)"
printf '%-28s %s\n' "/opt/ld/factory-floor" "$( [ -f /opt/ld/factory-floor/server.mjs ] && echo present || echo MISSING)"
printf '%-28s %s\n' "factory-floor.service" "$(systemctl is-enabled factory-floor)"
printf '%-28s %s\n' "/opt/ld/autofactory-app" "$( [ -e /opt/ld/autofactory-app ] && echo PRESENT (must not be) || echo absent, correct)"

say "Done. Save this VM as launchdarkly/workshop-autofactory-cursor from the Instruqt console."
say "Not installed on purpose: ANTHROPIC/CURSOR keys, @cursor/sdk, Bedrock, code-server, ToggleWear."
