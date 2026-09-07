'use strict';

const MEDALS = ['🥇', '🥈', '🥉'];

/** Medal for the podium, plain rank number below it. */
function medal(rank) {
  return MEDALS[rank - 1] ?? `\`#${rank}\``;
}

/** Ten-cell completion bar, drawn with block characters. */
function progressBar(fraction, width = 10) {
  const safe = Math.max(0, Math.min(1, fraction ?? 0));
  const filled = Math.round(safe * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatNumber(value) {
  return Math.round(value ?? 0).toLocaleString('en-GB');
}

/**
 * Points behind the team immediately above. The leader has nobody above them,
 * so they get the lead marker instead.
 */
function gapToAbove(teams, index) {
  if (index === 0) return null;
  const above = teams[index - 1];
  const current = teams[index];
  return Math.max(0, Math.round((above.points ?? 0) - (current.points ?? 0)));
}

function formatGap(gap) {
  if (gap === null) return 'in the lead';
  if (gap === 0) return 'level';
  return `${formatNumber(gap)} behind`;
}

/**
 * Movement since the previous update. `previousRanks` maps team name to the
 * rank it held last time; a team we have not seen before is new rather than
 * unmoved.
 */
function rankChange(teamName, currentRank, previousRanks) {
  if (!previousRanks || !Object.hasOwn(previousRanks, teamName)) {
    return { direction: 'new', places: 0 };
  }
  const places = previousRanks[teamName] - currentRank;
  if (places > 0) return { direction: 'up', places };
  if (places < 0) return { direction: 'down', places: -places };
  return { direction: 'same', places: 0 };
}

function formatRankChange(change) {
  switch (change.direction) {
    case 'up': return `▲${change.places}`;
    case 'down': return `▼${change.places}`;
    case 'new': return 'NEW';
    default: return '─';
  }
}

module.exports = {
  MEDALS,
  medal,
  progressBar,
  formatNumber,
  gapToAbove,
  formatGap,
  rankChange,
  formatRankChange,
};
