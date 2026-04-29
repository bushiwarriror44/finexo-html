#!/usr/bin/env bash
set -Eeuo pipefail

# CloudMine zero-to-prod bootstrap for Ubuntu 22.04/24.04
# Includes: Docker, app deploy, Nginx reverse proxy, Certbot TLS (no email),
# Postfix + OpenDKIM for local outbound mail.

DOMAIN="${DOMAIN:-cloud-mine.com}"
WWW_DOMAIN="${WWW_DOMAIN:-www.cloud-mine.com}"
SERVER_IP="${SERVER_IP:-172.86.72.70}"
APP_DIR="${APP_DIR:-/opt/cloudmine}"
REPO_URL="${REPO_URL:-}"
APP_USER="${APP_USER:-root}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@cloud-mine.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeThisAdminPass123!}"
EMAIL_FROM="${EMAIL_FROM:-noreply@cloud-mine.com}"
TEAM_APPLICATIONS_TO="${TEAM_APPLICATIONS_TO:-admin@cloud-mine.com}"
ENABLE_UFW="${ENABLE_UFW:-true}"
CERTBOT_STAGING="${CERTBOT_STAGING:-false}"

log() { printf "\n[+] %s\n" "$*"; }
warn() { printf "\n[!] %s\n" "$*" >&2; }
die() { printf "\n[x] %s\n" "$*" >&2; exit 1; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root (sudo -i)."
  fi
}

install_base_packages() {
  log "Updating apt and installing base packages"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    git curl ca-certificates gnupg lsb-release jq \
    nginx certbot python3-certbot-nginx \
    postfix mailutils opendkim opendkim-tools
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker already installed, skipping install"
    return
  fi
  log "Installing Docker CE + compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable
EOF
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

prepare_app_code() {
  [[ -n "${REPO_URL}" ]] || die "Set REPO_URL, example: REPO_URL=https://github.com/org/repo.git"
  if [[ -d "${APP_DIR}/.git" ]]; then
    log "Updating existing repository in ${APP_DIR}"
    git -C "${APP_DIR}" fetch --all --prune
    git -C "${APP_DIR}" reset --hard origin/HEAD
  else
    log "Cloning repository to ${APP_DIR}"
    mkdir -p "$(dirname "${APP_DIR}")"
    git clone "${REPO_URL}" "${APP_DIR}"
  fi
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

write_env_file() {
  log "Creating/updating .env"
  local env_file="${APP_DIR}/.env"
  local secret_key credential_key
  secret_key="$(openssl rand -hex 32)"
  credential_key="$(openssl rand -hex 32)"

  cat >"${env_file}" <<EOF
SECRET_KEY=${secret_key}
CREDENTIALS_ENCRYPTION_KEY=${credential_key}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
MINING_ACCRUALS_ENABLED=true
MINING_ACCRUAL_HOUR_UTC=0

FEATURE_REFERRAL=false
FEATURE_REFERRAL_PAYOUTS=false
FEATURE_SUPPORT=true
FEATURE_SUPPORT_CHAT_POLLING=true
FEATURE_SUPPORT_SLA=true
FEATURE_KYC=false
FEATURE_KYC_OPTIONAL=true
FEATURE_RATE_LIMIT_STRICT=false
FEATURE_AUDIT_STRICT=false

KYC_REQUIRED_COUNTRIES=
TOPUP_WORKER_POLL_SECONDS=15
TOPUP_RUNNING_TIMEOUT_SECONDS=180

ALLOWED_ORIGINS=https://${DOMAIN},https://${WWW_DOMAIN}
SESSION_COOKIE_SECURE=True

EMAIL_FROM=${EMAIL_FROM}
TEAM_APPLICATIONS_TO=${TEAM_APPLICATIONS_TO}
EMAIL_SMTP_HOST=127.0.0.1
EMAIL_SMTP_PORT=25
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
EMAIL_SMTP_USE_TLS=false
EMAIL_SMTP_STARTTLS=false
EMAIL_SMTP_TIMEOUT_SECONDS=20

EMAIL_API_URL=
EMAIL_API_TOKEN=
EMAIL_API_TIMEOUT_SECONDS=20
EOF
  chmod 600 "${env_file}"
}

deploy_app_containers() {
  log "Building and starting app containers"
  mkdir -p "${APP_DIR}/data"
  docker compose -f "${APP_DIR}/docker-compose.standalone.yaml" up -d --build
  docker compose -f "${APP_DIR}/docker-compose.standalone.yaml" ps
}

configure_nginx() {
  log "Configuring Nginx reverse proxy"
  cat >/etc/nginx/sites-available/"${DOMAIN}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3914;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
  ln -sfn /etc/nginx/sites-available/"${DOMAIN}" /etc/nginx/sites-enabled/"${DOMAIN}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
}

configure_postfix() {
  log "Configuring Postfix for local outbound mail"
  postconf -e "myhostname = mail.${DOMAIN}"
  postconf -e "myorigin = ${DOMAIN}"
  postconf -e "mydestination = localhost"
  postconf -e "inet_interfaces = all"
  postconf -e "inet_protocols = all"
  postconf -e "mynetworks = 127.0.0.0/8 [::1]/128"
  postconf -e "relayhost ="
}

configure_opendkim() {
  log "Configuring OpenDKIM"
  mkdir -p /etc/opendkim/keys/"${DOMAIN}"
  opendkim-genkey -b 2048 -d "${DOMAIN}" -D /etc/opendkim/keys/"${DOMAIN}" -s default -v
  chown -R opendkim:opendkim /etc/opendkim/keys/"${DOMAIN}"
  chmod go-rwx /etc/opendkim/keys/"${DOMAIN}"/default.private

  cat >/etc/opendkim.conf <<'EOF'
Syslog                  yes
UMask                   002
Canonicalization        relaxed/simple
Mode                    sv
SubDomains              no
AutoRestart             yes
AutoRestartRate         10/1h
Background              yes
DNSTimeout              5
SignatureAlgorithm      rsa-sha256
Socket                  local:/run/opendkim/opendkim.sock
PidFile                 /run/opendkim/opendkim.pid
UserID                  opendkim:opendkim
KeyTable                /etc/opendkim/key.table
SigningTable            refile:/etc/opendkim/signing.table
TrustedHosts            /etc/opendkim/trusted.hosts
EOF

  cat >/etc/opendkim/trusted.hosts <<EOF
127.0.0.1
localhost
${DOMAIN}
EOF

  cat >/etc/opendkim/key.table <<EOF
default._domainkey.${DOMAIN} ${DOMAIN}:default:/etc/opendkim/keys/${DOMAIN}/default.private
EOF

  cat >/etc/opendkim/signing.table <<EOF
*@${DOMAIN} default._domainkey.${DOMAIN}
EOF

  mkdir -p /run/opendkim
  chown opendkim:opendkim /run/opendkim

  postconf -e "milter_default_action = accept"
  postconf -e "milter_protocol = 2"
  postconf -e "smtpd_milters = unix:/run/opendkim/opendkim.sock"
  postconf -e "non_smtpd_milters = unix:/run/opendkim/opendkim.sock"

  systemctl enable --now opendkim
  systemctl restart opendkim
  systemctl restart postfix
}

setup_ssl() {
  log "Issuing TLS certificate with certbot (no email)"
  local staging_flag=""
  if [[ "${CERTBOT_STAGING}" == "true" ]]; then
    staging_flag="--test-cert"
    warn "Using CERTBOT STAGING mode"
  fi

  certbot --nginx \
    -d "${DOMAIN}" -d "${WWW_DOMAIN}" \
    --agree-tos --register-unsafely-without-email --non-interactive \
    --redirect ${staging_flag}

  systemctl enable --now certbot.timer
}

setup_ufw() {
  if [[ "${ENABLE_UFW}" != "true" ]]; then
    warn "UFW setup skipped (ENABLE_UFW=false)"
    return
  fi
  log "Configuring UFW"
  DEBIAN_FRONTEND=noninteractive apt-get install -y ufw
  ufw allow OpenSSH || true
  ufw allow 'Nginx Full' || true
  ufw --force enable || true
}

print_dns_instructions() {
  log "Done. Publish/verify these DNS records for domain mailability:"
  local dkim_pub
  dkim_pub="$(tr -d '\n' </etc/opendkim/keys/"${DOMAIN}"/default.txt | sed 's/.*p=/p=/')"
  cat <<EOF

1) A:
   ${DOMAIN}          -> ${SERVER_IP}
   ${WWW_DOMAIN}      -> ${SERVER_IP}
   mail.${DOMAIN}     -> ${SERVER_IP}

2) MX:
   ${DOMAIN}          -> mail.${DOMAIN} (priority 10)

3) SPF (TXT @):
   v=spf1 mx a ip4:${SERVER_IP} -all

4) DKIM (TXT default._domainkey.${DOMAIN}):
   ${dkim_pub}

5) DMARC (TXT _dmarc):
   v=DMARC1; p=quarantine; adkim=s; aspf=s; rua=mailto:${ADMIN_EMAIL}

6) PTR/rDNS at VPS provider:
   ${SERVER_IP} -> mail.${DOMAIN}

Health checks:
  curl -I https://${DOMAIN}
  docker compose -f ${APP_DIR}/docker-compose.standalone.yaml logs -f website
  docker compose -f ${APP_DIR}/docker-compose.standalone.yaml logs -f worker
EOF
}

main() {
  require_root
  install_base_packages
  install_docker
  prepare_app_code
  write_env_file
  deploy_app_containers
  configure_nginx
  configure_postfix
  configure_opendkim
  setup_ssl
  setup_ufw
  print_dns_instructions
}

main "$@"
