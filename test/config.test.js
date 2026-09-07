'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadConfig, validateConfig, MAX_EMBED_FIELDS } = require('../src/config');

const MINIMAL_ENV = { botToken: 't', sheetId: 's', discordChannelId: 'c' };

test('required settings map from their .env names', () => {
  const config = loadConfig(MINIMAL_ENV);
  assert.equal(config.botToken, 't');
  assert.equal(config.sheetId, 's');
  assert.equal(config.channelId, 'c'); // discordChannelId -> channelId
});

test('optional settings fall back to defaults', () => {
  const config = loadConfig(MINIMAL_ENV);
  assert.equal(config.sheetName, 'Leaderboard');
  assert.equal(config.title, 'Iron Clan Bingo');
  assert.equal(config.embedColour, '#6B8E23');
  assert.equal(config.credit, 'BlancoIron');
  assert.equal(config.updateIntervalMinutes, 10);
  assert.equal(config.retryIntervalMinutes, 1);
  assert.equal(config.maxTeams, MAX_EMBED_FIELDS);
  assert.equal(config.leaderboardUrl, '');
  assert.equal(config.endTimestamp, '');
  assert.equal(config.stateFile, './state.json');
});

test('optional settings are overridden when present', () => {
  const config = loadConfig({ ...MINIMAL_ENV, bingoTitle: 'Winter Bingo', updateIntervalMinutes: '30' });
  assert.equal(config.title, 'Winter Bingo');
  assert.equal(config.updateIntervalMinutes, 30);
});

test('non-numeric or non-positive intervals fall back rather than producing NaN', () => {
  for (const bad of ['abc', '0', '-5', '']) {
    const config = loadConfig({ ...MINIMAL_ENV, updateIntervalMinutes: bad });
    assert.equal(config.updateIntervalMinutes, 10, `input ${JSON.stringify(bad)}`);
  }
});

test('maxTeams is clamped to the Discord embed field limit', () => {
  assert.equal(loadConfig({ ...MINIMAL_ENV, maxTeams: '100' }).maxTeams, MAX_EMBED_FIELDS);
  assert.equal(loadConfig({ ...MINIMAL_ENV, maxTeams: '5' }).maxTeams, 5);
});

test('validateConfig lists every missing required setting at once', () => {
  assert.throws(
    () => validateConfig(loadConfig({})),
    /botToken, sheetId, channelId/
  );
});

test('validateConfig passes and returns the config when complete', () => {
  const config = loadConfig(MINIMAL_ENV);
  assert.equal(validateConfig(config), config);
});
