'use strict';

// quiet: true suppresses the startup banner dotenv v17 prints by default.
// On CI there is no .env; the workflow supplies the same names as env vars.
require('dotenv').config({ quiet: true });

const { Events } = require('discord.js');
const { createBot } = require('../src/bot');

/**
 * Performs exactly one leaderboard update and exits.
 *
 * This is what the scheduled GitHub Actions workflow runs. Unlike `index.js`
 * it never opens a timer, so the process ends as soon as Discord has accepted
 * the edit - which is what makes the bot runnable somewhere that has no
 * long-lived process.
 *
 * Exits 0 on success and 1 on any failure, so a broken run shows up red.
 */

// A login that never completes would otherwise sit until the workflow's own
// timeout, reporting nothing useful.
const WATCHDOG_MS = 90_000;

const watchdog = setTimeout(() => {
  console.error(`Timed out after ${WATCHDOG_MS / 1000}s waiting for Discord.`);
  process.exit(1);
}, WATCHDOG_MS);
// Unref'd so a finished run is free to exit without waiting for the timer.
watchdog.unref();

function waitForReady(client) {
  return new Promise((resolve, reject) => {
    client.once(Events.ClientReady, resolve);
    client.once(Events.Error, reject);
  });
}

async function main() {
  const bot = createBot();
  bot.client.on(Events.Error, (error) => console.error('Discord client error:', error));

  const ready = waitForReady(bot.client);
  // Nothing awaits `ready` if login itself fails, so make sure a later error
  // cannot surface as an unhandled rejection.
  ready.catch(() => {});

  try {
    await bot.client.login(bot.config.botToken);
    await ready;
    console.log(bot.describeUpdate(await bot.poster.update()));
  } finally {
    // Always destroy before returning: exiting while the gateway still holds
    // open handles crashes the process instead of exiting cleanly.
    await bot.client.destroy().catch(() => {});
  }
}

main()
  .then(() => {
    clearTimeout(watchdog);
  })
  .catch((error) => {
    console.error('Leaderboard update failed:', error.message);
    clearTimeout(watchdog);
    process.exitCode = 1;
  });
