'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createBot } = require('../src/bot');

const ENV = {
  botToken: 't',
  sheetId: 's',
  discordChannelId: 'c',
  bingoTitle: 'Iron Clan Bingo - Test',
  stateFile: require('node:path').join(require('node:os').tmpdir(), 'ironclan-bot-test-state.json'),
};

test('the bot assembles from the environment', () => {
  const bot = createBot(ENV, { log: { warn() {} } });
  assert.equal(bot.config.title, 'Iron Clan Bingo - Test');
  assert.equal(typeof bot.poster.update, 'function');
  assert.equal(typeof bot.render, 'function');
});

test('missing configuration fails fast, before any network call', () => {
  assert.throws(() => createBot({}, { log: { warn() {} } }), /Missing required environment variables/);
});

// --- describeUpdate: the one line both entry points log ----------------------

const bot = createBot(ENV, { log: { warn() {} } });

test('a routine update reads as one line', () => {
  const line = bot.describeUpdate({
    action: 'posted', teamCount: 8, panelCount: 2, removedPrevious: 0, unresolvedCount: 0,
  });
  assert.equal(line, 'Leaderboard posted with 8 team(s) across 2 message(s).');
});

test('removals, lead changes and unreadable points are each reported', () => {
  const line = bot.describeUpdate({
    action: 'reposted',
    teamCount: 8,
    panelCount: 2,
    removedPrevious: 2,
    leadChanged: true,
    leader: 'Fetired',
    unresolvedCount: 3,
    carriedCount: 1,
  });
  assert.match(line, /Leaderboard reposted with 8 team\(s\) across 2 message\(s\)\./);
  assert.match(line, /Removed 2 previous message\(s\)\./);
  assert.match(line, /Lead changed: Fetired are now top\./);
  assert.match(line, /1 team\(s\) kept their previous points/);
  assert.match(line, /3 team\(s\) have no score at all yet/);
});

test('nothing extra is reported when there is nothing to report', () => {
  const line = bot.describeUpdate({
    action: 'posted', teamCount: 8, panelCount: 2, removedPrevious: 0, leadChanged: false, unresolvedCount: 0,
  });
  assert.equal(line.split('\n').length, 1);
});
