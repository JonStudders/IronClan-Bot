'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PermissionFlagsBits } = require('discord.js');
const {
  definitions, formatLeadReply, partitionByAge, selectDeletable, explainDeleteFailure,
  BULK_DELETE_MAX_AGE_MS,
} = require('../src/commands');

// --- Command definitions -----------------------------------------------------

test('both commands are registered with descriptions', () => {
  const names = definitions.map((d) => d.name).sort();
  assert.deepEqual(names, ['bingo-clear', 'bingo-lead']);
  assert.ok(definitions.every((d) => d.description.length > 0));
});

test('the destructive command requires Manage Messages by default', () => {
  const clear = definitions.find((d) => d.name === 'bingo-clear');
  assert.equal(clear.default_member_permissions, String(PermissionFlagsBits.ManageMessages));
});

test('the read-only command is not permission gated', () => {
  const lead = definitions.find((d) => d.name === 'bingo-lead');
  assert.ok(!lead.default_member_permissions);
});

// --- /bingo-lead -------------------------------------------------------------

test('reports when no leader has been recorded yet', () => {
  const reply = formatLeadReply({ leader: null, leadChanges: [] });
  assert.match(reply, /No leader recorded yet/);
});

test('names the current leader with a relative timestamp', () => {
  const reply = formatLeadReply({
    leader: { teamName: 'Llama', since: '2026-09-07T12:00:00.000Z' },
    leadChanges: [],
  });
  assert.match(reply, /\*\*Llama\*\*/);
  assert.match(reply, /<t:\d+:R>/);
  assert.match(reply, /as long as the bot has been watching/);
});

test('describes the most recent lead change', () => {
  const reply = formatLeadReply({
    leader: { teamName: 'Fetired', since: '2026-09-07T13:00:00.000Z' },
    leadChanges: [
      { from: 'Llama', to: 'Fetired', at: '2026-09-07T13:00:00.000Z' },
      { from: 'Fetired', to: 'Llama', at: '2026-09-06T13:00:00.000Z' },
    ],
  });
  assert.match(reply, /\*\*Fetired\*\* overtook \*\*Llama\*\*/);
});

// --- /bingo-clear selection --------------------------------------------------

const message = (id, { board = false, pinned = false, ageMs = 0 } = {}) => ({
  id,
  pinned,
  createdTimestamp: Date.now() - ageMs,
  __board: board,
});

const isBoard = (m) => m.__board === true;

function collection(items) {
  return { values: () => items[Symbol.iterator]() };
}

test('the leaderboard boards are never selected for deletion', () => {
  const items = [
    message('board-a', { board: true }),
    message('board-b', { board: true }),
    message('chatter'),
  ];
  const deletable = selectDeletable(collection(items), isBoard);
  assert.deepEqual(deletable.map((m) => m.id), ['chatter']);
});

test('pinned messages are kept as deliberate keeps', () => {
  const items = [message('pinned', { pinned: true }), message('chatter')];
  const deletable = selectDeletable(collection(items), isBoard);
  assert.deepEqual(deletable.map((m) => m.id), ['chatter']);
});

test('a channel with only boards has nothing to clear', () => {
  const items = [message('board-a', { board: true }), message('board-b', { board: true })];
  assert.deepEqual(selectDeletable(collection(items), isBoard), []);
});

test('messages are split by the 14 day bulk delete limit', () => {
  const now = Date.now();
  const recent = { id: 'new', createdTimestamp: now - 1000 };
  const old = { id: 'old', createdTimestamp: now - BULK_DELETE_MAX_AGE_MS - 1000 };

  const { bulk, individual } = partitionByAge([recent, old], now);
  assert.deepEqual(bulk.map((m) => m.id), ['new']);
  assert.deepEqual(individual.map((m) => m.id), ['old']);
});

test('a message exactly at the boundary is treated as too old', () => {
  const now = Date.now();
  const boundary = { id: 'edge', createdTimestamp: now - BULK_DELETE_MAX_AGE_MS };
  const { bulk, individual } = partitionByAge([boundary], now);
  assert.equal(bulk.length, 0);
  assert.equal(individual.length, 1);
});

// --- Error explanations ------------------------------------------------------

test('the 2FA failure is named distinctly from a missing permission', () => {
  assert.match(explainDeleteFailure({ code: 60003 }), /two-factor/);
  assert.match(explainDeleteFailure({ code: 50013 }), /Manage Messages permission/);
  assert.match(explainDeleteFailure({ code: 50034 }), /14 days/);
});

test('an unrecognised error falls back to its own message', () => {
  assert.equal(explainDeleteFailure({ code: 1, message: 'kaboom' }), 'kaboom');
});
