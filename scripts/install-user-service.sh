#!/usr/bin/env bash
set -Eeuo pipefail

# Independent per-user RayCraft Discord Bot service; no sudo or Minecraft changes.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd -P)"
umask 077

for binary in node npm systemctl; do
  command -v "$binary" >/dev/null || { echo "Missing prerequisite: $binary" >&2; exit 1; }
done
[[ -f package.json ]] || { echo "This must run inside the RayCraft Bot repository." >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || {
  echo "Node.js 20+ is required." >&2; exit 1;
}
[[ ! -e .env ]] || { echo "Existing .env found; refusing to overwrite credentials." >&2; exit 1; }

SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/raycraft-bot.service"
[[ ! -e "$SERVICE_FILE" ]] || { echo "Existing service found: $SERVICE_FILE; refusing to overwrite." >&2; exit 1; }

for key in BOT_APPLICATION_ID GUILD_ID MODERATOR_ROLE_IDS HELPER_ROLE_IDS MOD_LOG_CHANNEL_ID TICKET_FORUM_ID; do
  value="${!key:-}"
  [[ "$value" =~ ^[0-9]{15,22}$ ]] || { echo "Invalid or missing Discord ID: $key" >&2; exit 1; }
done

echo "Installing dependencies and running local tests..."
npm install --no-audit --no-fund
npm test
npm run check

[[ -t 0 ]] || { echo "Run this in an interactive SSH terminal to enter the token privately." >&2; exit 1; }
IFS= read -r -s -p "Paste RayCraft Bot token (hidden): " SECRET_TOKEN
printf '\n'
[[ -n "$SECRET_TOKEN" && "$SECRET_TOKEN" != *$'\n'* && "$SECRET_TOKEN" != *$'\r'* ]] || {
  echo "Invalid token; exiting." >&2; exit 1;
}

temporary="$(mktemp "$ROOT/.env.XXXXXXXX")"
trap 'rm -f "$temporary"' EXIT
{
  printf 'DISCORD_TOKEN=%s\n' "$SECRET_TOKEN"
  printf 'BOT_APPLICATION_ID=%s\n' "$BOT_APPLICATION_ID"
  printf 'GUILD_ID=%s\n' "$GUILD_ID"
  printf 'MODERATOR_ROLE_IDS=%s\n' "$MODERATOR_ROLE_IDS"
  printf 'HELPER_ROLE_IDS=%s\n' "$HELPER_ROLE_IDS"
  printf 'MOD_LOG_CHANNEL_ID=%s\n' "$MOD_LOG_CHANNEL_ID"
  printf 'TICKET_FORUM_ID=%s\n' "$TICKET_FORUM_ID"
  printf 'RULES_CHANNEL_ID=%s\n' "${RULES_CHANNEL_ID:-}"
  printf 'DATA_FILE=%s/data/raycraft.json\n' "$ROOT"
} > "$temporary"
chmod 600 "$temporary"
mv "$temporary" .env
unset SECRET_TOKEN
trap - EXIT

NODE_PATH="$(command -v node)"
mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=RayCraft Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=$NODE_PATH $ROOT/src/index.js
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=15
NoNewPrivileges=true
UMask=0077

[Install]
WantedBy=default.target
EOF
chmod 600 "$SERVICE_FILE"
systemctl --user daemon-reload
systemctl --user enable --now raycraft-bot.service

echo "RayCraft Bot user service installed. Check:"
echo "systemctl --user status raycraft-bot.service --no-pager"
echo "journalctl --user -u raycraft-bot.service -n 60 --no-pager"
echo "To keep user services across logout/reboot, your user may need lingering enabled."
