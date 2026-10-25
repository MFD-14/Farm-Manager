#!/usr/bin/env bash
# Woodlands Farm Manager: one-command server install for a fresh Ubuntu or
# Debian machine (Google Cloud e2-micro, Oracle Cloud Always Free, any VPS).
#
#   curl -fsSL https://raw.githubusercontent.com/MFD-14/Farm-Manager/main/scripts/install-server.sh | sudo bash
#
# Re-running it updates the server to the latest version and keeps all data
# and passwords. Optional overrides: DOMAIN=farm.example.com (otherwise a free
# <ip>.sslip.io address is used), INSTALL_DIR (default /opt/woodlands).
set -euo pipefail

# Everything runs inside main so the whole script is read before any of it
# runs (safe when piped from curl).
main() {
REPO_URL="${REPO_URL:-https://github.com/MFD-14/Farm-Manager.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/woodlands}"

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mXX  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root: put 'sudo' in front (… | sudo bash)."
command -v apt-get >/dev/null || die "This installer supports Ubuntu and Debian. Pick an Ubuntu image when creating the server."

export DEBIAN_FRONTEND=noninteractive

say "Installing basic tools"
apt-get update -qq
apt-get install -y -qq git curl openssl ca-certificates >/dev/null

# Small free servers have 1 GB of memory; swap keeps updates and the database
# comfortable and lets the image be built locally if the download fails.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 2000 ] && ! swapon --show | grep -q .; then
  say "Adding 2 GB of swap (this machine has ${mem_mb} MB of memory)"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "Docker Compose is missing; install the docker-compose-plugin package and re-run."

if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating Woodlands in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only -q
else
  say "Downloading Woodlands to $INSTALL_DIR"
  git clone -q "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

public_ip=$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me || true)

rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }

if [ ! -f .env ]; then
  say "Creating settings and passwords (.env)"
  [ -n "${DOMAIN:-}" ] || [ -n "$public_ip" ] || die "Could not find this server's public IP. Re-run with DOMAIN=your.domain."
  cat > .env <<EOF
# Created by scripts/install-server.sh on $(date -u +%Y-%m-%d). Keep this file private.
DOMAIN=${DOMAIN:-${public_ip//./-}.sslip.io}
DB_PASSWORD=$(rand 32)
JWT_SECRET=$(rand 48)
OWNER_PASSWORD=$(rand 12)
CARETAKER_PASSWORD=$(rand 12)
# Measured usable tank litres once Phase 0 rehabilitation is done
TANK_USABLE=80000
# Optional: Claude Vision verification and WhatsApp Business
ANTHROPIC_API_KEY=
VIM_MODE=heuristic
WA_TOKEN=
WA_PHONE_ID=
WA_VERIFY_TOKEN=
EOF
  chmod 600 .env
elif [ -n "${DOMAIN:-}" ]; then
  # Explicit DOMAIN on a re-run replaces the stored one.
  if grep -q '^DOMAIN=' .env; then sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env; else echo "DOMAIN=${DOMAIN}" >> .env; fi
elif ! grep -q '^DOMAIN=.\+' .env; then
  [ -n "$public_ip" ] || die "Could not find this server's public IP. Re-run with DOMAIN=your.domain."
  sed -i '/^DOMAIN=/d' .env
  echo "DOMAIN=${public_ip//./-}.sslip.io" >> .env
fi

domain=$(grep '^DOMAIN=' .env | cut -d= -f2-)
owner_pw=$(grep '^OWNER_PASSWORD=' .env | cut -d= -f2-)
caretaker_pw=$(grep '^CARETAKER_PASSWORD=' .env | cut -d= -f2-)

# Oracle's Ubuntu images block everything but SSH inside the machine itself,
# on top of the cloud firewall. Open web traffic in both places.
if iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
  say "Opening ports 80 and 443 in the machine's firewall"
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
fi
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

say "Getting the Woodlands server image"
if ! docker compose pull -q app; then
  warn "Prebuilt image not available; building here instead (10-20 minutes on a small server)."
  docker compose build app
fi

say "Starting Woodlands"
docker compose --profile https up -d --remove-orphans
docker image prune -f >/dev/null 2>&1 || true

say "Waiting for the server and its HTTPS certificate"
ok=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://${domain}/api/health" >/dev/null 2>&1; then ok=yes; break; fi
  sleep 5
done

if [ -z "$ok" ]; then
  if curl -fsS --max-time 5 http://localhost:4000/api/health >/dev/null 2>&1; then
    warn "The app is running, but https://${domain} is not reachable from the internet yet."
    warn "Allow incoming TCP ports 80 and 443 in your cloud provider's firewall (see DEPLOY-FREE-CLOUD.md), then wait a minute."
  else
    warn "The app did not start. Show the logs with: cd ${INSTALL_DIR} && docker compose logs --tail 80 app"
  fi
fi

cat <<EOF

────────────────────────────────────────────────────────────
  Woodlands Farm Manager is installed.

  Server address (type this into the phone app):
      https://${domain}

  Owner sign-in:      owner@woodlands.farm
  Owner password:     ${owner_pw}

  Caretaker sign-in:  caretaker@woodlands.farm
  Caretaker password: ${caretaker_pw}

  Write these down now. They are also stored in ${INSTALL_DIR}/.env
  To update later, run the same install command again.
────────────────────────────────────────────────────────────
EOF
}

main "$@"
