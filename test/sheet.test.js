'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseTeams, sortTeams, isSheetError } = require('../src/sheet');

/**
 * Mirrors the real 'Leaderboard' tab: the leaderboard table on top, then a
 * WOM link row and a second "Top EHB gainer per team" table underneath that
 * reuse the first column. Headers carry the trailing spaces the real sheet has.
 */
const POINTS = 'Total Points (Bonus Included) ';
const POSITION = 'Iron Clan Bingo Leaderboard - Autumn 2026 Position ';

const REAL_SHAPE_ROWS = [
  { [POSITION]: '1', 'Team Name ': 'Llama', [POINTS]: 120, 'Bonus Points ': 0, 'Team Captain ': 'A Llama', 'Board Completion % ': 0.5 },
  { [POSITION]: '2', 'Team Name ': 'Fetired', [POINTS]: 300, 'Bonus Points ': 10, 'Team Captain ': 'Fetired', 'Board Completion % ': 0.9 },
  { [POSITION]: '3', 'Team Name ': 'Pew', [POINTS]: '#N/A', 'Bonus Points ': 0, 'Team Captain ': 'CAPTAIN PEWW', 'Board Completion % ': '#N/A' },
  // Rows below here belong to other tables on the same tab.
  { [POSITION]: 'Link to WOM:', 'Team Name ': 'https://wiseoldman.net/groups/1234' },
  { [POSITION]: 'Top EHB gainer per team' },
  { [POSITION]: 'Team Name', 'Team Name ': undefined, 'Team EHB ': 'EHB' },
  { [POSITION]: 'Llama', 'Team EHB ': '#N/A' },
];

test('reads the real "Total Points (Bonus Included)" header', () => {
  const [llama] = parseTeams(REAL_SHAPE_ROWS);
  assert.equal(llama.teamName, 'Llama');
  assert.equal(llama.points, 120);
  assert.equal(llama.completion, 0.5);
  assert.equal(llama.captain, 'A Llama');
});

test('still reads the older "Points" header from previous bingos', () => {
  const [team] = parseTeams([{ 'Team Name ': 'Alpha', 'Points ': 42, 'Board Completion % ': 0.25 }]);
  assert.equal(team.points, 42);
  assert.equal(team.completion, 0.25);
});

test('headers are matched regardless of surrounding whitespace', () => {
  const [team] = parseTeams([{ 'Team Name': 'Alpha', 'Total Points (Bonus Included)': 5 }]);
  assert.equal(team.teamName, 'Alpha');
  assert.equal(team.points, 5);
});

test('only the leaderboard table is parsed, not the tables below it', () => {
  const teams = parseTeams(REAL_SHAPE_ROWS);
  assert.deepEqual(teams.map((t) => t.teamName), ['Llama', 'Fetired', 'Pew']);
});

test('the WOM link row is not mistaken for a team', () => {
  const teams = parseTeams(REAL_SHAPE_ROWS);
  assert.ok(!teams.some((t) => t.teamName.includes('wiseoldman')));
});

test('a team is only a team if the row carries the points column', () => {
  // Same team name, but no points column: belongs to another table.
  assert.equal(parseTeams([{ 'Team Name ': 'Llama', 'Team EHB ': 5 }]).length, 0);
});

test('#N/A becomes null rather than NaN', () => {
  const pew = parseTeams(REAL_SHAPE_ROWS).find((t) => t.teamName === 'Pew');
  assert.equal(pew.points, null);
  assert.equal(pew.completion, null);
});

test('every Google Sheets error literal is recognised', () => {
  for (const err of ['#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!', '#ERROR!']) {
    assert.ok(isSheetError(err), err);
    assert.equal(parseTeams([{ 'Team Name ': 'A', 'Points ': err }])[0].points, null, err);
  }
  assert.ok(!isSheetError('120'));
  assert.ok(!isSheetError('Llama'));
});

test('a sheet error in a text cell becomes empty, not the literal "#N/A"', () => {
  const [team] = parseTeams([{ 'Team Name ': 'Alpha', 'Points ': 1, 'Team Captain ': '#N/A' }]);
  assert.equal(team.captain, '');
});

test('the co-captain column is optional and absent on the current sheet', () => {
  const [llama] = parseTeams(REAL_SHAPE_ROWS);
  assert.equal(llama.coCaptain, '');
});

test('the co-captain column is still read when present', () => {
  const [team] = parseTeams([{ 'Team Name ': 'A', 'Points ': 1, 'Team Captain ': 'C', 'Team Co-Captain ': 'CC' }]);
  assert.equal(team.coCaptain, 'CC');
});

test('blank and whitespace-only team names are excluded', () => {
  assert.equal(parseTeams([{ 'Team Name ': '   ', 'Points ': 1 }]).length, 0);
  assert.equal(parseTeams([{ 'Team Name ': '', 'Points ': 1 }]).length, 0);
});

test('spacer rows inside the leaderboard do not truncate it', () => {
  const rows = [
    { 'Team Name ': 'A', 'Points ': 3 },
    { 'Team Name ': '', 'Points ': '' },
    { 'Team Name ': 'B', 'Points ': 1 },
  ];
  assert.deepEqual(parseTeams(rows).map((t) => t.teamName), ['A', 'B']);
});

test('zero is preserved and not confused with missing', () => {
  const [team] = parseTeams([{ 'Team Name ': 'A', 'Points ': 0, 'Board Completion % ': 0 }]);
  assert.equal(team.points, 0);
  assert.equal(team.completion, 0);
});

test('numeric strings from the sheet are coerced', () => {
  assert.equal(parseTeams([{ 'Team Name ': 'A', 'Points ': '42' }])[0].points, 42);
});

test('non-array input throws a diagnosable error', () => {
  assert.throws(() => parseTeams(undefined), /no usable data/);
  assert.throws(() => parseTeams(null), /no usable data/);
});

test('teams sort by points descending', () => {
  const names = sortTeams(parseTeams(REAL_SHAPE_ROWS)).map((t) => t.teamName);
  assert.deepEqual(names, ['Fetired', 'Llama', 'Pew']);
});

test('point ties are broken by board completion', () => {
  const rows = [
    { 'Team Name ': 'Low', 'Points ': 300, 'Board Completion % ': 0.9 },
    { 'Team Name ': 'High', 'Points ': 300, 'Board Completion % ': 0.95 },
  ];
  assert.deepEqual(sortTeams(parseTeams(rows)).map((t) => t.teamName), ['High', 'Low']);
});

test('teams with unresolved points sort last', () => {
  const names = sortTeams(parseTeams(REAL_SHAPE_ROWS)).map((t) => t.teamName);
  assert.equal(names.at(-1), 'Pew');
});

test('an all-unresolved sheet keeps the order the sheet gave', () => {
  const rows = ['Llama', 'Fetired', 'Bamblebog'].map((n) => ({ 'Team Name ': n, 'Points ': '#N/A' }));
  assert.deepEqual(sortTeams(parseTeams(rows)).map((t) => t.teamName), ['Llama', 'Fetired', 'Bamblebog']);
});

test('sortTeams does not mutate its input', () => {
  const teams = parseTeams(REAL_SHAPE_ROWS);
  const before = teams.map((t) => t.teamName);
  sortTeams(teams);
  assert.deepEqual(teams.map((t) => t.teamName), before);
});

test('a team whose points cell is momentarily blank still appears', () => {
  // Seen live: a mid-edit sheet left one team with no Total Points value.
  const rows = [
    { [POSITION]: '1', 'Team Name ': 'Llama', 'Bonus Points ': 0, 'Team Captain ': 'A Llama' },
    { [POSITION]: '2', 'Team Name ': 'Fetired', [POINTS]: 300, 'Team Captain ': 'Fetired' },
  ];
  const teams = parseTeams(rows);
  assert.deepEqual(teams.map((t) => t.teamName), ['Llama', 'Fetired']);
  assert.equal(teams[0].points, null, 'and shows as zero rather than vanishing');
});

test('the WOM link row is still excluded despite having a team name', () => {
  const rows = [{ [POSITION]: 'Link to WOM:', 'Team Name ': 'https://wiseoldman.net/groups/1' }];
  assert.equal(parseTeams(rows).length, 0);
});

test('a row with a broken team name formula is excluded', () => {
  const rows = [{ [POSITION]: '2', 'Team Name ': '#REF!', [POINTS]: '#REF!' }];
  assert.equal(parseTeams(rows).length, 0);
});
