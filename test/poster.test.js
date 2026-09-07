'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Collection } = require('discord.js');
const { loadConfig } = require('../src/config');
const { createPoster } = require('../src/poster');
const { EMPTY_STATE } = require('../src/state');

const config = loadConfig({ botToken: 't', sheetId: 's', discordChannelId: 'c' });
const SILENT = { warn() {}, log() {} };

const TEAMS = [
  { teamName: 'Alpha', captain: 'Cap', coCaptain: '', points: 10, completion: 0.5 },
  { teamName: 'Bravo', captain: 'Cap', coCaptain: '', points: 5, completion: 0.2 },
];

let nextId = 0;

/** In-memory stand-in for the JSON state file. */
function makeState(initial = {}) {
  let data = { ...structuredClone(EMPTY_STATE), ...initial };
  return {
    read: () => structuredClone(data),
    write: (next) => { data = structuredClone(next); return true; },
    peek: () => data,
  };
}

function makeMessage({ author = 'BOT', withEmbed = true, calls } = {}) {
  nextId += 1;
  const msg = {
    id: `m${nextId}`,
    author: { id: author },
    embeds: withEmbed ? [{ description: '' }] : [],
    deleted: false,
    calls,
    edit: async ({ embeds }) => {
      if (msg.calls) msg.calls.edits++;
      msg.embeds = [embeds[0].data];
      return msg;
    },
    delete: async () => {
      if (msg.calls) msg.calls.deletes.push(msg.id);
      msg.deleted = true;
      return msg;
    },
  };
  return msg;
}

/** Channel whose history is newest-first, matching Discord. */
function makeChannel(history = []) {
  const calls = { sends: 0, edits: 0, deletes: [] };
  let messages = [...history];
  for (const m of messages) m.calls = calls;

  return {
    calls,
    get history() { return messages.filter((m) => !m.deleted); },
    postFromSomeoneElse() {
      const msg = makeMessage({ author: 'OWNER', calls });
      messages = [msg, ...messages];
      return msg;
    },
    addOldBoard() {
      const msg = makeMessage({ calls });
      messages = [msg, ...messages];
      return msg;
    },
    messages: {
      fetch: async () => {
        const c = new Collection();
        for (const m of messages.filter((x) => !x.deleted)) c.set(m.id, m);
        return c;
      },
    },
    send: async ({ embeds }) => {
      calls.sends++;
      const msg = makeMessage({ calls });
      msg.embeds = [embeds[0].data];
      messages = [msg, ...messages];
      return msg;
    },
  };
}

const clientFor = (channel) => ({ user: { id: 'BOT' }, channels: { fetch: async () => channel } });

function posterFor(channel, { teams = TEAMS, state = makeState() } = {}) {
  return {
    poster: createPoster({
      client: clientFor(channel), config, readTeams: async () => teams, state, log: SILENT,
    }),
    state,
  };
}

test('posts a board when the channel has none', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.action, 'posted');
  assert.equal(result.teamCount, 2);
  assert.equal(channel.calls.sends, 1);
  assert.equal(channel.calls.edits, 0);
});

test('subsequent updates edit the same board in place', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);

  assert.equal((await poster.update()).action, 'posted');
  assert.equal((await poster.update()).action, 'edited');
  assert.equal((await poster.update()).action, 'edited');

  assert.equal(channel.calls.sends, 1, 'only one board should ever be sent');
  assert.equal(channel.calls.edits, 2);
  assert.deepEqual(channel.calls.deletes, []);
});

test('the board message id is persisted', async () => {
  const channel = makeChannel();
  const { poster, state } = posterFor(channel);
  await poster.update();

  assert.equal(state.peek().boardMessageId, channel.history[0].id);
});

test('adopts an existing board after a restart rather than reposting', async () => {
  const channel = makeChannel([makeMessage()]);
  const { poster } = posterFor(channel);

  assert.equal((await poster.update()).action, 'edited');
  assert.equal(channel.calls.sends, 0);
});

// --- Only ever one board -----------------------------------------------------

test('leftover boards are removed, keeping only the newest', async () => {
  const channel = makeChannel();
  const stale = channel.addOldBoard();
  const newer = channel.addOldBoard();
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.removedDuplicates, 1);
  assert.equal(stale.deleted, true, 'the older board should be removed');
  assert.equal(newer.deleted, false, 'the newest board is kept and edited');
  assert.equal(channel.history.filter((m) => m.author.id === 'BOT').length, 1);
});

test('a channel left with several boards converges to one', async () => {
  const channel = makeChannel();
  for (let i = 0; i < 4; i++) channel.addOldBoard();
  const { poster } = posterFor(channel);

  await poster.update();
  assert.equal(channel.history.filter((m) => m.author.id === 'BOT').length, 1);
});

// --- Keeping the board at the bottom ----------------------------------------

test('reposts when someone posts underneath', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);
  await poster.update();

  const ownerPost = channel.postFromSomeoneElse();
  const result = await poster.update();

  assert.equal(result.action, 'reposted');
  assert.equal(channel.calls.deletes.length, 1, 'the old board is removed');
  assert.equal(channel.calls.sends, 2);
  assert.equal(ownerPost.deleted, false, 'the owner message must survive');
});

test('after a repost the board is the newest message again', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);
  await poster.update();
  channel.postFromSomeoneElse();
  await poster.update();

  assert.equal(channel.history[0].author.id, 'BOT');
});

test('never deletes a message authored by someone else', async () => {
  const channel = makeChannel();
  const theirs = channel.postFromSomeoneElse();
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.action, 'posted');
  assert.deepEqual(channel.calls.deletes, []);
  assert.equal(theirs.deleted, false);
});

test('a message of ours without an embed is not treated as a board', async () => {
  const channel = makeChannel([makeMessage({ withEmbed: false })]);
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.action, 'posted', 'it should post a new board rather than editing chatter');
  assert.deepEqual(channel.calls.deletes, []);
});

test('repeated interruptions do not leave stale boards behind', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);
  await poster.update();

  for (let i = 0; i < 3; i++) {
    channel.postFromSomeoneElse();
    await poster.update();
  }

  assert.equal(channel.history.filter((m) => m.author.id === 'BOT').length, 1);
});

// --- Rank movement and the lead ---------------------------------------------

test('previous ranks are recorded for the next update', async () => {
  const channel = makeChannel();
  const { poster, state } = posterFor(channel);
  await poster.update();

  assert.deepEqual(state.peek().previousRanks, { Alpha: 1, Bravo: 2 });
});

test('the first update sets a leader but reports no lead change', async () => {
  const channel = makeChannel();
  const { poster, state } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.leadChanged, false);
  assert.equal(result.leader, 'Alpha');
  assert.equal(state.peek().leader.teamName, 'Alpha');
});

test('overtaking is reported as a lead change', async () => {
  const channel = makeChannel();
  const state = makeState();
  const { poster } = posterFor(channel, { state });
  await poster.update(); // Alpha leads

  const flipped = [
    { teamName: 'Alpha', captain: 'C', coCaptain: '', points: 1, completion: 0.1 },
    { teamName: 'Bravo', captain: 'C', coCaptain: '', points: 99, completion: 0.9 },
  ];
  const second = createPoster({
    client: clientFor(channel), config, readTeams: async () => flipped, state, log: SILENT,
  });

  const result = await second.update();
  assert.equal(result.leadChanged, true);
  assert.equal(result.leader, 'Bravo');
  assert.equal(state.peek().leadChanges[0].from, 'Alpha');
  assert.equal(state.peek().leadChanges[0].to, 'Bravo');
});

// --- Failure paths ----------------------------------------------------------

test('refuses to post an empty leaderboard', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel, { teams: [] });
  await assert.rejects(() => poster.update(), /refusing to post an empty leaderboard/);
  assert.equal(channel.calls.sends, 0);
});

test('reports how many teams had unresolved points', async () => {
  const channel = makeChannel();
  const mixed = [
    { teamName: 'Alpha', captain: 'C', coCaptain: '', points: 10, completion: 0.5 },
    { teamName: 'Bravo', captain: 'C', coCaptain: '', points: null, completion: null },
  ];
  const { poster } = posterFor(channel, { teams: mixed });
  const result = await poster.update();
  assert.equal(result.teamCount, 2);
  assert.equal(result.unresolvedCount, 1);
});

test('sheet errors propagate so the scheduler can retry', async () => {
  const channel = makeChannel();
  const poster = createPoster({
    client: clientFor(channel),
    config,
    readTeams: async () => { throw new Error('sheet is down'); },
    state: makeState(),
    log: SILENT,
  });
  await assert.rejects(() => poster.update(), /sheet is down/);
  assert.equal(channel.calls.sends, 0);
});

test('discord errors propagate so the scheduler can retry', async () => {
  const client = { user: { id: 'BOT' }, channels: { fetch: async () => { throw new Error('unreachable'); } } };
  const poster = createPoster({
    client, config, readTeams: async () => TEAMS, state: makeState(), log: SILENT,
  });
  await assert.rejects(() => poster.update(), /unreachable/);
});
