'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  carryForward, lastKnownFrom, recordSnapshot, snapshotPoints, withinPeriod,
  resample, sparkline, seriesFor, renderHistory, SPARK_WIDTH,
} = require('../src/history');

const team = (teamName, points) => ({ teamName, points, captain: '', coCaptain: '', completion: 0.5 });

// --- Carrying a score forward ------------------------------------------------

test('an unreadable score falls back to the last known value', () => {
  const { teams, carried } = carryForward(
    [team('Alpha', null), team('Bravo', 50)],
    { Alpha: 120 }
  );
  assert.equal(teams[0].points, 120);
  assert.equal(teams[0].carriedForward, true);
  assert.equal(carried, 1);
});

test('a readable score is never overwritten by an older one', () => {
  const { teams, carried } = carryForward([team('Alpha', 200)], { Alpha: 120 });
  assert.equal(teams[0].points, 200);
  assert.equal(carried, 0);
  assert.ok(!teams[0].carriedForward);
});

test('zero is a real score and is not treated as missing', () => {
  const { teams, carried } = carryForward([team('Alpha', 0)], { Alpha: 120 });
  assert.equal(teams[0].points, 0, 'a genuine zero must not be replaced');
  assert.equal(carried, 0);
});

test('a team with no history yet stays unreadable rather than inventing a score', () => {
  const { teams, carried } = carryForward([team('Newbie', null)], { Alpha: 120 });
  assert.equal(teams[0].points, null);
  assert.equal(carried, 0);
});

test('carrying forward does not mutate the input', () => {
  const original = [team('Alpha', null)];
  carryForward(original, { Alpha: 120 });
  assert.equal(original[0].points, null);
});

test('the last known table keeps earlier values for teams missing this time', () => {
  const known = lastKnownFrom([team('Alpha', null), team('Bravo', 50)], { Alpha: 120 });
  assert.deepEqual(known, { Alpha: 120, Bravo: 50 });
});

// --- Recording ---------------------------------------------------------------

test('only readable scores are recorded', () => {
  assert.deepEqual(snapshotPoints([team('Alpha', 10), team('Bravo', null)]), { Alpha: 10 });
});

test('fractional points are rounded in the record', () => {
  assert.deepEqual(snapshotPoints([team('Alpha', 10.6)]), { Alpha: 11 });
});

test('a snapshot is appended when something has moved', () => {
  let history = recordSnapshot([], [team('Alpha', 10)], 't1');
  history = recordSnapshot(history, [team('Alpha', 20)], 't2');
  assert.equal(history.length, 2);
  assert.deepEqual(history[1], { at: 't2', points: { Alpha: 20 } });
});

test('an unchanged snapshot is skipped, so quiet periods cost nothing', () => {
  let history = recordSnapshot([], [team('Alpha', 10)], 't1');
  history = recordSnapshot(history, [team('Alpha', 10)], 't2');
  history = recordSnapshot(history, [team('Alpha', 10)], 't3');
  assert.equal(history.length, 1, 'three identical updates, one entry');
});

test('a team joining counts as a change even at the same scores', () => {
  let history = recordSnapshot([], [team('Alpha', 10)], 't1');
  history = recordSnapshot(history, [team('Alpha', 10), team('Bravo', 10)], 't2');
  assert.equal(history.length, 2);
});

test('a snapshot with nothing readable is not recorded', () => {
  assert.deepEqual(recordSnapshot([], [team('Alpha', null)], 't1'), []);
});

test('history is capped, dropping the oldest entries', () => {
  let history = [];
  for (let i = 0; i < 10; i++) history = recordSnapshot(history, [team('Alpha', i)], `t${i}`);
  const capped = recordSnapshot(history, [team('Alpha', 99)], 't99', 5);
  assert.equal(capped.length, 5);
  assert.equal(capped[capped.length - 1].at, 't99', 'the newest is kept');
  assert.equal(capped[0].at, 't6', 'the oldest are dropped');
});

// --- Periods -----------------------------------------------------------------

test('a period keeps only recent snapshots', () => {
  const now = Date.UTC(2026, 8, 11, 12, 0, 0);
  const history = [
    { at: new Date(now - 48 * 3600 * 1000).toISOString(), points: { A: 1 } },
    { at: new Date(now - 2 * 3600 * 1000).toISOString(), points: { A: 2 } },
  ];
  assert.equal(withinPeriod(history, 24, now).length, 1);
  assert.equal(withinPeriod(history, 0, now).length, 2, 'no window means everything');
});

// --- Drawing -----------------------------------------------------------------

test('a sparkline is one character per sample', () => {
  assert.equal(sparkline([1, 2, 3], 1, 3).length, 3);
});

test('the lowest value draws the lowest block and the highest the tallest', () => {
  const line = sparkline([0, 50, 100], 0, 100);
  assert.equal(line[0], '▁');
  assert.equal(line[2], '█');
});

test('a flat series does not divide by zero', () => {
  assert.equal(sparkline([5, 5, 5], 5, 5), '▁▁▁');
});

test('long series are resampled to a fixed width so rows line up', () => {
  const long = Array.from({ length: 500 }, (_, i) => i);
  assert.equal(resample(long).length, SPARK_WIDTH);
  assert.equal(resample(long)[0], 0, 'the first sample is the start');
  assert.equal(resample(long).at(-1), 499, 'the last sample is the end');
});

test('short series are left alone rather than stretched', () => {
  assert.deepEqual(resample([1, 2, 3]), [1, 2, 3]);
});

test('a team missing from a snapshot holds its previous value', () => {
  const history = [
    { at: 't1', points: { A: 10 } },
    { at: 't2', points: {} },
    { at: 't3', points: { A: 30 } },
  ];
  assert.deepEqual(seriesFor(history, 'A'), [10, 10, 30]);
});

// --- The rendered block ------------------------------------------------------

function buildHistory(count, rates) {
  let history = [];
  const start = Date.UTC(2026, 8, 8, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const teams = Object.entries(rates).map(([name, rate]) => team(name, rate * i));
    history = recordSnapshot(history, teams, new Date(start + i * 3600 * 1000).toISOString());
  }
  return history;
}

test('an empty history says so rather than drawing nothing', () => {
  assert.equal(renderHistory([]).empty, true);
});

test('a single snapshot is not enough to draw a trend', () => {
  const result = renderHistory(recordSnapshot([], [team('A', 1)], 't1'));
  assert.equal(result.empty, true);
  assert.match(result.text, /nothing to compare/);
});

test('teams are listed best first', () => {
  const history = buildHistory(20, { Slow: 5, Fast: 40, Middle: 20 });
  const lines = renderHistory(history).text.split('\n');
  assert.match(lines[0], /^Fast/);
  assert.match(lines[1], /^Middle/);
  assert.match(lines[2], /^Slow/);
});

test('each row carries a sparkline, the current score and the gain', () => {
  const history = buildHistory(20, { Alpha: 10 });
  const [row] = renderHistory(history).text.split('\n');
  assert.match(row, /[▁▂▃▄▅▆▇█]/);
  assert.match(row, /190/, 'current score');
  assert.match(row, /\+190/, 'gain over the period');
});

test('the biggest gainer over the period is identified', () => {
  const history = buildHistory(20, { Slow: 5, Fast: 40 });
  assert.equal(renderHistory(history).topGain.name, 'Fast');
});

test('rows share one scale, so they can be read against each other', () => {
  const history = buildHistory(20, { Runaway: 100, Stalled: 1 });
  const [first, second] = renderHistory(history).text.split('\n');
  assert.ok(first.includes('█'), 'the leader reaches the top of the scale');
  assert.ok(!second.includes('█'), 'a stalled team must not also look maxed out');
});

test('the block stays narrow enough not to wrap', () => {
  const history = buildHistory(40, {
    'Pot Arams Winning Gooners': 40,
    'Euskadi Ta Askatasuna': 33,
    'Zappers Aint Playin': 28,
  });
  const widest = Math.max(...renderHistory(history).text.split('\n').map((l) => l.length));
  assert.ok(widest <= 60, `expected <=60 chars, got ${widest}`);
});

test('only the top teams are drawn, however many are playing', () => {
  const rates = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`Team${i}`, i + 1]));
  const lines = renderHistory(buildHistory(10, rates), { maxTeams: 10 }).text.split('\n');
  assert.equal(lines.length, 10);
});
