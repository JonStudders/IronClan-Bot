'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createScheduler, MS_PER_MINUTE } = require('../src/scheduler');

/** Fake timers: records delays and lets the test fire the pending callback. */
function makeTimers() {
  const delays = [];
  let pending = null;
  let cleared = false;

  return {
    delays,
    fire: async () => {
      const fn = pending;
      pending = null;
      if (fn) await fn();
    },
    wasCleared: () => cleared,
    api: {
      setTimeout: (fn, ms) => { delays.push(ms); pending = fn; return { id: delays.length }; },
      clearTimeout: () => { cleared = true; pending = null; },
    },
  };
}

test('schedules the normal interval after a successful run', async () => {
  const timers = makeTimers();
  const scheduler = createScheduler({
    task: async () => {},
    intervalMinutes: 10,
    retryMinutes: 1,
    timers: timers.api,
  });

  await scheduler.start();
  assert.deepEqual(timers.delays, [10 * MS_PER_MINUTE]);
});

test('backs off to the retry interval after a failure', async () => {
  const timers = makeTimers();
  const errors = [];
  const scheduler = createScheduler({
    task: async () => { throw new Error('boom'); },
    intervalMinutes: 10,
    retryMinutes: 1,
    onError: (e) => errors.push(e.message),
    timers: timers.api,
  });

  await scheduler.start();
  assert.deepEqual(timers.delays, [1 * MS_PER_MINUTE]);
  assert.deepEqual(errors, ['boom']);
});

test('a failure does not stop the loop, and it recovers to the normal interval', async () => {
  const timers = makeTimers();
  let attempt = 0;
  const scheduler = createScheduler({
    task: async () => { attempt++; if (attempt === 1) throw new Error('transient'); },
    intervalMinutes: 10,
    retryMinutes: 1,
    timers: timers.api,
  });

  await scheduler.start();        // fails -> retry delay
  await timers.fire();            // succeeds -> normal delay
  assert.deepEqual(timers.delays, [1 * MS_PER_MINUTE, 10 * MS_PER_MINUTE]);
  assert.equal(attempt, 2);
});

test('runs never overlap: the next is scheduled only after the previous settles', async () => {
  const timers = makeTimers();
  let running = 0;
  let maxConcurrent = 0;
  const scheduler = createScheduler({
    task: async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setImmediate(r));
      running--;
    },
    intervalMinutes: 10,
    retryMinutes: 1,
    timers: timers.api,
  });

  await scheduler.start();
  await timers.fire();
  await timers.fire();
  assert.equal(maxConcurrent, 1);
});

test('stop() prevents any further scheduling', async () => {
  const timers = makeTimers();
  const scheduler = createScheduler({
    task: async () => {},
    intervalMinutes: 10,
    retryMinutes: 1,
    timers: timers.api,
  });

  await scheduler.start();
  const countAfterStart = timers.delays.length;
  scheduler.stop();
  assert.ok(timers.wasCleared(), 'stop() should clear the pending timer');
  await scheduler.start(); // must be a no-op once stopped
  assert.equal(timers.delays.length, countAfterStart);
});

test('errors thrown by onError reporting do not escape as unhandled rejections', async () => {
  const timers = makeTimers();
  const scheduler = createScheduler({
    task: async () => { throw new Error('boom'); },
    intervalMinutes: 10,
    retryMinutes: 1,
    onError: () => {},
    timers: timers.api,
  });

  await assert.doesNotReject(() => scheduler.start());
});
