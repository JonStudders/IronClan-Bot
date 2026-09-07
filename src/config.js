'use strict';

/** Settings the bot cannot start without. */
const REQUIRED_SETTINGS = ['botToken', 'sheetId', 'channelId'];

/** Discord caps embeds at 25 fields, so that is the hard ceiling for teams. */
const MAX_EMBED_FIELDS = 25;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Builds the config object from an environment bag. Pure: takes `env` rather
 * than reaching for process.env, so tests can drive it directly.
 */
function loadConfig(env = {}) {
  return {
    botToken: env.botToken,
    applicationId: env.applicationId,
    guildId: env.discordServerId,
    sheetId: env.sheetId,
    sheetName: env.sheetName || 'Leaderboard',
    channelId: env.discordChannelId,

    // Per-event settings, so a new bingo is a config edit not a code edit.
    title: env.bingoTitle || 'Iron Clan Bingo',
    leaderboardUrl: env.leaderboardUrl || '',
    endTimestamp: env.bingoEndTimestamp || '',
    thumbnailUrl: env.thumbnailUrl || '',
    embedColour: env.embedColour || '#6B8E23', // olive green
    credit: env.credit || 'BlancoIron',

    updateIntervalMinutes: positiveNumber(env.updateIntervalMinutes, 10),
    retryIntervalMinutes: positiveNumber(env.retryIntervalMinutes, 1),
    maxTeams: Math.min(positiveNumber(env.maxTeams, MAX_EMBED_FIELDS), MAX_EMBED_FIELDS),

    stateFile: env.stateFile || './state.json',
  };
}

/** Throws with every missing setting listed at once, rather than one at a time. */
function validateConfig(config) {
  const missing = REQUIRED_SETTINGS.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return config;
}

module.exports = { loadConfig, validateConfig, REQUIRED_SETTINGS, MAX_EMBED_FIELDS };
