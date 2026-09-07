'use strict';

// quiet: true suppresses the startup banner dotenv v17 prints by default.
require('dotenv').config({ quiet: true });

const { Client, GatewayIntentBits, Events } = require('discord.js');

const { loadConfig, validateConfig } = require('./src/config');
const { createSheetReader, sortTeams } = require('./src/sheet');
const { createGridReader } = require('./src/grid');
const { parseGainers } = require('./src/gainers');
const { buildEmbed } = require('./src/embed');
const { buildGainersEmbed, GAINERS_TITLE } = require('./src/gainersEmbed');
const { createStateStore } = require('./src/state');
const { createPoster } = require('./src/poster');
const { createScheduler } = require('./src/scheduler');
const { registerCommands, createInteractionHandler } = require('./src/commands');

const config = validateConfig(loadConfig(process.env));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const state = createStateStore({ filePath: config.stateFile });

const readTeams = createSheetReader(config);
const readGrid = createGridReader(config);

/**
 * Builds every message the bot maintains, in the order they should appear.
 * The leaderboard is first; the gainer panels follow.
 *
 * The gainer tables are read from the raw grid rather than the parsed sheet,
 * because they sit under blank headers that the row parser drops.
 */
async function render({ previousRanks, at }) {
  const teams = await readTeams();

  if (teams.length === 0) {
    throw new Error('No teams found in the sheet - refusing to post an empty leaderboard.');
  }

  const panels = [{
    key: 'board',
    title: config.title,
    embed: buildEmbed(teams, config, at, previousRanks),
  }];

  if (config.showGainers) {
    // A failure here must not cost the leaderboard, which is the bot's job.
    try {
      const gainers = parseGainers(await readGrid());
      panels.push({
        key: 'gainers',
        title: GAINERS_TITLE,
        embed: buildGainersEmbed(gainers, config, at),
      });
    } catch (error) {
      console.warn('Could not read top gainers, posting the leaderboard alone:', error.message);
    }
  }

  return {
    panels,
    teams: sortTeams(teams).slice(0, config.maxTeams),
    teamCount: teams.length,
    unresolvedCount: teams.filter((team) => team.points === null).length,
  };
}

const poster = createPoster({ client, config, render, state });

const scheduler = createScheduler({
  task: async () => {
    const { action, teamCount, unresolvedCount, panelCount, leadChanged, leader } = await poster.update();
    console.log(`Leaderboard ${action} with ${teamCount} team(s) across ${panelCount} message(s).`);
    if (leadChanged) {
      console.log(`  Lead changed: ${leader} are now top.`);
    }
    if (unresolvedCount > 0) {
      console.warn(`  ${unresolvedCount} team(s) had no readable points and were shown as zero.`);
    }
  },
  intervalMinutes: config.updateIntervalMinutes,
  retryMinutes: config.retryIntervalMinutes,
  onError: (error) => console.error('Leaderboard update failed:', error),
});

client.on(Events.InteractionCreate, createInteractionHandler({ state, poster }));

client.once(Events.ClientReady, async () => {
  console.log('Iron Clan bot is online.');
  // Command registration is best-effort: a failure here must not stop the
  // leaderboard, which is the bot's actual job.
  try {
    await registerCommands({ config });
  } catch (error) {
    console.error('Could not register slash commands:', error.message);
  }
  scheduler.start();
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

// Without this a rejection anywhere else would terminate the process.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// Client#destroy() returns a Promise in discord.js >=14.15, so it must be
// awaited before exiting or the gateway connection is cut off mid-close.
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down.`);
  scheduler.stop();
  try {
    await client.destroy();
  } catch (error) {
    console.error('Error while shutting down:', error);
  }
  process.exit(0);
}

process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

client.login(config.botToken);
