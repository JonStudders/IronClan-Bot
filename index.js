'use strict';

// quiet: true suppresses the startup banner dotenv v17 prints by default.
require('dotenv').config({ quiet: true });

const { Events } = require('discord.js');

const { createBot } = require('./src/bot');
const { createScheduler } = require('./src/scheduler');
const { registerCommands, createInteractionHandler } = require('./src/commands');
const { createDmHandler } = require('./src/dmCommands');

/**
 * Long-running entry point: stays connected and updates on a timer.
 *
 * Use this on a host that supports a persistent process. For a scheduled,
 * one-shot run (GitHub Actions, cron) use `npm run update` instead, which does
 * a single update and exits - see scripts/update-once.js.
 */
const bot = createBot();
const { config, client, state, poster } = bot;

const scheduler = createScheduler({
  task: async () => {
    // -freeze stops the timer only. An explicit -reload still updates, which
    // is the point: freeze is for "stop surprising me", not "stop working".
    if (state.read().frozen) {
      console.log('Updates are frozen (-unfreeze to resume).');
      return;
    }
    console.log(bot.describeUpdate(await poster.update()));
  },
  intervalMinutes: config.updateIntervalMinutes,
  retryMinutes: config.retryIntervalMinutes,
  onError: (error) => console.error('Leaderboard update failed:', error),
});

client.on(Events.InteractionCreate, createInteractionHandler({ state, poster, config }));

// Developer commands over DM. Without an owner id there is nobody to obey, so
// the listener is not attached at all.
if (config.ownerId) {
  client.on(Events.MessageCreate, createDmHandler({
    client, config, poster, state, describeUpdate: bot.describeUpdate,
  }));
} else {
  console.warn('ownerId is not set - developer DM commands are disabled.');
}

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
