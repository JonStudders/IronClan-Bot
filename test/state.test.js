'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStateStore, applyStandings, ranksFromStandings } = require('../src/state');

const SILENT = { warn: () => {} };

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironclan-state-'));
  return path.join(dir, 'state.json');
}

const teams = (...names) => names.map((teamName) => ({ teamName }));

test('a missing state file reads as empty state, not an error', () => {
  const store = createStateStore({ filePath: tempFile(), log: SILENT });
  const state = store.read();
  assert.deepEqual(state.previousRanks, {});
  assert.equal(state.boardMessageId, null);
  assert.equal(state.leader, null);
  assert.deepEqual(state.leadChanges, []);
});

test('state survives a write and read round trip', () => {
  const filePath = tempFile();
  const store = createStateStore({ filePath, log: SILENT });
  store.write({ ...store.read(), previousRanks: { Llama: 1 }, boardMessageId: 'm1' });

  const reloaded = createStateStore({ filePath, log: SILENT }).read();
  assert.deepEqual(reloaded.previousRanks, { Llama: 1 });
  assert.equal(reloaded.boardMessageId, 'm1');
});

test('a corrupt state file falls back to empty rather than crashing', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, '{ this is not json');
  const state = createStateStore({ filePath, log: SILENT }).read();
  assert.deepEqual(state.previousRanks, {});
});

test('an unwritable path is reported but does not throw', () => {
  const store = createStateStore({ filePath: path.join(os.tmpdir(), 'no', 'such', '\0bad'), log: SILENT });
  assert.equal(store.write({ boardMessageId: null }), false);
});

test('writing leaves no temporary file behind', () => {
  const filePath = tempFile();
  const store = createStateStore({ filePath, log: SILENT });
  store.write(store.read());
  assert.ok(fs.existsSync(filePath));
  assert.ok(!fs.existsSync(`${filePath}.tmp`), 'the temp file should have been renamed away');
});

test('ranks are derived from the sorted order', () => {
  assert.deepEqual(ranksFromStandings(teams('A', 'B', 'C')), { A: 1, B: 2, C: 3 });
});

test('the first update records a leader without calling it a lead change', () => {
  const { next, leadChanged } = applyStandings(
    { previousRanks: {}, leader: null, leadChanges: [] },
    teams('Llama', 'Fetired'),
    '2026-09-07T12:00:00.000Z'
  );
  assert.equal(leadChanged, false, 'there was no previous leader to overtake');
  assert.equal(next.leader.teamName, 'Llama');
  assert.deepEqual(next.leadChanges, []);
});

test('the lead changing hands is recorded', () => {
  const first = applyStandings(
    { previousRanks: {}, leader: null, leadChanges: [] },
    teams('Llama', 'Fetired'),
    '2026-09-07T12:00:00.000Z'
  ).next;

  const { next, leadChanged } = applyStandings(
    first,
    teams('Fetired', 'Llama'),
    '2026-09-07T13:00:00.000Z'
  );

  assert.equal(leadChanged, true);
  assert.equal(next.leader.teamName, 'Fetired');
  assert.equal(next.leader.since, '2026-09-07T13:00:00.000Z');
  assert.deepEqual(next.leadChanges[0], {
    from: 'Llama', to: 'Fetired', at: '2026-09-07T13:00:00.000Z',
  });
});

test('an unchanged leader keeps their original since timestamp', () => {
  const first = applyStandings(
    { previousRanks: {}, leader: null, leadChanges: [] },
    teams('Llama'),
    '2026-09-07T12:00:00.000Z'
  ).next;

  const { next, leadChanged } = applyStandings(first, teams('Llama'), '2026-09-07T14:00:00.000Z');
  assert.equal(leadChanged, false);
  assert.equal(next.leader.since, '2026-09-07T12:00:00.000Z', 'since should not creep forward');
});

test('lead history is newest first and bounded', () => {
  let state = { previousRanks: {}, leader: null, leadChanges: [] };
  state = applyStandings(state, teams('A'), '2026-01-01T00:00:00.000Z').next;

  for (let i = 0; i < 25; i++) {
    const leader = i % 2 === 0 ? 'B' : 'A';
    state = applyStandings(state, teams(leader), `2026-01-02T00:00:${String(i).padStart(2, '0')}.000Z`).next;
  }

  assert.equal(state.leadChanges.length, 20, 'history should be capped');
  assert.ok(state.leadChanges[0].at > state.leadChanges[1].at, 'newest first');
});

test('rank movement survives a restart via the file', () => {
  const filePath = tempFile();
  const store = createStateStore({ filePath, log: SILENT });
  store.write(applyStandings(store.read(), teams('A', 'B', 'C')).next);

  const reloaded = createStateStore({ filePath, log: SILENT }).read();
  assert.deepEqual(reloaded.previousRanks, { A: 1, B: 2, C: 3 });
});

test('fields from an older state schema are dropped on read', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, JSON.stringify({
    boards: { fields: 'old', table: 'older' }, // retired in favour of boardMessageId
    boardMessageId: 'm9',
    previousRanks: { A: 1 },
  }));

  const state = createStateStore({ filePath, log: SILENT }).read();
  assert.equal(state.boardMessageId, 'm9');
  assert.deepEqual(state.previousRanks, { A: 1 });
  assert.ok(!Object.hasOwn(state, 'boards'), 'the retired key should not survive');
});
