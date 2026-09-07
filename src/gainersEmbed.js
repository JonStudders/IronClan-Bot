'use strict';

const { EmbedBuilder } = require('discord.js');
const { METRICS } = require('./gainers');

/** Doubles as the identifier the poster matches this message on. */
const GAINERS_TITLE = 'Top Gainers';

/** RSNs are capped at 12 characters, so one long name cannot widen the table. */
const MAX_NAME = 12;

function truncate(text, max = MAX_NAME) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** XP runs to millions, so abbreviate it; EHB and EHP stay at one decimal. */
function formatMetric(metricKey, value) {
  if (value === null || value === undefined) return '-';
  if (metricKey !== 'xp') return value.toFixed(1);
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

/**
 * Best first for this metric. The sheet lists teams in leaderboard order, so
 * without this the section is not actually a ranking. Teams with no value sink
 * rather than being dropped.
 */
function rankFor(gainers, metricKey, limit) {
  return gainers
    .filter((row) => row[metricKey])
    .sort((a, b) => (b[metricKey].value ?? -Infinity) - (a[metricKey].value ?? -Infinity))
    .slice(0, limit);
}

/**
 * One short section per metric, listing individual players best first, with
 * the team each plays for.
 *
 * There is deliberately no column header row: the section label names the
 * metric, and player/team/value are self-evident beside the leaderboard above.
 * That saves a line per section, which matters when three sections stack.
 */
function renderSections(gainers, metrics, limit) {
  return metrics
    .map((metric) => {
      const ranked = rankFor(gainers, metric.key, limit);
      if (ranked.length === 0) return null;

      const rows = ranked.map((row, index) => [
        `${index + 1}.`,
        truncate(row[metric.key].player),
        truncate(row.team, 10),
        formatMetric(metric.key, row[metric.key].value),
      ]);

      const widths = [0, 1, 2, 3].map((col) => Math.max(...rows.map((r) => r[col].length)));
      const body = rows
        .map((r) => `${r[0].padStart(widths[0])} ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  `
          + `${r[3].padStart(widths[3])}`.trimEnd())
        .map((line) => line.trimEnd())
        .join('\n');

      return `${metric.label} gained\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The leading individual players for each tracked metric, as a code block so
 * the columns line up.
 *
 * Note on the candidate pool: the sheet supplies the top gainer *per team*, so
 * these are the best players among each team's own leader. If the two highest
 * gainers in the clan play for the same team, only one of them can appear -
 * showing the true clan-wide top three would need per-player data the sheet
 * does not currently publish.
 */
function buildGainersEmbed(gainers, config) {
  const metrics = METRICS.filter((metric) => gainers.some((row) => row[metric.key]));
  const sections = metrics.length === 0 ? '' : renderSections(gainers, metrics, config.gainersRows);

  const body = sections === ''
    ? 'No gainer data in the sheet yet.'
    : ['```', sections, '```'].join('\n');

  const footer = `Top ${config.gainersRows} per category · one entry per team`
    + ` · updates every ${config.updateIntervalMinutes} minutes`;

  return new EmbedBuilder()
    .setColor(config.embedColour)
    .setTitle(GAINERS_TITLE)
    // No "Last Updated" line: the leaderboard sits directly above and has one.
    .setDescription(body)
    .setFooter({ text: footer });
}

module.exports = {
  buildGainersEmbed,
  GAINERS_TITLE,
  renderSections,
  rankFor,
  formatMetric,
  truncate,
};
