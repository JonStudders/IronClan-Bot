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

/** A fake embed carrying just the title, which is all the fakes need. */
const embedFor = (title) => ({ data: { title }, title });

function makeMessage({ author = 'BOT', title = null, calls } = {}) {
  nextId += 1;
  const msg = {
    id: `m${nextId}`,
    author: { id: author },
    embeds: title === null ? [] : [{ title }],
    deleted: false,
    calls,
    edit: async () => { throw new Error('edit() should never be called: panels are reposted'); },
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
  const calls = { sends: [], deletes: [] };
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
  assert.deepEqual(channel.calls.deletes, [], 'nothing to remove on a first run');
});

test('every later update deletes the previous messages and reposts', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);

  assert.equal((await poster.update()).action, 'posted');
  const second = await poster.update();

  assert.equal(second.action, 'reposted');
  assert.equal(second.removedPrevious, 2);
  assert.equal(channel.calls.deletes.length, 2);
  assert.deepEqual(channel.calls.sends, ['Board', 'Gainers', 'Board', 'Gainers']);
});

test('messages are never edited', async () => {
  // makeMessage throws from edit(), so this fails loudly if editing returns.
  const channel = makeChannel();
  const { poster } = posterFor(channel);
  await poster.update();
  await poster.update();
  await poster.update();
});

test('only one set of panels is ever left in the channel', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);

  for (let i = 0; i < 4; i++) await poster.update();

  const ours = channel.history.filter((m) => m.author.id === 'BOT');
  assert.equal(ours.length, 2);
  assert.deepEqual(ours.map((m) => m.embeds[0].title).reverse(), ['Board', 'Gainers']);
});

test('the panels end up as the newest messages, in order', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);
  await poster.update();
  channel.postFromSomeoneElse();
  await poster.update();

  const bottomUp = channel.history.slice(0, 2).reverse().map((m) => m.embeds[0].title);
  assert.deepEqual(bottomUp, ['Board', 'Gainers']);
});

test('a message posted by someone else is left in place', async () => {
  const channel = makeChannel();
  const { poster } = posterFor(channel);
  await poster.update();

  const ownerPost = channel.postFromSomeoneElse();
  await poster.update();

  assert.equal(ownerPost.deleted, false, 'the owner message must survive');
  assert.ok(!channel.calls.deletes.includes(ownerPost.id));
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

test('a message of ours without an embed is left alone', async () => {
  const channel = makeChannel([makeMessage({ title: null })]);
  const { poster } = posterFor(channel);

  const result = await poster.update();
  assert.equal(result.removedPrevious, 0, 'plain messages are not panels');
  assert.deepEqual(channel.calls.deletes, []);
});

test('messages from a retired panel are cleared out too', async () => {
  const channel = makeChannel();
  channel.addOurMessage('Board');
  const retired = channel.addOurMessage('Top Gainers - stacked');

  const { poster } = posterFor(channel);
  const result = await poster.update();

  assert.equal(result.removedPrevious, 2);
  assert.equal(retired.deleted, true);
  assert.equal(channel.history.filter((m) => m.author.id === 'BOT').length, 2);
});

test('duplicates left by a crashed run are cleared', async () => {
  const channel = makeChannel();
  for (let i = 0; i < 5; i++) channel.addOurMessage('Board');
  const { poster } = posterFor(channel, { titles: ['Board'] });

  await poster.update();
  assert.equal(channel.history.filter((m) => m.author.id === 'BOT').length, 1);
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

test('render errors propagate before anything is deleted', async () => {
  const channel = makeChannel();
  channel.addOurMessage('Board');
  const poster = createPoster({
    client: clientFor(channel),
    config,
    render: async () => { throw new Error('sheet is down'); },
    state: makeState(),
    log: SILENT,
  });

  await assert.rejects(() => poster.update(), /sheet is down/);
  assert.deepEqual(channel.calls.deletes, [], 'the old board must survive a failed render');
  assert.deepEqual(channel.calls.sends, []);
});

test('discord errors propagate so the run fails', async () => {
  const client = { user: { id: 'BOT' }, channels: { fetch: async () => { throw new Error('unreachable'); } } };
  const poster = createPoster({
    client, config, render: renderFor(['Board']), state: makeState(), log: SILENT,
  });
  await assert.rejects(() => poster.update(), /unreachable/);
});
