'use strict';

const { EmbedBuilder } = require('discord.js');
const { sortTeams } = require('./sheet');
const {
  medal,
  progressBar,
  formatNumber,
  gapToAbove,
  formatGap,
  rankChange,
  formatRankChange,
} = require('./format');

// Cells the sheet has not resolved yet (blank, or a #N/A formula) render as a
// zero score rather than as an error, so a pre-start board reads as "nobody has
// scored" instead of "the bot is broken". The unresolved count is logged at the
// call site so genuine formula breakage is still visible.
function formatPercentage(fraction) {
  if (fraction === null || fraction === undefined) return '0.00%';
  return `${(fraction * 100).toFixed(2)}%`;
}

function formatPoints(points) {
  if (points === null || points === undefined) return '0 Points';
  return `${Math.round(points)} Points`;
}

/** Discord relative timestamp, which each viewer sees in their own timezone. */
function relativeTimestamp(seconds) {
  return `<t:${seconds}:R>`;
}

/**
 * Before the bingo begins, the deadline people care about is the start; once it
 * has, it is the end. Showing both at once is noise, so the line switches over
 * on its own when the start passes.
 */
function countdownLine(config, now) {
  const nowSeconds = Math.floor(now / 1000);

  if (config.startTimestamp && Number(config.startTimestamp) > nowSeconds) {
    return `Starts: ${relativeTimestamp(config.startTimestamp)}`;
  }
  return config.endTimestamp ? `Ends: ${relativeTimestamp(config.endTimestamp)}` : null;
}

function buildDescription(config, now) {
  return [
    config.leaderboardUrl ? `Public Leaderboard: ${config.leaderboardUrl}` : null,
    countdownLine(config, now),
    `Last Updated: ${relativeTimestamp(Math.floor(now / 1000))}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Per-team view model: rank, gap to the team above, and movement since last time. */
function toRows(teams, previousRanks, maxTeams) {
  const sorted = sortTeams(teams).slice(0, maxTeams);
  return sorted.map((team, index) => ({
    team,
    rank: index + 1,
    gap: gapToAbove(sorted, index),
    change: rankChange(team.teamName, index + 1, previousRanks),
  }));
}

/**
 * The leaderboard embed: one field per team, showing medal or rank, movement
 * arrow, points, completion bar and the gap to the team above.
 */
function buildEmbed(teams, config, now = Date.now(), previousRanks = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.embedColour)
    .setTitle(config.title)
    .setDescription(buildDescription(config, now))
    .setFooter({ text: `Made by: ${config.credit}` });

  if (config.thumbnailUrl) {
    embed.setThumbnail(config.thumbnailUrl);
  }

  for (const row of toRows(teams, previousRanks, config.maxTeams)) {
    // The captain rides on the title line rather than a line of its own, which
    // saves a line per team on a board of up to 25.
    const captains = [row.team.captain, row.team.coCaptain].filter(Boolean).join(' & ');
    const name = `${medal(row.rank)} ${row.team.teamName}`
      + `${captains ? ` - ${captains}` : ''}  ${formatRankChange(row.change)}`;

    const value = `**${formatNumber(row.team.points)}** pts · ${progressBar(row.team.completion)} `
      + `${formatPercentage(row.team.completion)} · ${formatGap(row.gap)}`;

    embed.addFields({ name, value });
  }

  return embed;
}

module.exports = {
  buildEmbed,
  buildDescription,
  countdownLine,
  toRows,
  formatPoints,
  formatPercentage,
};
