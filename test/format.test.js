'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  medal, progressBar, formatNumber, gapToAbove, formatGap, rankChange, formatRankChange,
} = require('../src/format');

test('the podium gets medals and everyone else a rank number', () => {
  assert.equal(medal(1), '🥇');
  assert.equal(medal(2), '🥈');
  assert.equal(medal(3), '🥉');
  assert.equal(medal(4), '`#4`');
  assert.equal(medal(12), '`#12`');
});

test('the progress bar is always its full width', () => {
  for (const fraction of [0, 0.01, 0.5, 0.999, 1]) {
    assert.equal(progressBar(fraction).length, 10, `fraction ${fraction}`);
  }
});

test('progress bar fill tracks the percentage', () => {
  assert.equal(progressBar(0), '░░░░░░░░░░');
  assert.equal(progressBar(1), '██████████');
  assert.equal(progressBar(0.5), '█████░░░░░');
  assert.equal(progressBar(0.78), '████████░░');
});

test('out-of-range and missing completion values are clamped, not crashed', () => {
  assert.equal(progressBar(null), '░░░░░░░░░░');
  assert.equal(progressBar(undefined), '░░░░░░░░░░');
  assert.equal(progressBar(-5), '░░░░░░░░░░');
  assert.equal(progressBar(42), '██████████');
});

test('points are thousands-separated', () => {
  assert.equal(formatNumber(1240), '1,240');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(null), '0');
  assert.equal(formatNumber(999999), '999,999');
});

test('the gap is measured against the team directly above', () => {
  const teams = [{ points: 1240 }, { points: 1180 }, { points: 940 }];
  assert.equal(gapToAbove(teams, 0), null, 'the leader has nobody above them');
  assert.equal(gapToAbove(teams, 1), 60);
  assert.equal(gapToAbove(teams, 2), 240);
});

test('gap wording distinguishes leading, level and behind', () => {
  assert.equal(formatGap(null), 'in the lead');
  assert.equal(formatGap(0), 'level');
  assert.equal(formatGap(1240), '1,240 behind');
});

test('a team missing points does not produce a negative gap', () => {
  const teams = [{ points: 100 }, { points: null }];
  assert.equal(gapToAbove(teams, 1), 100);
});

test('rank movement is measured against the previous update', () => {
  const previous = { Llama: 3, Fetired: 1, C8B: 4 };
  assert.deepEqual(rankChange('Llama', 1, previous), { direction: 'up', places: 2 });
  assert.deepEqual(rankChange('Fetired', 2, previous), { direction: 'down', places: 1 });
  assert.deepEqual(rankChange('C8B', 4, previous), { direction: 'same', places: 0 });
});

test('a team we have not seen before is new, not unmoved', () => {
  assert.deepEqual(rankChange('Newbie', 5, { Llama: 1 }), { direction: 'new', places: 0 });
  assert.deepEqual(rankChange('Anyone', 1, {}), { direction: 'new', places: 0 });
  assert.deepEqual(rankChange('Anyone', 1, null), { direction: 'new', places: 0 });
});

test('movement arrows read correctly', () => {
  assert.equal(formatRankChange({ direction: 'up', places: 2 }), '▲2');
  assert.equal(formatRankChange({ direction: 'down', places: 1 }), '▼1');
  assert.equal(formatRankChange({ direction: 'same', places: 0 }), '─');
  assert.equal(formatRankChange({ direction: 'new', places: 0 }), 'NEW');
});
