#!/bin/bash
#
# Instruqt VM image build script — `ai-configs-intro`.
#
# Workflow:
#   1. In the Instruqt web console, start a fresh Ubuntu LTS base image.
#   2. Edit REPO_URL / REPO_REF below to point at the desired commit of this repo.
#   3. Paste this entire script into the terminal as root (or run with sudo).
#   4. When the script finishes, save the running VM as a new image from the console.
#
# Idempotent enough to run twice: re-running picks up the latest commit but does
# not touch services that are already enabled.
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Edit these before pasting:
# ---------------------------------------------------------------------------
REPO_URL="https://github.com/launchdarkly-labs/ld-workshop-ac-cursor.git"
REPO_REF="main"
TERRAFORM_VERSION="1.16.3"
NODE_VERSION="26.x"
# ---------------------------------------------------------------------------

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

export DEBIAN_FRONTEND=noninteractive

say "Updating apt"
apt-get -y update

say "Installing apt packages (system tools + python3)"
# Ubuntu 24.04 (noble) ships python3.12 as the system python — both ldai and
# launchdarkly-server-sdk require >=3.10, so the system python is fine.
apt-get -y install \
    software-properties-common \
    unzip jq git curl wget gnupg ca-certificates lsb-release vim \
    build-essential \
    python3 python3-venv python3-dev python3-pip

say "Installing Node.js ${NODE_VERSION} (via NodeSource)"
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION} nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
apt -y update
apt install -y nodejs
npm install -g npm@latest

say "Installing terraform ${TERRAFORM_VERSION} (direct binary; HashiCorp's apt repo has gaps on noble)"
TF_ARCH="$(dpkg --print-architecture)"
TF_ZIP="terraform_${TERRAFORM_VERSION}_linux_${TF_ARCH}.zip"
curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/${TF_ZIP}" -o "/tmp/${TF_ZIP}"
unzip -o "/tmp/${TF_ZIP}" -d /usr/local/bin
chmod +x /usr/local/bin/terraform
rm "/tmp/${TF_ZIP}"
terraform version

say "Cloning app source from ${REPO_URL}@${REPO_REF}"
mkdir -p /opt/ld
rm -rf /opt/ld/ai-configs-intro
git clone --depth 1 --branch "${REPO_REF}" "${REPO_URL}" /opt/ld/ai-configs-intro

say "Building Python venv for the ToggleWear app ($(python3 --version))"
APP_DIR=/opt/ld/ai-configs-intro/app
python3 -m venv "${APP_DIR}/.venv"
"${APP_DIR}/.venv/bin/pip" install --upgrade pip
"${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/requirements.txt"

say "Seeding .env from .env.example (real values are sed'd in at lab start)"
if [ ! -f "${APP_DIR}/.env" ]; then
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
fi

say "Pre-initializing student-bootstrap terraform module"
cd /opt/ld/ai-configs-intro/terraform/student-bootstrap
terraform init

say "Installing togglewear.service (FastAPI on :3000)"
cat <<'UNIT' > /etc/systemd/system/togglewear.service
[Unit]
Description=ToggleWear (FastAPI)
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=1
User=root
WorkingDirectory=/opt/ld/ai-configs-intro/app
EnvironmentFile=/opt/ld/ai-configs-intro/app/.env
ExecStart=/opt/ld/ai-configs-intro/app/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 3000 --reload

[Install]
WantedBy=multi-user.target
UNIT
systemctl enable togglewear

say "Installing Evaluator Tracker service"
cat <<'UNIT' > /etc/systemd/system/evaluatortracker.service
[Unit]
Description=Evaluator Tracker
After=togglewear.service
Wants=togglewear.service
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=5
User=root
WorkingDirectory=/opt/ld/ai-configs-intro/traffic-generator
ExecStart=/opt/ld/ai-configs-intro/app/.venv/bin/python3 /opt/ld/ai-configs-intro/traffic-generator/realchat_traffic.py

[Install]
WantedBy=multi-user.target
UNIT
systemctl enable evaluatortracker

say "Installing code-server (:8080)"
mkdir -p /root/.local/share/code-server/User
cat > /root/.local/share/code-server/User/settings.json <<'JSON'
{
    "workbench.colorTheme": "Default Dark+",
    "workbench.startupEditor": "none",
    "security.workspace.trust.enabled": false
}
JSON
curl -fsSL https://code-server.dev/install.sh | sh

cat <<'UNIT' > /etc/systemd/system/code-server.service
[Unit]
Description=Code Server
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=1
User=root
ExecStart=/usr/bin/code-server --host 0.0.0.0 --port 8080 --auth none /opt/ld/ai-configs-intro/app

[Install]
WantedBy=multi-user.target
UNIT
systemctl enable code-server

say "Cleaning up apt caches"
apt-get -y autoremove
apt-get -y clean

say "Done. Save this VM as your image from the Instruqt console."
say "Verify before saving: systemctl is-enabled togglewear code-server"