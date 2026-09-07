'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { buildEmbed, formatPoints, formatPercentage } = require('../src/embed');

const FIXED_NOW = 1_700_000_000_000; // deterministic "Last Updated"

const config = loadConfig({
  botToken: 't',
  sheetId: 's',
  discordChannelId: 'c',
  bingoTitle: 'Iron Clan - Test Bingo',
  leaderboardUrl: 'https://example.com/board',
  bingoEndTimestamp: '1790539200',
  updateIntervalMinutes: '10',
});

const teams = [
  { teamName: 'Alpha', captain: 'Cap1', coCaptain: 'Co1', points: 120.4, completion: 0.5 },
  { teamName: 'Bravo', captain: 'Cap2', coCaptain: 'Co2', points: 300, completion: 0.9 },
  { teamName: 'Solo', captain: 'Cap4', coCaptain: '', points: null, completion: null },
];

const PREVIOUS = { Alpha: 1, Bravo: 2, Solo: 3 };

// --- Number formatting -------------------------------------------------------

test('points are rounded for display', () => {
  assert.equal(formatPoints(120.4), '120 Points');
  assert.equal(formatPoints(120.6), '121 Points');
});

test('unresolved points render as zero, not as an error', () => {
  assert.equal(formatPoints(null), '0 Points');
  assert.equal(formatPoints(undefined), '0 Points');
});

test('completion renders as a two-decimal percentage', () => {
  assert.equal(formatPercentage(0.9), '90.00%');
  assert.equal(formatPercentage(0), '0.00%');
  assert.equal(formatPercentage(null), '0.00%');
});

// --- Description and chrome --------------------------------------------------

test('description uses relative timestamps', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.match(data.description, /Public Leaderboard: https:\/\/example\.com\/board/);
  assert.match(data.description, /Ends: <t:1790539200:R>/);
  assert.match(data.description, /Last Updated: <t:1700000000:R>/);
});

test('carries the title, colour and credit', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.equal(data.title, 'Iron Clan - Test Bingo');
  assert.equal(data.color, 0x6B8E23);
  assert.match(data.footer.text, /Made by: BlancoIron/);
  assert.match(data.footer.text, /every 10 minutes/);
});

test('the footer no longer advertises a layout', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.ok(!data.footer.text.includes('Layout'));
});

test('optional description lines are omitted when unset', () => {
  const bare = loadConfig({ botToken: 't', sheetId: 's', discordChannelId: 'c' });
  const { data } = buildEmbed(teams, bare, FIXED_NOW, PREVIOUS);
  assert.ok(!data.description.includes('Public Leaderboard'));
  assert.ok(!data.description.includes('Ends:'));
  assert.match(data.description, /Last Updated:/);
});

test('thumbnail is only set when configured', () => {
  assert.equal(buildEmbed(teams, config, FIXED_NOW, PREVIOUS).data.thumbnail, undefined);
  const withThumb = loadConfig({
    botToken: 't', sheetId: 's', discordChannelId: 'c', thumbnailUrl: 'https://i.imgur.com/x.png',
  });
  assert.equal(buildEmbed(teams, withThumb, FIXED_NOW, {}).data.thumbnail.url, 'https://i.imgur.com/x.png');
});

// --- The board itself --------------------------------------------------------

test('one field per team, highest points first', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.equal(data.fields.length, 3);
  assert.match(data.fields[0].name, /Bravo/);
  assert.match(data.fields[1].name, /Alpha/);
  assert.match(data.fields[2].name, /Solo/);
});

test('the podium gets medals', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.ok(data.fields[0].name.startsWith('🥇'));
  assert.ok(data.fields[1].name.startsWith('🥈'));
  assert.ok(data.fields[2].name.startsWith('🥉'));
});

test('teams below the podium get a rank number', () => {
  const four = [...teams, { teamName: 'Delta', captain: 'C', coCaptain: '', points: -1, completion: 0 }];
  const { data } = buildEmbed(four, config, FIXED_NOW, {});
  assert.match(data.fields[3].name, /#4/);
});

test('rank movement arrows reflect the previous update', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.match(data.fields[0].name, /▲1/, 'Bravo climbed from 2nd to 1st');
  assert.match(data.fields[1].name, /▼1/, 'Alpha dropped from 1st to 2nd');
  assert.match(data.fields[2].name, /─/, 'Solo held 3rd');
});

test('a team seen for the first time is marked NEW', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, {});
  assert.ok(data.fields.every((f) => f.name.includes('NEW')));
});

test('each team shows points, a progress bar and the gap', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.match(data.fields[0].value, /\*\*300\*\* pts/);
  assert.match(data.fields[0].value, /[█░]{10}/);
  assert.match(data.fields[0].value, /in the lead/);
  assert.match(data.fields[1].value, /180 behind/, '300 - 120 = 180');
});

test('teams level on points are described as level', () => {
  const tied = [
    { teamName: 'A', captain: 'C', coCaptain: '', points: 100, completion: 0.5 },
    { teamName: 'B', captain: 'C', coCaptain: '', points: 100, completion: 0.4 },
  ];
  const { data } = buildEmbed(tied, config, FIXED_NOW, {});
  assert.match(data.fields[1].value, /level/);
});

test('the captain shares the title line with the team, saving a line each', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.match(data.fields[0].name, /Bravo - Cap2 & Co2/);
  assert.ok(!data.fields[0].value.includes('Captain'), 'no separate captain line');
  assert.equal(data.fields[0].value.split('\n').length, 1, 'the value is a single line');
});

test('a team with no co-captain leaves no dangling separator', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.match(data.fields[2].name, /Solo - Cap4/);
  assert.ok(!data.fields[2].name.includes('&'));
});

test('a team with no captain at all shows just the team name', () => {
  const nameless = [{ teamName: 'Ghost', captain: '', coCaptain: '', points: 5, completion: 0.1 }];
  const { data } = buildEmbed(nameless, config, FIXED_NOW, {});
  assert.ok(!data.fields[0].name.includes(' - '), data.fields[0].name);
  assert.match(data.fields[0].name, /Ghost/);
});

test('field count is capped at maxTeams', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    teamName: `T${i}`, captain: 'c', coCaptain: '', points: 40 - i, completion: 0.5,
  }));
  assert.equal(buildEmbed(many, config, FIXED_NOW, {}).data.fields.length, 25);
  const capped = loadConfig({ botToken: 't', sheetId: 's', discordChannelId: 'c', maxTeams: '3' });
  assert.equal(buildEmbed(many, capped, FIXED_NOW, {}).data.fields.length, 3);
});

test('a full 25-team embed is valid for the Discord API', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    teamName: `Team ${i}`, captain: `Cap${i}`, coCaptain: `Co${i}`, points: 25 - i, completion: 0.5,
  }));
  const json = buildEmbed(many, config, FIXED_NOW, {}).toJSON();
  assert.equal(json.fields.length, 25);
  assert.ok(json.fields.every((f) => f.name.length > 0 && f.name.length <= 256));
  assert.ok(json.fields.every((f) => f.value.length > 0 && f.value.length <= 1024));
  assert.ok(json.description.length <= 4096);
});

test('no code block is rendered any more', () => {
  const { data } = buildEmbed(teams, config, FIXED_NOW, PREVIOUS);
  assert.ok(!data.description.includes('```'));
});
