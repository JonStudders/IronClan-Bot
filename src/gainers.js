'use strict';

const { isSheetError } = require('./sheet');

/**
 * The "Top X gainer per team" tables that sit side by side below the
 * leaderboard on the same tab.
 *
 * Their columns are found by reading the sheet's own labels rather than by
 * hardcoded offsets, so inserting a column between the blocks does not
 * silently pair the wrong player with the wrong team.
 *
 * The sheet also carries a Top XP gainer table, which is deliberately not
 * listed: adding it back is one line here.
 */
const METRICS = [
  { key: 'ehb', label: 'EHB', pattern: /top\s+ehb\s+gainer/i },
  { key: 'ehp', label: 'EHP', pattern: /top\s+ehp\s+gainer/i },
];

const TEAM_HEADER = /^team\s*name$/i;
const PLAYER_HEADER = /^player$/i;

function cellAt(grid, row, col) {
  return grid[row]?.[col] ?? '';
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '' || isSheetError(value)) return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Locates one metric's block: the section heading, then the Team Name and
 * Player columns from the header row beneath it, then the value column as the
 * first numeric cell to the right of Player.
 */
function findBlock(grid, metric) {
  for (let row = 0; row < grid.length; row++) {
    const col = grid[row].findIndex((cell) => metric.pattern.test(cell));
    if (col === -1) continue;

    const headerRow = row + 1;
    const header = grid[headerRow] ?? [];
    if (!TEAM_HEADER.test(header[col] ?? '')) continue;

    const playerCol = header.findIndex((cell, i) => i > col && PLAYER_HEADER.test(cell));
    if (playerCol === -1) continue;

    // The value column carries no header, so find it from the first data row.
    const firstDataRow = headerRow + 1;
    const dataRow = grid[firstDataRow] ?? [];
    let valueCol = -1;
    for (let i = playerCol + 1; i < dataRow.length; i++) {
      if (dataRow[i] !== '') { valueCol = i; break; }
    }
    if (valueCol === -1) continue;

    return { ...metric, teamCol: col, playerCol, valueCol, firstDataRow };
  }
  return null;
}

/**
 * Reads one block's rows, stopping at the first blank team name.
 *
 * A row whose team cell is a sheet error is skipped rather than treated as the
 * end of the table: a single broken formula at the top would otherwise hide
 * every team below it.
 */
function readBlockRows(grid, block) {
  const rows = [];
  for (let row = block.firstDataRow; row < grid.length; row++) {
    const team = cellAt(grid, row, block.teamCol);
    if (team === '') break;
    if (isSheetError(team)) continue;
    rows.push({
      team,
      player: isSheetError(cellAt(grid, row, block.playerCol))
        ? ''
        : cellAt(grid, row, block.playerCol),
      value: toNumberOrNull(cellAt(grid, row, block.valueCol)),
    });
  }
  return rows;
}

/**
 * Joins the three blocks into one row per team.
 *
 * Teams are matched by name rather than by row position: the blocks happen to
 * list teams in the same order today, but if the sheet ever sorts each block
 * by its own value, position matching would pair the wrong player with the
 * wrong team. Team order follows the EHB block, then any team only the other
 * blocks mention.
 */
function parseGainers(grid) {
  if (!Array.isArray(grid)) {
    throw new Error('Sheet returned no usable grid data.');
  }

  const blocks = METRICS.map((metric) => ({ metric, block: findBlock(grid, metric) }))
    .filter(({ block }) => block !== null);

  if (blocks.length === 0) return [];

  const byTeam = new Map();
  const order = [];

  for (const { metric, block } of blocks) {
    for (const row of readBlockRows(grid, block)) {
      if (!byTeam.has(row.team)) {
        byTeam.set(row.team, { team: row.team });
        order.push(row.team);
      }
      byTeam.get(row.team)[metric.key] = { player: row.player, value: row.value };
    }
  }

  return order.map((team) => byTeam.get(team));
}

/** Which metrics were actually found, so the renderer only shows real columns. */
function availableMetrics(grid) {
  return METRICS.filter((metric) => findBlock(grid, metric) !== null);
}

module.exports = { parseGainers, availableMetrics, findBlock, readBlockRows, METRICS };
