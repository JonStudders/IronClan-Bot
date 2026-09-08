'use strict';

require('dotenv').config({ quiet: true });

const { REST, Routes } = require('discord.js');
const { loadConfig, validateConfig } = require('../src/config');

/**
 * Removes the bot's slash commands from the guild.
 *
 * Slash commands need something listening on Discord's gateway to answer them.
 * When the bot runs as a scheduled one-shot job there is nothing online, so a
 * registered command would appear in Discord and then fail with "the
 * application did not respond". Clearing them is tidier than leaving commands
 * that cannot work.
 *
 * Run once with: npm run commands:clear
 */
async function main() {
  const config = validateConfig(loadConfig(process.env));

  if (!config.applicationId || !config.guildId) {
    throw new Error('applicationId and discordServerId must both be set to clear commands.');
  }

  const rest = new REST().setToken(config.botToken);
  await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), { body: [] });
  console.log(`Cleared all slash commands for guild ${config.guildId}.`);
}

main().catch((error) => {
  console.error('Could not clear commands:', error.message);
  process.exit(1);
});
