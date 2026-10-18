#!/usr/bin/env bash
# Adds the Telegram collector to the machine that already runs the WhatsApp
# one (the Debian VM from setup-debian.sh), or to any machine with Node.js 20+
# that stays on. Run it from that machine's SSH window:
#
#   curl -fsSL https://raw.githubusercontent.com/wanshah07/halal-executive/main/collectors/cloud/add-telegram.sh | bash
#
# Before you run it (two minutes in Telegram):
#   1. Chat with @BotFather: /newbot, choose a name, copy the token it gives you.
#   2. Still in BotFather: /setprivacy -> choose your bot -> Disable. Without
#      this the bot only sees commands, not the group's messages.
#   3. Add the bot to the "Halal Executive" group (Group info -> Add members).
#      Not allowed to add members (not an admin)? Skip this: you can send or
#      forward messages and files to the bot in a private chat instead.
#   4. Send any message to the bot (or in the group), so the bot has something to list.
#
# It asks for the token, shows the groups the bot can see, asks which one, and
# leaves the collector running under pm2 as he-telegram (restarts on a crash
# and on reboot). The site shows Telegram as Live (Overview -> Collectors)
# within 5 minutes, and the watchdog emails the admins if it stops.
set -euo pipefail
IN="${HE_INPUT:-/dev/tty}"   # where the questions are read from (a test can point it at a file)

echo "== 1/5 Node.js, git, pm2 =="
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq git curl ca-certificates >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
command -v git >/dev/null || { sudo apt-get install -y -qq git >/dev/null; }
command -v pm2 >/dev/null || sudo npm install -g pm2 >/dev/null 2>&1

echo "== 2/5 Code =="
cd ~
if [ -d halal-executive ]; then git -C halal-executive pull -q; else git clone -q https://github.com/wanshah07/halal-executive.git; fi
cd ~/halal-executive/collectors/telegram
npm install --omit=dev --no-audit --no-fund >/dev/null

echo "== 3/5 Settings (collectors/.env) =="
ENV=~/halal-executive/collectors/.env
touch "$ENV"; chmod 600 "$ENV"
have() { grep -q "^$1=." "$ENV"; }
setv() { grep -v "^$1=" "$ENV" > "$ENV.tmp" || true; printf '%s=%s\n' "$1" "$2" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"; }
if ! have HE_API_URL; then read -rp "Apps Script web app URL (ends in /exec): " URL <"$IN"; setv HE_API_URL "$URL"; fi
if ! have HE_INGEST_TOKEN; then read -rsp "INGEST_TOKEN (hidden): " TOKEN <"$IN"; echo; setv HE_INGEST_TOKEN "$TOKEN"; fi
if ! have TELEGRAM_BOT_TOKEN; then read -rsp "Telegram bot token from BotFather (hidden): " BT <"$IN"; echo; setv TELEGRAM_BOT_TOKEN "$BT"; fi

echo "== 4/5 Which group? =="
node collect.js --chats
if ! have TELEGRAM_CHAT_ID; then
  read -rp "Group id to read (the number on the line marked '<- this is the group'; Enter if the bot is not in a group): " CID <"$IN"
  [ -n "$CID" ] && setv TELEGRAM_CHAT_ID "$CID"
fi
if ! have TELEGRAM_ALLOWED_USERS; then
  read -rp "Your Telegram id for private messages to the bot (the number on the line marked '<- a person'; Enter to skip): " UID_ <"$IN"
  [ -n "$UID_" ] && setv TELEGRAM_ALLOWED_USERS "$UID_"
fi

echo "== 5/5 Run for good under pm2 =="
pm2 delete he-telegram >/dev/null 2>&1 || true
pm2 start collect.js --name he-telegram --max-memory-restart 300M
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "${USER:-$(id -un)}" --hp "$HOME" >/dev/null 2>&1 || true
sleep 6
pm2 logs he-telegram --lines 12 --nostream || true
echo
echo "Done. Check with:  pm2 logs he-telegram --lines 20"
echo "Telegram shows as Live on the site (Overview -> Collectors) within 5 minutes."
echo "Messages in the group from now on, and anything you send or forward to the bot, reach the Sheet."
echo "Older group messages come from an export (Telegram Desktop -> Export chat history, with photos and files):"
echo "  node ~/halal-executive/collectors/telegram/collect.js --import <export folder>"
