'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseGainers, availableMetrics, findBlock, METRICS } = require('../src/gainers');
const { toGrid, unwrapGvizResponse, cellText } = require('../src/grid');

/**
 * Mirrors the real tab: the three gainer tables sit side by side under the
 * leaderboard, at columns 1, 11 and 20, with Player three columns right of
 * Team Name and the value three columns right of that.
 */
function blankRow() {
  return Array.from({ length: 31 }, () => '');
}

function realShapeGrid() {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(blankRow()); // leaderboard rows above

  const section = blankRow();
  section[1] = 'Top EHB gainer per team';
  section[11] = 'Top EHP gainer per team';
  section[20] = 'Top XP gainer per team';
  rows.push(section);

  const header = blankRow();
  for (const col of [1, 11, 20]) header[col] = 'Team Name';
  for (const col of [4, 14, 23]) header[col] = 'Player';
  rows.push(header);

  const data = [
    ['Llama', 'A Llama', '12.40', 'Llamaboy', '9.80', 'A Llama', '12300000'],
    ['Fetired', 'Fetired', '11.10', 'Fetired', '8.20', 'Fetired', '9800000'],
    ['C8B', 'C8B', '8.20', 'C8B', '6.40', 'Kappadonn', '7400000'],
  ];
  for (const [team, ehbP, ehb, ehpP, ehp, xpP, xp] of data) {
    const row = blankRow();
    row[1] = team; row[4] = ehbP; row[7] = ehb;
    row[11] = team; row[14] = ehpP; row[17] = ehp;
    row[20] = team; row[23] = xpP; row[26] = xp;
    rows.push(row);
  }
  return rows;
}

// --- Grid parsing ------------------------------------------------------------

test('a gviz response is unwrapped from its JavaScript callback', () => {
  const body = "/*O_o*/\ngoogle.visualization.Query.setResponse({\"table\":{\"cols\":[],\"rows\":[]}});";
  assert.deepEqual(unwrapGvizResponse(body), { table: { cols: [], rows: [] } });
});

test('an unparseable response is reported clearly', () => {
  assert.throws(() => unwrapGvizResponse('<html>Not found</html>'), /is the sheet public/);
});

test('the formatted cell value is preferred over the raw one', () => {
  assert.equal(cellText({ v: 0, f: '0.00' }), '0.00');
  assert.equal(cellText({ v: 5 }), '5');
  assert.equal(cellText(null), '');
});

test('rows are padded to a rectangular grid', () => {
  const grid = toGrid({ table: { cols: [{}, {}, {}], rows: [{ c: [{ v: 'a' }] }, { c: [] }] } });
  assert.equal(grid.length, 2);
  assert.ok(grid.every((row) => row.length === 3), 'every row should be the same width');
  assert.deepEqual(grid[0], ['a', '', '']);
});

// --- Locating the blocks -----------------------------------------------------

test('all three metric blocks are found on the real sheet shape', () => {
  assert.deepEqual(availableMetrics(realShapeGrid()).map((m) => m.key), ['ehb', 'ehp', 'xp']);
});

test('block columns are read from the sheet labels, not hardcoded', () => {
  const block = findBlock(realShapeGrid(), METRICS[0]);
  assert.equal(block.teamCol, 1);
  assert.equal(block.playerCol, 4);
  assert.equal(block.valueCol, 7);
});

test('inserting a column between Player and the value is tolerated', () => {
  const grid = realShapeGrid();
  // Blank the usual value column; the value now sits further right.
  for (let row = 10; row < grid.length; row++) {
    if (grid[row][7]) { grid[row][8] = grid[row][7]; grid[row][7] = ''; }
  }
  const block = findBlock(grid, METRICS[0]);
  assert.equal(block.valueCol, 8, 'the value column should be found by content');
});

test('a missing metric block is simply absent, not an error', () => {
  const grid = realShapeGrid();
  grid[8][20] = ''; // remove the XP section heading
  assert.deepEqual(availableMetrics(grid).map((m) => m.key), ['ehb', 'ehp']);
});

// --- Joining -----------------------------------------------------------------

test('teams carry a player and value for every metric', () => {
  const [llama] = parseGainers(realShapeGrid());
  assert.equal(llama.team, 'Llama');
  assert.deepEqual(llama.ehb, { player: 'A Llama', value: 12.4 });
  assert.deepEqual(llama.ehp, { player: 'Llamaboy', value: 9.8 });
  assert.deepEqual(llama.xp, { player: 'A Llama', value: 12300000 });
});

test('every team in the block is returned, in sheet order', () => {
  assert.deepEqual(parseGainers(realShapeGrid()).map((r) => r.team), ['Llama', 'Fetired', 'C8B']);
});

test('blocks are joined by team name, not by row position', () => {
  const grid = realShapeGrid();
  // Reverse only the XP block, as if the sheet sorted it by its own value.
  const xpRows = [[20, 23, 26]];
  const teams = ['Llama', 'Fetired', 'C8B'];
  const players = ['A Llama', 'Fetired', 'Kappadonn'];
  const values = ['12300000', '9800000', '7400000'];
  for (let i = 0; i < 3; i++) {
    const row = grid[10 + i];
    const [t, p, v] = xpRows[0];
    row[t] = teams[2 - i]; row[p] = players[2 - i]; row[v] = values[2 - i];
  }

  const parsed = parseGainers(grid);
  const c8b = parsed.find((r) => r.team === 'C8B');
  assert.equal(c8b.xp.player, 'Kappadonn', 'C8B must keep its own XP gainer');
  assert.equal(c8b.ehb.player, 'C8B');
});

test('the block stops at the first row without a team name', () => {
  const grid = realShapeGrid();
  grid[11][1] = ''; // blank the second EHB row
  const parsed = parseGainers(grid);
  assert.equal(parsed.find((r) => r.team === 'Fetired').ehb, undefined);
});

test('sheet errors become null values and blank players', () => {
  const grid = realShapeGrid();
  grid[10][7] = '#N/A';
  grid[10][4] = '#N/A';
  const [llama] = parseGainers(grid);
  assert.equal(llama.ehb.value, null);
  assert.equal(llama.ehb.player, '');
});

test('thousands separators in the sheet are parsed', () => {
  const grid = realShapeGrid();
  grid[10][26] = '12,300,000';
  const [llama] = parseGainers(grid);
  assert.equal(llama.xp.value, 12300000);
});

test('a grid with no gainer tables returns nothing rather than throwing', () => {
  assert.deepEqual(parseGainers([blankRow(), blankRow()]), []);
});

test('non-grid input throws a diagnosable error', () => {
  assert.throws(() => parseGainers(undefined), /no usable grid data/);
});

test('a broken row does not truncate the rest of the block', () => {
  // Seen live: the first gainer row was #REF! and hid all eight teams.
  const grid = realShapeGrid();
  const broken = blankRow();
  broken[1] = '#REF!'; broken[4] = '#N/A';
  broken[11] = '#REF!'; broken[14] = '#N/A';
  broken[20] = '#REF!'; broken[23] = '#N/A';
  grid.splice(10, 0, broken); // insert as the first data row

  const parsed = parseGainers(grid);
  assert.deepEqual(parsed.map((r) => r.team), ['Llama', 'Fetired', 'C8B']);
});

test('a blank team name still ends the block', () => {
  const grid = realShapeGrid();
  grid[11][1] = '';
  const ehbTeams = parseGainers(grid).filter((r) => r.ehb).map((r) => r.team);
  assert.deepEqual(ehbTeams, ['Llama']);
});
