'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { createDmHandler, parseCommand, stripQuotes, MAX_DELETE } = require('../src/dmCommands');

const OWNER = '995414858289909780';
const STRANGER = '111111111111111111';
const SILENT = { log() {}, warn() {}, error() {} };

const config = loadConfig({
  botToken: 't', sheetId: 's', discordChannelId: 'chan', ownerId: OWNER,
});

// --- Parsing -----------------------------------------------------------------

test('a command is split into name and arguments', () => {
  assert.deepEqual(parseCommand('-delete 5'), { name: 'delete', args: '5' });
  assert.deepEqual(parseCommand('-reload'), { name: 'reload', args: '' });
  assert.deepEqual(parseCommand('-post hello there'), { name: 'post', args: 'hello there' });
});

test('the command name is case-insensitive and spacing is forgiving', () => {
  assert.deepEqual(parseCommand('  -DELETE   5  '), { name: 'delete', args: '5' });
});

test('ordinary chat is not a command', () => {
  assert.equal(parseCommand('hello'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand('-'), null);
  assert.equal(parseCommand(null), null);
});

test('quotes around post text are optional', () => {
  assert.equal(stripQuotes("'hello there'"), 'hello there');
  assert.equal(stripQuotes('"hello there"'), 'hello there');
  assert.equal(stripQuotes('hello there'), 'hello there');
  assert.equal(stripQuotes("it's fine"), "it's fine", 'a mid-word apostrophe is not a quote');
});

// --- Harness -----------------------------------------------------------------

let nextId = 0;

function makeMessage({ author = OWNER, content = '', guild = null, bot = false } = {}) {
  const replies = [];
  return {
    replies,
    author: { id: author, bot },
    guild,
    content,
    // Keep the whole payload: a reply may be text, or carry an attachment.
    reply: async (payload) => { replies.push(payload); },
  };
}

function makeChannel(existing = []) {
  const calls = { sends: [], deletes: [], bulk: [] };
  const messages = existing;
  return {
    calls,
    messages: {
      fetch: async () => new Map(messages.map((m) => [m.id, m])),
    },
    bulkDelete: async (list) => { calls.bulk.push(list.length); return new Map(list.map((m) => [m.id, m])); },
    send: async (text) => {
      calls.sends.push(text);
      nextId += 1;
      return { id: `s${nextId}`, url: `https://discord.com/channels/1/2/s${nextId}` };
    },
  };
}

const chatMessage = (id, { pinned = false, ageMs = 0 } = {}) => ({
  id, pinned, createdTimestamp: Date.now() - ageMs, __board: false,
  delete: async () => {},
});
const boardMessage = (id) => ({ ...chatMessage(id), __board: true });

function makeHandler({ channel, updateResult = { action: 'reposted', teamCount: 8, panelCount: 2 }, updateError } = {}) {
  const poster = {
    isBoard: (m) => m.__board === true,
    update: async () => { if (updateError) throw updateError; return updateResult; },
  };
  return createDmHandler({
    client: { channels: { fetch: async () => channel } },
    config,
    poster,
    describeUpdate: (r) => `Leaderboard ${r.action} with ${r.teamCount} team(s).`,
    log: SILENT,
  });
}

// --- Who is obeyed -----------------------------------------------------------

test('a stranger is ignored in silence', async () => {
  const channel = makeChannel();
  const message = makeMessage({ author: STRANGER, content: '-reload' });
  await makeHandler({ channel })(message);

  assert.deepEqual(message.replies, [], 'no reply - do not advertise that commands exist');
  assert.deepEqual(channel.calls.sends, []);
});

test('commands sent in a guild channel are ignored', async () => {
  const channel = makeChannel();
  const message = makeMessage({ content: '-reload', guild: { id: 'g1' } });
  await makeHandler({ channel })(message);
  assert.deepEqual(message.replies, [], 'DM only');
});

test('other bots are ignored', async () => {
  const channel = makeChannel();
  const message = makeMessage({ content: '-reload', bot: true });
  await makeHandler({ channel })(message);
  assert.deepEqual(message.replies, []);
});

test('ordinary DM chat provokes no reply', async () => {
  const message = makeMessage({ content: 'hello' });
  await makeHandler({ channel: makeChannel() })(message);
  assert.deepEqual(message.replies, []);
});

test('an unknown command is reported to the owner', async () => {
  const message = makeMessage({ content: '-wibble' });
  await makeHandler({ channel: makeChannel() })(message);
  assert.match(message.replies[0], /Unknown command/);
});

// --- -reload -----------------------------------------------------------------

test('-reload forces an update and reports the outcome', async () => {
  const message = makeMessage({ content: '-reload' });
  await makeHandler({ channel: makeChannel() })(message);
  assert.match(message.replies[0], /Reloaded/);
  assert.match(message.replies[0], /Leaderboard reposted with 8 team\(s\)/);
});

test('a failing reload reports the reason rather than going quiet', async () => {
  const message = makeMessage({ content: '-reload' });
  await makeHandler({ channel: makeChannel(), updateError: new Error('sheet is down') })(message);
  assert.match(message.replies[0], /sheet is down/);
});

// --- -post -------------------------------------------------------------------

test('-post sends the text to the leaderboard channel', async () => {
  const channel = makeChannel();
  const message = makeMessage({ content: "-post 'board frozen for an hour'" });
  await makeHandler({ channel })(message);

  assert.deepEqual(channel.calls.sends, ['board frozen for an hour']);
  assert.match(message.replies[0], /Posted/);
});

test('-post works without quotes', async () => {
  const channel = makeChannel();
  await makeHandler({ channel })(makeMessage({ content: '-post board frozen for an hour' }));
  assert.deepEqual(channel.calls.sends, ['board frozen for an hour']);
});

test('-post with nothing to say is refused', async () => {
  const channel = makeChannel();
  const message = makeMessage({ content: '-post' });
  await makeHandler({ channel })(message);
  assert.deepEqual(channel.calls.sends, []);
  assert.match(message.replies[0], /needs something to say/);
});

test('-post text over the Discord limit is truncated rather than rejected', async () => {
  const channel = makeChannel();
  await makeHandler({ channel })(makeMessage({ content: `-post ${'x'.repeat(2500)}` }));
  assert.equal(channel.calls.sends[0].length, 2000);
});

// --- -delete -----------------------------------------------------------------

test('-delete removes the requested number of messages', async () => {
  const channel = makeChannel([chatMessage('a'), chatMessage('b'), chatMessage('c')]);
  const message = makeMessage({ content: '-delete 2' });
  await makeHandler({ channel })(message);

  assert.deepEqual(channel.calls.bulk, [2], 'exactly two, not all three');
  assert.match(message.replies[0], /Deleted 2 message\(s\)/);
});

test('-delete never touches the leaderboard panels', async () => {
  const channel = makeChannel([boardMessage('board1'), boardMessage('board2'), chatMessage('chat')]);
  const message = makeMessage({ content: '-delete 5' });
  await makeHandler({ channel })(message);

  assert.deepEqual(channel.calls.bulk, [1], 'only the one non-board message');
  assert.match(message.replies[0], /left alone/);
});

test('-delete skips pinned messages', async () => {
  const channel = makeChannel([chatMessage('pinned', { pinned: true }), chatMessage('chat')]);
  await makeHandler({ channel })(makeMessage({ content: '-delete 5' }));
  assert.deepEqual(channel.calls.bulk, [1]);
});

test('-delete says so when there is nothing to remove', async () => {
  const channel = makeChannel([boardMessage('board1')]);
  const message = makeMessage({ content: '-delete 5' });
  await makeHandler({ channel })(message);
  assert.match(message.replies[0], /Nothing to delete/);
  assert.deepEqual(channel.calls.bulk, []);
});

test('-delete rejects a non-number', async () => {
  const channel = makeChannel([chatMessage('a')]);
  const message = makeMessage({ content: '-delete lots' });
  await makeHandler({ channel })(message);
  assert.match(message.replies[0], /whole number/);
  assert.deepEqual(channel.calls.bulk, []);
});

test('-delete rejects zero and negatives', async () => {
  for (const n of ['0', '-3']) {
    const channel = makeChannel([chatMessage('a')]);
    const message = makeMessage({ content: `-delete ${n}` });
    await makeHandler({ channel })(message);
    assert.match(message.replies[0], /whole number/, `input ${n}`);
    assert.deepEqual(channel.calls.bulk, []);
  }
});

test('-delete refuses more than Discord allows', async () => {
  const channel = makeChannel([chatMessage('a')]);
  const message = makeMessage({ content: `-delete ${MAX_DELETE + 1}` });
  await makeHandler({ channel })(message);
  assert.match(message.replies[0], new RegExp(String(MAX_DELETE)));
  assert.deepEqual(channel.calls.bulk, []);
});

test('messages over 14 days old are deleted one at a time', async () => {
  const old = chatMessage('old', { ageMs: 15 * 24 * 60 * 60 * 1000 });
  let deleted = false;
  old.delete = async () => { deleted = true; };
  const channel = makeChannel([chatMessage('new'), old]);

  const message = makeMessage({ content: '-delete 2' });
  await makeHandler({ channel })(message);

  assert.deepEqual(channel.calls.bulk, [1], 'only the recent one goes in the bulk call');
  assert.equal(deleted, true, 'the old one is deleted individually');
  assert.match(message.replies[0], /Deleted 2 message\(s\)/);
});

// --- -help -------------------------------------------------------------------

test('-help lists every command', async () => {
  const message = makeMessage({ content: '-help' });
  await makeHandler({ channel: makeChannel() })(message);
  for (const name of ['-reload', '-delete', '-post', '-help']) {
    assert.ok(message.replies[0].includes(name), `help should mention ${name}`);
  }
});

// --- Which of the bot's own messages -delete will remove ---------------------

test('-delete removes the bot own plain messages, such as those from -post', async () => {
  // A -post message carries no embed, so it is chat rather than a panel.
  const ownPost = { ...chatMessage('own-post'), __board: false };
  const channel = makeChannel([ownPost]);

  const message = makeMessage({ content: '-delete 5' });
  await makeHandler({ channel })(message);

  assert.deepEqual(channel.calls.bulk, [1], 'a -post message is deletable');
  assert.match(message.replies[0], /Deleted 1 message\(s\)/);
});

test('-delete never removes a leaderboard panel, even to reach the count asked for', async () => {
  const channel = makeChannel([
    boardMessage('panel-1'),
    boardMessage('panel-2'),
    chatMessage('chat-1'),
    chatMessage('chat-2'),
  ]);

  const message = makeMessage({ content: '-delete 4' });
  await makeHandler({ channel })(message);

  assert.deepEqual(channel.calls.bulk, [2], 'only the two non-panel messages');
});

// --- -freeze / -unfreeze ------------------------------------------------------

function makeState(initial = {}) {
  let data = { frozen: false, ...initial };
  return { read: () => ({ ...data }), write: (next) => { data = { ...next }; }, peek: () => data };
}

function frozenHandler(state, channel = makeChannel()) {
  return createDmHandler({
    client: { channels: { fetch: async () => channel } },
    config,
    poster: { isBoard: () => false, update: async () => ({ action: 'reposted', teamCount: 8, panelCount: 2 }) },
    state,
    describeUpdate: (r) => `Leaderboard ${r.action}.`,
    log: SILENT,
  });
}

test('-freeze records the freeze so it survives a restart', async () => {
  const state = makeState();
  const message = makeMessage({ content: '-freeze' });
  await frozenHandler(state)(message);

  assert.equal(state.peek().frozen, true, 'persisted, not held in memory');
  assert.match(message.replies[0], /Frozen/);
});

test('-unfreeze clears it', async () => {
  const state = makeState({ frozen: true });
  const message = makeMessage({ content: '-unfreeze' });
  await frozenHandler(state)(message);

  assert.equal(state.peek().frozen, false);
  assert.match(message.replies[0], /Unfrozen/);
});

test('freezing twice says so rather than pretending to act', async () => {
  const state = makeState({ frozen: true });
  const message = makeMessage({ content: '-freeze' });
  await frozenHandler(state)(message);
  assert.match(message.replies[0], /Already frozen/);
});

test('unfreezing when not frozen says so', async () => {
  const state = makeState({ frozen: false });
  const message = makeMessage({ content: '-unfreeze' });
  await frozenHandler(state)(message);
  assert.match(message.replies[0], /Not frozen/);
});

test('-reload still works while frozen: freeze stops the timer, not you', async () => {
  const state = makeState({ frozen: true });
  const message = makeMessage({ content: '-reload' });
  await frozenHandler(state)(message);

  assert.match(message.replies[0], /Reloaded/);
  assert.equal(state.peek().frozen, true, 'and it stays frozen afterwards');
});

test('freezing preserves the rest of the state', async () => {
  const state = makeState({ frozen: false, history: [{ at: 't1', points: { A: 1 } }], leader: { teamName: 'A' } });
  await frozenHandler(state)(makeMessage({ content: '-freeze' }));

  assert.equal(state.peek().history.length, 1, 'history must not be lost');
  assert.equal(state.peek().leader.teamName, 'A');
});

test('-help lists the freeze commands', async () => {
  const message = makeMessage({ content: '-help' });
  await frozenHandler(makeState())(message);
  assert.ok(message.replies[0].includes('-freeze'));
  assert.ok(message.replies[0].includes('-unfreeze'));
});

// --- -line-test ---------------------------------------------------------------

const { recordSnapshot } = require('../src/history');

function historyState(hours = 48) {
  let history = [];
  const now = Date.now();
  for (let h = hours; h >= 0; h--) {
    history = recordSnapshot(
      history,
      [{ teamName: 'Alpha', points: (hours - h) * 10 }, { teamName: 'Bravo', points: (hours - h) * 7 }],
      new Date(now - h * 3600 * 1000).toISOString()
    );
  }
  let data = { history, frozen: false };
  return { read: () => ({ ...data }), write: (next) => { data = { ...next }; } };
}

test('-line-test returns a PNG attachment rather than text', async () => {
  const message = makeMessage({ content: '-line-test' });
  await frozenHandler(historyState())(message);

  const reply = message.replies[0];
  assert.ok(reply.files, 'the reply carries a file');
  assert.equal(reply.files[0].name, 'bingo-history.png');
  assert.equal(reply.files[0].attachment.slice(1, 4).toString('ascii'), 'PNG');
});

test('-line-test accepts a period', async () => {
  for (const period of ['24h', '7d', '']) {
    const message = makeMessage({ content: `-line-test ${period}`.trim() });
    await frozenHandler(historyState(240))(message);
    assert.ok(message.replies[0].files, `period "${period}" should render`);
  }
});

test('-line-test rejects an unknown period instead of silently using all', async () => {
  const message = makeMessage({ content: '-line-test last-tuesday' });
  await frozenHandler(historyState())(message);
  assert.match(message.replies[0], /Unknown period/);
});

test('-line-test explains itself when there is no history yet', async () => {
  const empty = { read: () => ({ history: [], frozen: false }), write: () => {} };
  const message = makeMessage({ content: '-line-test' });
  await frozenHandler(empty)(message);
  assert.match(message.replies[0], /Not enough history/);
});

test('-line-test is developer-only like the rest', async () => {
  const message = makeMessage({ author: STRANGER, content: '-line-test' });
  await frozenHandler(historyState())(message);
  assert.deepEqual(message.replies, []);
});
