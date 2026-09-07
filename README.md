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

The three **Top X gainer per team** tables lower down the same tab are read
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
npm install   # requires Node 18 or newer
cp .env.example .env   # then fill it in
npm start
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

The leading individual players for each tracked metric, in a code block so the
columns align. Top 3 per category by default (`gainersRows`), or turn the whole
message off with `gainers=off`.

    EHB gained
    1. FFA        Big Bald Cunts             73.2
    2. J aybo     Boats and Hoes             68.5
    3. IM AlbinP  Pot Arams Winning Gooners  66.2

    EHP gained
    1. IronLebanese  Zappers Aint Playin    66.9
    ...

Names are shown in full: columns size themselves to the longest entry rather
than truncating, since an abbreviated team name is unreadable.

It carries no "Last Updated" line of its own, since the leaderboard sits
directly above it and has one.

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

Each message the bot maintains is a "panel", identified by its embed title. The
panels are kept together at the bottom of the channel, in order. Any embed
message of the bot's whose title matches no current panel is a leftover — from
a retired panel, or a crash mid-repost — and is deleted, so the channel
converges on exactly the configured set.

- **Undisturbed** - the message is edited in place. Discord does not notify the
  channel for an edit, so updates are silent.
- **Someone posted below it** - the board would be stranded up the scrollback,
  so the bot deletes its own message and posts a fresh one underneath. This
  does notify the channel.
The bot only ever deletes messages it authored itself; `deleteOwnMessage`
throws rather than touching anyone else's post.

### Permissions

| Permission | Needed for |
| --- | --- |
| View Channel / Send Messages | Posting the board |
| Read Message History | Finding its own board after a restart, and noticing posts below it |
| Manage Messages | `/bingo-clear` only - deleting other people's messages |

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
    src/gainers.js      Locates and joins the three top-gainer tables
    src/gainersEmbed.js Renders the top-gainers embed
    src/poster.js       Owns the bot's messages (post once, then edit)
    src/scheduler.js    Repeating run loop with retry-on-failure backoff
    src/state.js        Persists message id, previous ranks and lead history
    src/commands.js     Slash commands (/bingo-lead, /bingo-clear)
    test/               Unit tests (`node --test`)

## Tests

```
npm test
```

Runs on Node's built-in test runner, no extra dependencies. The Discord client
and the sheet are injected into `poster`/`scheduler`, so the suite covers the
real logic without network access or a bot token.

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
