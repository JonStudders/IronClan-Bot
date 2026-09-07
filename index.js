'use strict';

// quiet: true suppresses the startup banner dotenv v17 prints by default.
require('dotenv').config({ quiet: true });

const { Client, GatewayIntentBits, Events } = require('discord.js');

const { loadConfig, validateConfig } = require('./src/config');
const { createSheetReader } = require('./src/sheet');
const { createStateStore } = require('./src/state');
const { createPoster } = require('./src/poster');
const { createScheduler } = require('./src/scheduler');
const { registerCommands, createInteractionHandler } = require('./src/commands');

const config = validateConfig(loadConfig(process.env));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const state = createStateStore({ filePath: config.stateFile });
const poster = createPoster({ client, config, readTeams: createSheetReader(config), state });

const scheduler = createScheduler({
  task: async () => {
    const { action, teamCount, unresolvedCount, leadChanged, leader } = await poster.update();
    console.log(`Leaderboard ${action} with ${teamCount} team(s).`);
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
