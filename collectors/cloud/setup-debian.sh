#!/usr/bin/env bash
# One-time setup of the WhatsApp collector on an always-on Debian 12 server
# (Google Cloud e2-micro or any small VM). Run it from the server's SSH window:
#
#   curl -fsSL https://raw.githubusercontent.com/wanshah07/halal-executive/main/collectors/cloud/setup-debian.sh | bash
#
# It installs Node.js 22, Chromium and pm2, adds 2 GB of swap (a 1 GB machine
# runs out of memory running WhatsApp Web without it), clones the repo, asks
# for the three settings, shows the WhatsApp QR code, and leaves the
# collector running under pm2 so it restarts by itself and after a reboot.
set -euo pipefail

echo "== 1/6 Swap (2 GB) =="
# swapon lives in /sbin, which is not on a normal user's PATH: go through sudo.
if ! sudo swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null; }
  sudo swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null

echo "== 2/6 Chromium, git, Node.js 22 =="
sudo apt-get update -qq
sudo apt-get install -y -qq chromium git curl ca-certificates fonts-noto-color-emoji >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
sudo npm install -g pm2 >/dev/null 2>&1

echo "== 3/6 Code =="
cd ~
if [ -d halal-executive ]; then git -C halal-executive pull -q; else git clone -q https://github.com/wanshah07/halal-executive.git; fi
cd ~/halal-executive/collectors/whatsapp
npm install --omit=dev --no-audit --no-fund >/dev/null

echo "== 4/6 Settings (collectors/.env) =="
ENV=~/halal-executive/collectors/.env
if [ ! -s "$ENV" ]; then
  read -rp "Apps Script web app URL (ends in /exec): " URL </dev/tty
  read -rp "INGEST_TOKEN: " TOKEN </dev/tty
  read -rp "WhatsApp group id (ends in @g.us, Enter for 60142093969-1382755065@g.us): " GID </dev/tty
  GID=${GID:-60142093969-1382755065@g.us}
  umask 077
  printf 'HE_API_URL=%s\nHE_INGEST_TOKEN=%s\nHE_GROUP_ID=%s\nHE_BROWSER=/usr/bin/chromium\n' "$URL" "$TOKEN" "$GID" > "$ENV"
fi

echo "== 5/6 Link WhatsApp: scan the QR code below =="
echo "Phone: WhatsApp → Settings → Linked devices → Link a device."
echo "The script carries on by itself once WhatsApp is linked."
LOG=$(mktemp)
node collect.js > >(tee "$LOG") 2>&1 &
PID=$!
until grep -q "Listening for new messages" "$LOG"; do
  sleep 2
  if ! kill -0 "$PID" 2>/dev/null; then echo "The collector stopped before linking. Read the lines above, fix, and run this script again."; exit 1; fi
done
kill "$PID"; wait "$PID" 2>/dev/null || true; sleep 2

echo "== 6/6 Run for good under pm2 =="
pm2 delete he-whatsapp >/dev/null 2>&1 || true
pm2 start collect.js --name he-whatsapp --max-memory-restart 700M
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null
echo
echo "Done. Check with:  pm2 logs he-whatsapp --lines 20"
echo "The site shows WhatsApp as Live (Overview → Collectors) within 5 minutes."
