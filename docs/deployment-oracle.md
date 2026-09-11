# Deploying to Oracle Cloud (Always Free)

The bot runs as a **persistent systemd service** on an Oracle Cloud VM, and
GitHub Actions redeploys it on every push to `main`.

Running persistently (rather than as scheduled one-shot jobs) buys three things:
the update timer is actually punctual, `state.json` survives on disk so rank
arrows are reliable, and **slash commands work again** — they need a live
gateway connection.

Three parts, in order:

1. [The Oracle server](#1-the-oracle-server)
2. [The repo](#2-the-repo)
3. [GitHub Actions](#3-github-actions)

---

## 1. The Oracle server

### Create the instance

In the OCI console: **Compute → Instances → Create instance**.

| Setting | Value | Why |
| --- | --- | --- |
| Shape | **VM.Standard.A1.Flex**, 1 OCPU, 6 GB RAM | Ampere ARM. The Always Free allowance is 4 OCPU / 24 GB total, so this uses a quarter of it |
| Image | **Ubuntu 22.04** or **24.04 LTS** (Canonical) | The bootstrap script assumes `apt` |
| SSH keys | Upload your **public** key | Oracle does not offer password login |
| Public IP | Assign one | Needed so Actions can reach it |

If Ampere capacity is unavailable in your region (common — it is popular), the
AMD **VM.Standard.E2.1.Micro** works too; it has only 1 GB RAM, so add swap:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Networking

**No inbound ports beyond SSH.** The bot makes only *outbound* HTTPS
connections — to Discord's gateway and to Google Sheets. Nothing connects
*to* it, so there is no web server to expose and no firewall rule to add.
The default VCN security list already allows SSH on 22.

If you want to narrow it further, restrict port 22's source CIDR — but note
GitHub Actions runners use a wide, changing IP range, so locking SSH to your
home IP alone would break the deploy.

### Run the bootstrap

SSH in as the default `ubuntu` user, then:

```bash
curl -fsSL https://raw.githubusercontent.com/JonStudders/IronClan-Bot/main/deploy/bootstrap.sh | bash
```

It is idempotent — safe to re-run — and never touches `.env`. It will:

- install Node 22 and git
- create a `ironclan` system account with no login shell, which owns the process
- clone the repo to `/opt/ironclan-bot` and install dependencies
- install and enable the systemd unit from `deploy/ironclan-bot.service`
- grant your deploy user passwordless sudo for **only** `systemctl … ironclan-bot`
- link the `bot` control command into `/usr/local/bin` (a symlink, so deploys
  keep it current)
- enable unattended security updates

### Fill in the configuration

```bash
nano /opt/ironclan-bot/.env
```

At minimum `botToken`, `sheetId` and `discordChannelId`. Also set
`applicationId` and `discordServerId` for the slash commands to register, and
`ownerId` (your Discord user id) for the developer DM commands. Then:

```bash
sudo systemctl start ironclan-bot
bot logs
```

You want to see:

```
Iron Clan bot is online.
Registered 2 slash command(s) for guild 296396357231575041.
Leaderboard posted with 8 team(s) across 2 message(s).
```

### Day-to-day: the `bot` command

`bootstrap.sh` installs `/usr/local/bin/bot`, so you never need to type
`systemctl` or `journalctl`:

```bash
bot                # running? since when? on which commit?
bot logs           # follow the log, cleanly
bot logs 100       # last 100 lines
bot logs today
bot errors         # only warnings and failures
bot restart        # also: bot start / bot stop
bot version        # deployed commit vs origin/main
bot update         # manual pull + restart, when you cannot push
bot doctor         # check everything that usually goes wrong
```

`bot logs` strips journald's date, hostname and pid:

```
10:23:45  Leaderboard reposted with 8 team(s) across 2 message(s).
10:23:45    Removed 2 previous message(s).
10:33:47  Leaderboard reposted with 8 team(s) across 2 message(s).
```

`bot logs -v` keeps the full detail when you need it.

**`bot doctor`** is what to reach for when the board is not updating. It checks
the service state; that `.env` exists, holds the required keys, is readable by
the service account and *not* by everyone else; that `state.json` is writable;
that Discord and Google Sheets are reachable; whether the deployed commit has
drifted from `origin/main`; and whether anything errored in the last hour.

The service restarts automatically on crash (10s back-off) and starts on boot.
If it fails five times in a minute it gives up rather than hammering Discord's
API - `systemctl reset-failed ironclan-bot` clears that.

The script lives at `deploy/bot` in the repo, so it is version-controlled and
survives a rebuild of the VM.

---

## 2. The repo

Already done, committed alongside this document:

| File | Purpose |
| --- | --- |
| `deploy/ironclan-bot.service` | systemd unit — restart policy and sandboxing |
| `deploy/bootstrap.sh` | one-time server setup, idempotent |
| `deploy/bot` | the `bot` control command installed on the server |
| `.github/workflows/ci.yml` | tests on every push; deploy on `main` |
| `.github/workflows/leaderboard.yml` | **schedule removed** — manual fallback only |

The scheduled workflow had to go. With the server running its own timer, a
scheduled job would delete and repost the same messages every 10 minutes, and
the two would fight. It is kept as a manual trigger for when the server is down.

Nothing in the application code changed. `npm start` was always the
long-running entry point; it simply had nowhere to run before.

---

## 3. GitHub Actions

### Generate a deploy key

A **separate** key from your personal one, so it can be revoked without
locking you out. On your own machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/ironclan_deploy -N "" -C "github-actions-deploy"
```

Append the **public** half to the server:

```bash
ssh-copy-id -i ~/.ssh/ironclan_deploy.pub ubuntu@<SERVER_IP>
# or by hand:
cat ~/.ssh/ironclan_deploy.pub | ssh ubuntu@<SERVER_IP> 'cat >> ~/.ssh/authorized_keys'
```

**If you generated the key on the server itself** (rather than on your own
machine), you are already logged in, so skip `ssh` entirely - and do not use
`sudo`, which would run ssh as root and look for root's keys:

```bash
cat ~/.ssh/ironclan_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Then copy the **private** key into the GitHub secret and delete it from the
server - the server only ever needs the public half:

```bash
cat ~/.ssh/ironclan_deploy     # paste this into DEPLOY_SSH_KEY, then:
rm ~/.ssh/ironclan_deploy
```

Confirm it works before wiring up Actions:

```bash
ssh -i ~/.ssh/ironclan_deploy ubuntu@<SERVER_IP> 'sudo systemctl status ironclan-bot'
```

### Capture the host key

This pins the server's identity so the deploy cannot be silently redirected:

```bash
ssh-keyscan -H <SERVER_IP>
```

Copy the **whole output**, every line.

### Add four repository secrets

**Settings → Secrets and variables → Actions → Secrets → New repository secret**:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | the server's public IP |
| `DEPLOY_USER` | `ubuntu` (or whichever user you bootstrapped as) |
| `DEPLOY_SSH_KEY` | contents of `~/.ssh/ironclan_deploy` — the **private** key, including the `BEGIN`/`END` lines |
| `DEPLOY_KNOWN_HOSTS` | the full `ssh-keyscan` output |

Keep `BOT_TOKEN` / `SHEET_ID` / `DISCORD_CHANNEL_ID` too — the manual fallback
workflow still uses them. The *server* reads its own `.env`; the bot token is
never sent from Actions.

### What happens on push

1. **Tests** run on every push and pull request. A failure stops everything.
2. **Deploy** runs only on `main`, only after the tests pass, and never for a
   pull request — a fork PR must not be able to reach the server.
3. Over SSH: `git fetch` → `git reset --hard origin/main` → `npm ci --omit=dev`
   → `systemctl restart`.
4. It waits 25 seconds and checks the service is still running.
5. **If it is not, the deploy rolls itself back**: the commit deployed before
   this push is restored, dependencies reinstalled, and the service restarted.
   The board keeps running the last good version instead of staying down. The
   Actions run still goes red, with the failing log in the output.

So a push that crashes on boot costs you a red tick, not a dead leaderboard.
The only case needing hands is a rollback that *also* fails, which the log
says explicitly.

`git reset --hard` and never `git clean` — `state.json` is untracked and must
survive, or every deploy costs a round of rank arrows.

---

## Things worth knowing

**Oracle reclaims idle Always Free instances.** Oracle reserves the right to
reclaim Always Free compute that sits idle, and a Discord bot uses very little
CPU. If the instance disappears, that is why. Upgrading the account to
Pay As You Go — which costs nothing while you stay inside the Always Free
limits — removes the risk.

**Slash commands and the developer DM commands work**, since something is
finally online to answer them. DM the bot `-help` to see the developer list.
`npm start` re-registers them on boot. `/bingo-clear` still needs **2FA on the
bot owner's Discord account** — the server requires 2FA for moderation actions,
and that is an account setting, not a permission.

**`state.json` now lives on the server** at `/opt/ironclan-bot/state.json`.
Rank arrows and lead history persist properly across restarts for the first
time. It is not backed up; losing it costs one update's worth of arrows.

**Both the service and a manual Actions run can post.** Triggering the fallback
workflow while the server is up produces brief churn — the service will delete
its messages and repost on the next cycle. Harmless, just not useful.

---

## If it goes wrong

| Symptom | Where to look |
| --- | --- |
| Deploy fails at the secrets check | The step names the missing secret |
| Deploy fails on `ssh` with `Permission denied` | Public key not in the server's `authorized_keys`, or `DEPLOY_USER` is wrong |
| Deploy fails with `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` is stale — re-run `ssh-keyscan`. It changes if you rebuild the instance |
| `sudo: a password is required` | The sudoers rule did not install; re-run `bootstrap.sh` |
| `bot: command not found` | Re-run `bash /opt/ironclan-bot/deploy/bootstrap.sh` - the symlink is created there, so a server bootstrapped before `bot` existed will not have it |
| `bot logs` shows nothing | Log out and back in - bootstrap added you to the `systemd-journal` group and the shell needs a new session |
| Service active but no board | `journalctl -u ironclan-bot -n 50` — usually a bad token or a sheet that returned no teams |
| Board posted twice per cycle | The scheduled workflow is still enabled somewhere, or two instances are running |
