# Iron Clan Discord Bot

## Bingo Leaderboard

Maintains a leaderboard embed in a designated channel, pulling team data from a public
Google Sheet. The bot posts once and then **edits that same message** on each refresh,
so the channel isn't notified every update.

![enter image description here](https://i.imgur.com/eDov723.png)

Spreadsheet example:

![enter image description here](https://i.imgur.com/7z2WVxU.png)

The sheet is read by column header, not by row position, so re-ordering rows or
adding spacer rows is safe. Surrounding whitespace in headers is ignored.

| Column | Notes |
| --- | --- |
| `Total Points (Bonus Included)` | Used for sorting. Rounded for display. Also accepts `Total Points` or `Points` from older bingos |
| `Team Name` | Required. A row without one is not a team |
| `Team Captain` | Optional |
| `Team Co-Captain` | Optional; absent from the Autumn 2026 sheet |
| `Board Completion %` | A fraction, e.g. `0.45` renders as `45.00%`. Breaks point ties |
| `Bonus Points` | Parsed but not displayed, since Total Points already includes it |

A row counts as a team when it has a team name **and** either sits at a
numbered position or carries the points column. That keeps the other content on
the tab (the WOM link row) off the board, while still showing a team whose
points formula is momentarily blank rather than silently dropping it.

The **Top X gainer per team** tables lower down the same tab are read
separately, for the gainers message. They sit under blank header cells, which
`public-google-sheets-parser` discards, so they are read from the raw grid via
Google's gviz endpoint instead (`src/grid.js`). Their columns are located from
the sheet's own `Team Name` / `Player` labels rather than fixed offsets, and
the three blocks are joined on team name — so re-ordering or inserting a column
cannot pair the wrong player with the wrong team.

Cells the sheet has not resolved (`#N/A`, `#REF!`, and the other Google Sheets
error literals) are treated as missing and displayed as a zero score, so a
board that has not started yet reads as all-zero rather than all-error. The
number of unresolved teams is logged on each update so genuine formula
breakage is still visible.

## Setup

```
npm install            # requires Node 18 or newer
cp .env.example .env   # then fill it in
npm run update         # one update, then exit  (what CI runs)
npm start              # stay running and update on a timer
```

## Messages

The bot maintains two messages, in this order, and keeps them at the bottom of
the channel.

### 1. The leaderboard

One embed, edited in place. Each team shows a medal or rank number, its captain,
its movement since the previous update, points, a completion bar and the gap to
the team above.

    🥇 Llama - A Llama  ▲2
    1,240 pts · ████████░░ 78.00% · in the lead

    🥈 Fetired - Fetired & Seaman Pend  ▼1
    1,180 pts · ███████░░░ 71.00% · 60 behind

Rank movement reads `▲2` / `▼1` / `─` for held position, and `NEW` for a team
the bot has not seen before.

### 2. Top gainers

The leading individual players for each tracked metric - currently **EHB and
EHP** - in a code block. Top 3 per category by default (`gainersRows`), or turn
the whole message off with `gainers=off`.

The sheet also carries a Top XP gainer table. It is deliberately not shown;
tracking it again is one line in `METRICS` in `src/gainers.js`.

    EHB gained
    1. FFA | Big Bald Cunts | 73.2
    2. J aybo | Boats and Hoes | 68.5
    3. IM AlbinP | Pot Arams Winning Gooners | 66.2

    EHP gained
    1. IronLebanese | Zappers Aint Playin | 66.9
    2. Neurron | Euskadi Ta Askatasuna | 58.6
    3. Evenfisher1 | Boats and Hoes | 53.9

Names are shown in full rather than truncated, and fields are pipe-separated
rather than padded into columns - team names vary too much in length for
columns to line up without leaving a large gap after every short name.

It carries no "Last Updated" line and no footer of its own, since the
leaderboard sits directly above it and has both.

**On the candidate pool:** the sheet publishes the top gainer *per team*, so
these are the best players among each team's own leader — not a true clan-wide
ranking. If the two highest gainers in the clan play for the same team, only
one of them can appear. Showing genuine clan-wide top threes would need
per-player data the sheet does not currently expose. The footer says
`one entry per team` to make this explicit.

## Slash commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/bingo-lead` | Anyone | Posts who is currently leading and when the lead last changed |
| `/bingo-clear` | Manage Messages | Deletes every message in the channel except the boards and pinned messages |

`/bingo-clear` is destructive, so it is gated three ways: the command requires
Manage Messages, the handler re-checks the caller, and the caller must confirm
on a button before anything is deleted. Deleting other people's messages needs
Manage Messages - and if the server requires 2FA for moderation, the bot
owner's account needs 2FA enabled too.

Commands are registered per-guild on startup, which takes effect immediately.
This needs `applicationId` and `discordServerId` in `.env`; without them the
leaderboard still runs and registration is skipped with a warning.

## State file

`state.json` (path configurable, gitignored) holds the board message id, the
previous ranking and the lead history. It is what makes rank arrows survive a
restart. Losing it costs one update's worth of arrows, never a crash - a
missing or corrupt file falls back to empty state.

## Message behaviour

On every update the bot deletes the messages it posted last time and posts
fresh ones. The board is therefore always the newest thing in the channel, no
matter what has been said in between.

The trade-off is that **every update notifies the channel**. Mute the channel
if that is noisy. (Editing in place is silent, but leaves the board stranded up
the scrollback as soon as anyone posts below it.)

Clearing out the previous messages also cleans up after a retired panel or a
crashed run, so the channel converges on exactly one set.

The bot only ever deletes messages it authored itself; `deleteOwnMessage`
throws rather than touching anyone else's post. A message of the bot's without
an embed is not treated as a panel and is left alone.

### Permissions

| Permission | Needed for |
| --- | --- |
| View Channel / Send Messages | Posting the board |
| Read Message History | Finding the messages it posted last time, so they can be removed |
| Manage Messages | Not needed for the board - deleting its own messages requires no extra permission |

Deleting its *own* board needs no special permission, so the leaderboard works
without Manage Messages. If the server requires two-factor authentication for
moderation, Manage Messages actions additionally require **2FA on the bot
owner's Discord account** - without it `/bingo-clear` reports that specific
cause and deletes nothing.

## Project layout

    index.js            Entry point: wires the pieces together and owns the lifecycle
    src/config.js       Reads and validates settings from the environment
    src/sheet.js        Fetches the sheet, parses rows into teams, sorts them
    src/format.js       Medals, progress bars, gaps and rank-movement arrows
    src/embed.js        Renders the leaderboard embed
    src/grid.js         Reads a tab as a raw grid (for the blank-header tables)
    src/gainers.js      Locates and joins the top-gainer tables
    src/gainersEmbed.js Renders the top-gainers embed
    src/poster.js       Owns the bot's messages (post once, then edit)
    src/bot.js          Assembles the parts, shared by both entry points
    src/scheduler.js    Repeating run loop with retry-on-failure backoff
    src/state.js        Persists message id, previous ranks and lead history
    src/commands.js     Slash commands (/bingo-lead, /bingo-clear)
    scripts/            One-shot entry points (manual update, command cleanup)
    deploy/             systemd unit, bootstrap script, and the `bot` command
    docs/               Deployment guide and the open code-review findings
    test/               Unit tests (`node --test`)

## Tests

```
npm test
```

Runs on Node's built-in test runner, no extra dependencies. The Discord client
and the sheet are injected into `poster`/`scheduler`, so the suite covers the
real logic without network access or a bot token.

## Deployment

The bot runs as a **persistent systemd service on an Oracle Cloud Always Free
VM**, redeployed by GitHub Actions on every push to `main`.

Full instructions — server, repo and Actions — are in
**[docs/deployment-oracle.md](docs/deployment-oracle.md)**.

The short version:

    # on the server, once
    curl -fsSL https://raw.githubusercontent.com/JonStudders/IronClan-Bot/main/deploy/bootstrap.sh | bash
    nano /opt/ironclan-bot/.env      # fill in botToken, sheetId, discordChannelId
    sudo systemctl start ironclan-bot

Then add four repository secrets — `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` — and every push to `main` runs the
tests and, if they pass, redeploys.

The bot makes only **outbound** connections, so no inbound port beyond SSH
needs opening.

On the server, everything is driven by one command:

    bot            # status
    bot logs       # follow the log, readably
    bot restart
    bot doctor     # check config, permissions, connectivity and drift

A push that crashes on boot **rolls itself back** to the previous commit, so a
bad deploy costs a red tick rather than a dead leaderboard.

### Why persistent rather than scheduled

It previously ran as a scheduled GitHub Actions job. Running continuously is
better on three counts: the update timer is punctual rather than best-effort,
`state.json` lives on disk so rank arrows are reliable, and **slash commands
work**, since they need a live gateway connection.

`.github/workflows/leaderboard.yml` is kept as a **manual** fallback for when
the server is down. Its schedule is removed deliberately — with the service
running its own timer, a scheduled job would fight it for the same messages.

**Vercel cannot host this.** Vercel runs serverless functions that must return
and exit; `npm start` deliberately stays alive, so a deploy hangs until it
times out. That is a mismatch of models, not a configuration problem.

## Known issues

Open findings from a full review live in
**[docs/code-review.md](docs/code-review.md)** — most notably that points will
be misread if the sheet ever formats them with a thousands separator.

## Configuration

All settings live in `.env` — see [.env.example](.env.example) for the full list with
defaults. Only three are required:

    botToken=
    sheetId=
    discordChannelId=

Everything else (title, end date, refresh interval, embed colour, thumbnail, public
leaderboard link) is optional and configurable, so running a new bingo is a config
change rather than a code change.

If the sheet or Discord API fails, the update is retried after `retryIntervalMinutes`
instead of the normal interval.
