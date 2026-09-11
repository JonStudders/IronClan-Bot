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
    reply: async (text) => { replies.push(typeof text === 'string' ? text : text.content); },
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
