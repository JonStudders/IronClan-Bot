# Code review — September 2026

Findings from a fresh read of the whole repo. **None of these are applied yet** —
this is a to-do list, kept so the detail is not lost.

Each item records what is wrong, why it matters, and how it was verified, so it
can be picked up cold.

---

## 1. Points break silently once they pass 1,000

**Where:** `src/sheet.js`, `toNumberOrNull`

`public-google-sheets-parser` returns some cells as *formatted strings*, not
numbers. Verified against the live sheet:

    "Team EHB" = "0.00"   (string)
    "Team EHP" = 0        (number)

So the moment the points column carries a thousands separator, the value
arrives as `"1,234"`. `Number("1,234")` is `NaN`, which becomes `null`, which
renders as **0 Points** — for every team at once, with the sort collapsing
alongside it. It fails silently: the board looks plausible, just wrong.

`src/gainers.js` already solves this and `src/sheet.js` does not:

```js
// gainers.js — correct
Number(String(value).replace(/,/g, ''))
// sheet.js — breaks on "1,234"
Number(value)
```

**Fix:** one shared `toNumberOrNull`. See item 9 for where it should live.

**Priority: highest.** It is the only finding that will certainly produce a
wrong board, and it gives no warning when it does.

---

## 2. Ranks 4 and below show literal backticks

**Where:** `src/format.js`, `medal()`

The field name actually sent to Discord:

    "🥇 Team1 - Cap  NEW"
    "`#4` Team4 - Cap  NEW"     <- backticks are part of the string

Embed field **names** are rendered as plain text; markdown only works in field
*values*. So the podium looks right and every team below it likely shows
`` `#4` `` with the backticks visible.

**Verify first:** look at ranks 4–8 on the live board. If they show backticks,
the fix is deleting two characters.

---

## 3. Delete-then-post leaves a window with no board

**Where:** `src/poster.js`, `update()`

The update deletes the previous messages and then posts the new ones. If the
process dies or Discord errors in between, the channel has **no leaderboard**
until the next run — up to 10 minutes.

**Fix:** invert to post-then-delete. The failure mode becomes a brief duplicate
instead of an empty channel, and the existing cleanup removes duplicates on the
next run anyway. It also removes the visible flicker.

---

## 4. The bot can lose track of its own messages

**Where:** `src/poster.js`, `HISTORY_SCAN_LIMIT = 25`

Scanning the last 25 messages is now the *only* way the bot finds what to
delete. If 25+ messages are posted between runs, the previous board scrolls out
of the window and the bot posts a duplicate rather than replacing.

Related: `state.panelCount` is **written but never read**. It occupies the slot
where the message ids used to live.

**Fix:** persist the message ids again, delete by id, keep the history scan as a
fallback for when the state file is lost.

---

## 5. Nothing runs the tests automatically

There are 159 tests and no workflow runs them. A commit that breaks the board
reaches the channel unchallenged.

**Fix:** a CI job on push. *(Addressed by the deployment work — see
`docs/deployment-oracle.md`; the deploy is now gated on the tests passing.)*

---

## 6. Dead code (all verified)

| Where | What |
| --- | --- |
| `src/grid.js:12` | `GVIZ_PREFIX_PATTERN` — declared, never referenced |
| `src/poster.js:19` | `createPoster({ log })` — destructured, never used |
| `src/embed.js:24` | `formatPoints` — defined and exported, never called (the board uses `formatNumber`) |
| `src/state.js:16` | `panelCount` — write-only state |
| `grid.js` / `gainers.js` | `'Sheet returned no usable grid data.'` duplicated verbatim |

---

## 7. No linter

`devDependencies` is empty. ESLint with `no-unused-vars` would have found every
item in 6 without a human read-through.

---

## 8. `src/commands.js` — 250 lines that could not run

Slash commands need a live gateway connection. While the bot ran as one-shot
GitHub Actions jobs, nothing was ever online to answer them, so `commands.js`
plus its 121 lines of tests were maintained for a dead code path.

**Status: resolved by moving to a persistent host.** The commands work again
under `npm start`. Two caveats remain:

- They must be re-registered (`npm start` does this on boot).
- `/bingo-clear` still needs **2FA on the bot owner's Discord account**, because
  the server requires 2FA for moderation actions. Until then it reports that
  specific cause and deletes nothing.

---

## 9. Structure

- **Double sorting.** `bot.js` sorts teams for the state file; `embed.js` sorts
  them again for display. They agree only because both call `sortTeams` — an
  invariant held by coincidence. Sort once and pass it down.
- **Shared sheet helpers want their own module.** `gainers.js` imports
  `isSheetError` from `sheet.js`. `isSheetError`, `toNumberOrNull` and
  `toTrimmedString` belong in something like `src/cells.js` — which is also
  where the fix for item 1 lands naturally.
- **Two HTTP fetches per update.** The library reads the leaderboard; gviz reads
  the gainer tables. The gviz grid already contains both, so one fetch could
  serve both — at the cost of rewriting the leaderboard parser against the grid.

---

## 10. Smaller things

- `config.endTimestamp` is not validated as numeric. A typo produces broken
  markup in the embed instead of an error at startup.
- `HISTORY_SCAN_LIMIT` is 25 in `poster.js` but `CLEAR_SCAN_LIMIT` is 100 in
  `commands.js`. Not wrong, but the difference is unexplained.

---

## Suggested order

1. Item 1 — shared `toNumberOrNull` (silent wrong data)
2. Item 3 — post-then-delete (small, removes a real gap)
3. Item 2 — backticks, once confirmed visually
4. Item 6 — dead code, plus item 7 to stop it coming back
5. Item 4 — persist message ids
6. Item 9 — structural tidying, only if the file keeps growing
