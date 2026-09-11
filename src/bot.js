'use strict';

const { Client, GatewayIntentBits, Partials } = require('discord.js');

const { loadConfig, validateConfig } = require('./config');
const { createSheetReader, sortTeams } = require('./sheet');
const { createGridReader } = require('./grid');
const { parseGainers } = require('./gainers');
const { buildEmbed } = require('./embed');
const { buildGainersEmbed, GAINERS_TITLE } = require('./gainersEmbed');
const { createStateStore } = require('./state');
const { createPoster } = require('./poster');

/**
 * Assembles the bot's parts without deciding how it is run.
 *
 * Both entry points build on this: `index.js` keeps the process alive and
 * updates on a timer, while `scripts/update-once.js` performs a single update
 * and exits, which is what the scheduled GitHub Actions workflow runs.
 */
function createBot(env = process.env, { log = console } = {}) {
  const config = validateConfig(loadConfig(env));

  // DirectMessages is not a privileged intent, and Discord exempts DMs with
  // the app from the Message Content intent - so the developer DM commands
  // need no Developer Portal change. Partials.Channel is required because a
  // DM channel arrives uncached.
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
  const state = createStateStore({ filePath: config.stateFile, log });

  const readTeams = createSheetReader(config);
  const readGrid = createGridReader(config);

  /**
   * Builds every message the bot maintains, in the order they should appear:
   * the leaderboard first, then the top gainers.
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
          embed: buildGainersEmbed(gainers, config),
        });
      } catch (error) {
        log.warn?.('Could not read top gainers, posting the leaderboard alone:', error.message);
      }
    }

    return {
      panels,
      teams: sortTeams(teams).slice(0, config.maxTeams),
      teamCount: teams.length,
      unresolvedCount: teams.filter((team) => team.points === null).length,
    };
  }

  const poster = createPoster({ client, config, render, state, log });

  /** One line summarising an update, shared by both entry points. */
  function describeUpdate(result) {
    const lines = [
      `Leaderboard ${result.action} with ${result.teamCount} team(s) across ${result.panelCount} message(s).`,
    ];
    if (result.removedPrevious > 0) {
      lines.push(`  Removed ${result.removedPrevious} previous message(s).`);
    }
    if (result.leadChanged) {
      lines.push(`  Lead changed: ${result.leader} are now top.`);
    }
    if (result.unresolvedCount > 0) {
      lines.push(`  ${result.unresolvedCount} team(s) had no readable points and were shown as zero.`);
    }
    return lines.join('\n');
  }

  return { config, client, state, poster, render, describeUpdate };
}

module.exports = { createBot };
