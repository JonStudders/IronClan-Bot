'use strict';

const MS_PER_MINUTE = 60 * 1000;

/**
 * Runs `task` on a repeating delay, backing off to `retryMinutes` whenever it
 * throws. Each run is scheduled only after the previous one settles, so a slow
 * update can never overlap itself.
 *
 * `timers` is injectable so tests can drive it without real time passing.
 */
function createScheduler({
  task,
  intervalMinutes,
  retryMinutes,
  onError = () => {},
  timers = { setTimeout, clearTimeout },
}) {
  let timer = null;
  let stopped = false;

  async function run() {
    if (stopped) return;
    try {
      await task();
      schedule(intervalMinutes);
    } catch (error) {
      onError(error);
      schedule(retryMinutes);
    }
  }

  function schedule(minutes) {
    if (stopped) return;
    timer = timers.setTimeout(run, minutes * MS_PER_MINUTE);
  }

  function stop() {
    stopped = true;
    if (timer) timers.clearTimeout(timer);
    timer = null;
  }

  return { start: run, stop };
}

module.exports = { createScheduler, MS_PER_MINUTE };
