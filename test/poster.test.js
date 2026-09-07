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

function makeState(initial = {}) {
  let data = { ...structuredClone(EMPTY_STATE), ...initial };
  return {
    read: () => structuredClone(data),
    write: (next) => { data = structuredClone(next); return true; },
    peek: () => data,
  };
}

/** A fake embed carrying just the title the poster matches on. */
const embedFor = (title) => ({ data: { title }, title });

function makeMessage({ author = 'BOT', title = null, calls } = {}) {
  nextId += 1;
  const msg = {
    id: `m${nextId}`,
    author: { id: author },
    embeds: title === null ? [] : [{ title }],
    deleted: false,
    calls,
    edit: async ({ embeds }) => {
      if (msg.calls) msg.calls.edits.push(embeds[0].title);
      msg.embeds = [{ title: embeds[0].title }];
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
  const calls = { sends: [], edits: [], deletes: [] };
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
    addOurMessage(title) {
      const msg = makeMessage({ title, calls });
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
      calls.sends.push(embeds[0].title);
      const msg = makeMessage({ calls, title: embeds[0].title });
      messages = [msg, ...messages];
      return msg;
    },
  };
}

const clientFor = (channel) => ({ user: { id: 'BOT' }, channels: { fetch: async () => channel } });

/** Panels are identified by embed title, so the fakes only need titles. */
function renderFor(titles, teams = TEAMS) {
  // index.js hands the poster teams already sorted, so the fake must too.
  const sorted = [...teams].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  return async () => ({
    panels: titles.map((title) => ({ key: title, title, embed: embedFor(title) })),
    teams: sorted,
    teamCount: teams.length,
    unresolvedCount: teams.filter((t) => t.points === null).length,
  });
}

function posterFor(channel, { titles = ['Board', 'Gainers'], teams = TEAMS, state = makeState() } = {}) {
  return {
    poster: createPoster({
      client: clientFor(channel), config, render: renderFor(titles, teams), state, log: SILENT,
    }),
    state,
  };
}

test('posts one message per panel, in order', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.action, 'posted');
  assert.equal(result.panelCount, 2);
  assert.deepEqual(channel.calls.sends, ['Board', 'Gainers']);
});

test('subsequent updates edit every panel in place', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);

  assert.equal((await poster.update()).action, 'posted');
  assert.equal((await poster.update()).action, 'edited');

  assert.equal(channel.calls.sends.length, 2, 'nothing should be sent twice');
  assert.deepEqual(channel.calls.edits, ['Board', 'Gainers']);
  assert.deepEqual(channel.calls.deletes, []);
});

test('panels are matched to messages by embed title', async () => {
  const channel = makeChannel();
  channel.addOurMessage('Gainers');
  channel.addOurMessage('Board');
  // Channel order is now [Board, Gainers] newest-first, i.e. the wrong way up.
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.action, 'reposted', 'out-of-order panels should be reposted');
  assert.deepEqual(channel.calls.sends, ['Board', 'Gainers']);
});

test('adopts existing panels after a restart when they are in order', async () => {
  const channel = makeChannel();
  channel.addOurMessage('Board');
  channel.addOurMessage('Gainers');
  const { poster } = posterFor(channel);

  assert.equal((await poster.update()).action, 'edited');
  assert.deepEqual(channel.calls.sends, []);
});

// --- Leftovers ---------------------------------------------------------------

test('a message from a retired panel is removed', async () => {
  const channel = makeChannel();
  channel.addOurMessage('Board');
  channel.addOurMessage('Gainers');
  const retired = channel.addOurMessage('Top Gainers - stacked');

  const { poster } = posterFor(channel);
  const result = await poster.update();

  assert.equal(result.removedLeftovers, 1);
  assert.equal(retired.deleted, true);
  assert.equal(channel.history.filter((m) => m.author.id === 'BOT').length, 2);
});

test('duplicate panels converge to one each', async () => {
  const channel = makeChannel();
  for (let i = 0; i < 3; i++) channel.addOurMessage('Board');
  const { poster } = posterFor(channel, { titles: ['Board'] });

  await poster.update();
  assert.equal(channel.history.filter((m) => m.author.id === 'BOT').length, 1);
});

// --- Staying at the bottom ---------------------------------------------------

test('reposts every panel when someone posts underneath', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);
  await poster.update();

  const ownerPost = channel.postFromSomeoneElse();
  const result = await poster.update();

  assert.equal(result.action, 'reposted');
  assert.equal(channel.calls.deletes.length, 2, 'both panels removed');
  assert.deepEqual(channel.calls.sends, ['Board', 'Gainers', 'Board', 'Gainers']);
  assert.equal(ownerPost.deleted, false, 'the owner message must survive');
});

test('after a repost the panels are the newest messages, in order', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);
  await poster.update();
  channel.postFromSomeoneElse();
  await poster.update();

  const bottomUp = channel.history.slice(0, 2).reverse().map((m) => m.embeds[0].title);
  assert.deepEqual(bottomUp, ['Board', 'Gainers']);
});

test('never deletes a message authored by someone else', async () => {
  const channel = makeChannel();
  const theirs = channel.postFromSomeoneElse();
  const { poster } = posterFor(channel);

  await poster.update();
  assert.deepEqual(channel.calls.deletes, []);
  assert.equal(theirs.deleted, false);
});

test('a message of ours without an embed is left alone', async () => {
  const channel = makeChannel([makeMessage({ title: null })]);
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.removedLeftovers, 0, 'plain messages are not panels');
  assert.deepEqual(channel.calls.deletes, []);
});

// --- State -------------------------------------------------------------------

test('previous ranks are recorded for the next update', async () => {
  const channel = makeChannel();
  const { poster, state } = posterFor(channel);
  await poster.update();

  assert.deepEqual(state.peek().previousRanks, { Alpha: 1, Bravo: 2 });
});

test('the first update sets a leader but reports no lead change', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.leadChanged, false);
  assert.equal(result.leader, 'Alpha');
});

test('overtaking is reported as a lead change', async () => {
  const channel = makeChannel();
  const state = makeState();
  const { poster } = posterFor(channel, { state });
  await poster.update();

  const flipped = [
    { teamName: 'Alpha', captain: 'C', coCaptain: '', points: 1, completion: 0.1 },
    { teamName: 'Bravo', captain: 'C', coCaptain: '', points: 99, completion: 0.9 },
  ];
  const second = createPoster({
    client: clientFor(channel), config, render: renderFor(['Board', 'Gainers'], flipped), state, log: SILENT,
  });

  const result = await second.update();
  assert.equal(result.leadChanged, true);
  assert.equal(result.leader, 'Bravo');
});

// --- Failure paths -----------------------------------------------------------

test('a render with no panels is refused', async () => {
  const channel = makeChannel();
  const poster = createPoster({
    client: clientFor(channel),
    config,
    render: async () => ({ panels: [], teams: [], teamCount: 0, unresolvedCount: 0 }),
    state: makeState(),
    log: SILENT,
  });
  await assert.rejects(() => poster.update(), /no panels are enabled/);
});

test('render errors propagate so the scheduler can retry', async () => {
  const channel = makeChannel();
  const poster = createPoster({
    client: clientFor(channel),
    config,
    render: async () => { throw new Error('sheet is down'); },
    state: makeState(),
    log: SILENT,
  });
  await assert.rejects(() => poster.update(), /sheet is down/);
  assert.deepEqual(channel.calls.sends, []);
});

test('discord errors propagate so the scheduler can retry', async () => {
  const client = { user: { id: 'BOT' }, channels: { fetch: async () => { throw new Error('unreachable'); } } };
  const poster = createPoster({
    client, config, render: renderFor(['Board']), state: makeState(), log: SILENT,
  });
  await assert.rejects(() => poster.update(), /unreachable/);
});
