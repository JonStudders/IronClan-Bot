'use strict';

/**
 * The points history: a snapshot of every team's score, recorded on each
 * update, so the board can show how the race developed rather than only where
 * it stands.
 *
 * History cannot be reconstructed after the fact, so recording starts as soon
 * as this is deployed and the earliest data is simply the earliest run.
 */

/** Snapshots kept. At one per update, well over a month of a busy bingo. */
const MAX_SNAPSHOTS = 2000;

/** Eight levels, matching the block characters used by the completion bars. */
const SPARK_LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Columns in a rendered sparkline. Fixed, so every row lines up. */
const SPARK_WIDTH = 12;

/**
 * Substitutes a team's last known points when the sheet gives nothing.
 *
 * A single unreadable cell - a `#N/A` while a formula recalculates, or a blank
 * during an edit - would otherwise drop that team to zero and scramble the
 * ranking. Points only ever climb during a bingo, so the previous value is a
 * far better guess than zero.
 */
function carryForward(teams, lastKnown = {}) {
  let carried = 0;

  const withPoints = teams.map((team) => {
    if (team.points !== null && team.points !== undefined) return team;

    const previous = lastKnown[team.teamName];
    if (previous === undefined || previous === null) return team;

    carried += 1;
    return { ...team, points: previous, carriedForward: true };
  });

  return { teams: withPoints, carried };
}

/** Team name -> points, for every team whose points are readable. */
function lastKnownFrom(teams, previous = {}) {
  const next = { ...previous };
  for (const team of teams) {
    if (team.points !== null && team.points !== undefined) {
      next[team.teamName] = team.points;
    }
  }
  return next;
}

/** The points half of a snapshot, rounded: fractional points are never shown. */
function snapshotPoints(teams) {
  return Object.fromEntries(
    teams
      .filter((team) => team.points !== null && team.points !== undefined)
      .map((team) => [team.teamName, Math.round(team.points)])
  );
}

function samePoints(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/**
 * Appends a snapshot, unless nothing has moved since the last one.
 *
 * Skipping unchanged snapshots keeps the file small through quiet periods -
 * overnight, or the days before the bingo starts - without losing any of the
 * shape, because a flat stretch is exactly what "no change" means.
 */
function recordSnapshot(history, teams, at, max = MAX_SNAPSHOTS) {
  const points = snapshotPoints(teams);
  if (Object.keys(points).length === 0) return history;

  const latest = history[history.length - 1];
  if (latest && samePoints(latest.points, points)) return history;

  const appended = [...history, { at, points }];
  return appended.length > max ? appended.slice(appended.length - max) : appended;
}

/** Snapshots within the last `hours`, or all of them when hours is falsy. */
function withinPeriod(history, hours, now = Date.now()) {
  if (!hours) return history;
  const cutoff = now - hours * 60 * 60 * 1000;
  return history.filter((snapshot) => new Date(snapshot.at).getTime() >= cutoff);
}

/** Evenly spaced samples, so a sparkline is the same width at any history length. */
function resample(values, width = SPARK_WIDTH) {
  if (values.length === 0) return [];
  if (values.length <= width) return [...values];

  return Array.from({ length: width }, (_, i) => {
    const index = Math.round((i * (values.length - 1)) / (width - 1));
    return values[index];
  });
}

/**
 * Renders one series as blocks. Scaling is shared across every team, so the
 * rows can be read against each other - the point of the chart is the race,
 * not each team's private shape.
 */
function sparkline(values, min, max) {
  if (values.length === 0) return '';
  const span = max - min;

  return values
    .map((value) => {
      if (span <= 0) return SPARK_LEVELS[0];
      const level = Math.round(((value - min) / span) * (SPARK_LEVELS.length - 1));
      return SPARK_LEVELS[Math.max(0, Math.min(SPARK_LEVELS.length - 1, level))];
    })
    .join('');
}

/** A team's points across the snapshots, carrying the last value over gaps. */
function seriesFor(history, teamName) {
  const series = [];
  let previous = null;

  for (const snapshot of history) {
    const value = snapshot.points[teamName];
    if (value !== undefined) previous = value;
    if (previous !== null) series.push(previous);
  }
  return series;
}

function formatNumber(value) {
  return Math.round(value ?? 0).toLocaleString('en-GB');
}

function formatDelta(value) {
  if (value === 0) return '-';
  return `${value > 0 ? '+' : ''}${formatNumber(value)}`;
}

/**
 * The whole history block: one row per team, best first, with a sparkline,
 * the current score and the gain over the period shown.
 */
function renderHistory(history, { hours = 0, now = Date.now(), maxTeams = 10 } = {}) {
  const period = withinPeriod(history, hours, now);

  if (period.length === 0) {
    return { text: 'No history recorded for that period yet.', empty: true };
  }
  if (period.length === 1) {
    return {
      text: 'Only one snapshot so far - there is nothing to compare it against yet.',
      empty: true,
    };
  }

  const latest = period[period.length - 1];
  const names = Object.keys(latest.points)
    .sort((a, b) => latest.points[b] - latest.points[a])
    .slice(0, maxTeams);

  const rows = names.map((name) => {
    const series = seriesFor(period, name);
    return {
      name,
      series,
      current: series[series.length - 1] ?? 0,
      gain: series.length > 0 ? series[series.length - 1] - series[0] : 0,
    };
  });

  // One scale for every row, so the rows are comparable.
  const all = rows.flatMap((row) => row.series);
  const min = Math.min(...all);
  const max = Math.max(...all);

  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const currentWidth = Math.max(...rows.map((row) => formatNumber(row.current).length));
  const gainWidth = Math.max(...rows.map((row) => formatDelta(row.gain).length));

  const lines = rows.map((row) => [
    row.name.padEnd(nameWidth),
    sparkline(resample(row.series), min, max),
    formatNumber(row.current).padStart(currentWidth),
    formatDelta(row.gain).padStart(gainWidth),
  ].join('  '));

  const best = rows.reduce((a, b) => (b.gain > a.gain ? b : a), rows[0]);

  return {
    text: lines.join('\n'),
    empty: false,
    snapshots: period.length,
    from: period[0].at,
    to: latest.at,
    topGain: best && best.gain > 0 ? best : null,
  };
}

module.exports = {
  carryForward,
  lastKnownFrom,
  recordSnapshot,
  snapshotPoints,
  withinPeriod,
  resample,
  sparkline,
  seriesFor,
  renderHistory,
  MAX_SNAPSHOTS,
  SPARK_WIDTH,
  SPARK_LEVELS,
};
