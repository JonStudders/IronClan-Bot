'use strict';

/** Settings the bot cannot start without. */
const REQUIRED_SETTINGS = ['botToken', 'sheetId', 'channelId'];

/** Discord caps embeds at 25 fields, so that is the hard ceiling for teams. */
const MAX_EMBED_FIELDS = 25;

/** The top-gainers message is on unless explicitly switched off. */
function parseToggle(value, fallback = true) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return !['off', 'false', 'no', '0', 'none'].includes(raw);
}

/**
 * A Discord timestamp is Unix seconds. Anything else is dropped rather than
 * interpolated into the embed, where a typo would render as broken markup.
 */
function timestamp(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : '';
}

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

    // The developer's Discord user id. They bypass the permission checks on
    // every command, and are the only account the DM commands obey.
    ownerId: env.ownerId || env.developerId || '',

    // Per-event settings, so a new bingo is a config edit not a code edit.
    title: env.bingoTitle || 'Iron Clan Bingo',
    leaderboardUrl: env.leaderboardUrl || '',
    startTimestamp: timestamp(env.bingoStartTimestamp),
    endTimestamp: timestamp(env.bingoEndTimestamp),
    thumbnailUrl: env.thumbnailUrl || '',
    embedColour: env.embedColour || '#6B8E23', // olive green
    credit: env.credit || 'BlancoIron',

    updateIntervalMinutes: positiveNumber(env.updateIntervalMinutes, 10),
    retryIntervalMinutes: positiveNumber(env.retryIntervalMinutes, 1),
    maxTeams: Math.min(positiveNumber(env.maxTeams, MAX_EMBED_FIELDS), MAX_EMBED_FIELDS),

    // The top-gainers message: on | off, and how many teams per metric.
    showGainers: parseToggle(env.gainers),
    gainersRows: positiveNumber(env.gainersRows, 3),
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

module.exports = { loadConfig, validateConfig, parseToggle, timestamp, REQUIRED_SETTINGS, MAX_EMBED_FIELDS };
