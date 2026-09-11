#!/usr/bin/env bash
#
# One-time server setup for the Iron Clan bot on a fresh Ubuntu box.
#
# Run it on the server as a user with sudo:
#   curl -fsSL https://raw.githubusercontent.com/JonStudders/IronClan-Bot/main/deploy/bootstrap.sh | bash
# or, if the repo is already cloned:
#   bash deploy/bootstrap.sh
#
# Idempotent: safe to run again after a change. It never touches .env, so
# re-running cannot clobber your secrets.
set -euo pipefail

REPO_URL="https://github.com/JonStudders/IronClan-Bot.git"
APP_DIR="/opt/ironclan-bot"
APP_USER="ironclan"
DEPLOY_USER="${SUDO_USER:-${USER}}"
NODE_MAJOR=22

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }

# --- Node -------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  say "Installing Node ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
else
  say "Node $(node -v) already installed"
fi

sudo apt-get install -y git curl

# --- Service account --------------------------------------------------------
# A system account with no login shell: it exists only to own the process.
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  say "Creating service account '${APP_USER}'"
  sudo useradd --system --create-home --home-dir "/home/${APP_USER}" --shell /usr/sbin/nologin "$APP_USER"
else
  say "Service account '${APP_USER}' already exists"
fi

# --- Code -------------------------------------------------------------------
if [ ! -d "$APP_DIR/.git" ]; then
  say "Cloning into ${APP_DIR}"
  sudo mkdir -p "$APP_DIR"
  sudo chown "${DEPLOY_USER}:${DEPLOY_USER}" "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
else
  say "Repo already present at ${APP_DIR}"
fi

cd "$APP_DIR"
say "Installing dependencies"
npm ci --omit=dev

# --- Ownership --------------------------------------------------------------
# The deploy user needs to write the working tree (git pull, npm ci); the app
# user needs to write state.json. Shared group ownership gives both.
say "Setting ownership"
sudo chown -R "${DEPLOY_USER}:${APP_USER}" "$APP_DIR"
sudo chmod -R g+rwX "$APP_DIR"
# New files inherit the group, so a later git pull stays writable by the service.
sudo find "$APP_DIR" -type d -exec chmod g+s {} +

# --- .env -------------------------------------------------------------------
if [ ! -f "$APP_DIR/.env" ]; then
  say "Creating .env from the example - YOU MUST FILL THIS IN"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sudo chown "${DEPLOY_USER}:${APP_USER}" "$APP_DIR/.env"
  chmod 640 "$APP_DIR/.env"
  NEEDS_ENV=1
else
  say ".env already present, leaving it alone"
  chmod 640 "$APP_DIR/.env"
  NEEDS_ENV=0
fi

# --- The 'bot' control command ----------------------------------------------
# A symlink, not a copy: deploys update deploy/bot in the working tree, and a
# symlink picks that up for free. A copy would silently go stale, since the
# deploy has no privilege to write to /usr/local/bin.
say "Linking the 'bot' command"
sudo chmod +x "$APP_DIR/deploy/bot"
sudo ln -sfn "$APP_DIR/deploy/bot" /usr/local/bin/bot

# Reading a unit's journal needs group membership; Ubuntu's default user is
# usually in 'adm' already, but say so explicitly rather than relying on it.
sudo usermod -aG systemd-journal "$DEPLOY_USER" || true
sudo usermod -aG adm "$DEPLOY_USER" || true

# --- systemd ----------------------------------------------------------------
say "Installing the systemd unit"
sudo cp "$APP_DIR/deploy/ironclan-bot.service" /etc/systemd/system/ironclan-bot.service
sudo systemctl daemon-reload
sudo systemctl enable ironclan-bot

# --- sudo rule for the deploy user -----------------------------------------
# GitHub Actions restarts the service over SSH. Grant exactly that, and nothing
# else, without a password.
say "Granting '${DEPLOY_USER}' permission to manage only this service"
sudo tee "/etc/sudoers.d/ironclan-bot" >/dev/null <<EOF
${DEPLOY_USER} ALL=(root) NOPASSWD: /bin/systemctl restart ironclan-bot, /bin/systemctl stop ironclan-bot, /bin/systemctl start ironclan-bot, /bin/systemctl status ironclan-bot, /usr/bin/systemctl restart ironclan-bot, /usr/bin/systemctl stop ironclan-bot, /usr/bin/systemctl start ironclan-bot, /usr/bin/systemctl status ironclan-bot
EOF
sudo chmod 440 "/etc/sudoers.d/ironclan-bot"
sudo visudo -c -f "/etc/sudoers.d/ironclan-bot"

# --- Unattended security updates -------------------------------------------
say "Enabling unattended security updates"
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

if [ "$NEEDS_ENV" = "1" ]; then
  cat <<EOF

  Setup is done, but the bot is NOT started.

  Fill in ${APP_DIR}/.env - at minimum botToken, sheetId and
  discordChannelId - then:

      sudo systemctl start ironclan-bot
      bot logs

  Then:  bot status | bot logs | bot restart | bot doctor

  If 'bot' is not found, log out and back in - you were just added to the
  systemd-journal group and the shell needs a new session to pick it up.

EOF
else
  say "Restarting the service"
  sudo systemctl restart ironclan-bot
  sleep 3
  /usr/local/bin/bot status || true
fi
