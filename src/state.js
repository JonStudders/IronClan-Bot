'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Small JSON file holding what the bot needs to remember between runs: the
 * message ids of the boards it owns, the previous standings (so rank movement
 * survives a restart) and the history of lead changes.
 *
 * Deliberately not a database. Every read tolerates the file being absent or
 * corrupt by falling back to empty state, because losing it should cost a
 * round of rank arrows, never a crash.
 */
const EMPTY_STATE = {
  panelCount: 0,        // how many messages the bot maintained last time
  previousRanks: {},    // team name -> rank at the previous update
  leader: null,         // { teamName, since } - since is an ISO timestamp
  leadChanges: [],      // newest first: { from, to, at }
};

const MAX_LEAD_CHANGES = 20;

function createStateStore({ filePath, log = console }) {
  function read() {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      // Keep only fields we still recognise, so a file written by an older
      // version migrates cleanly instead of accumulating dead keys.
      const known = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => Object.hasOwn(EMPTY_STATE, key))
      );
      return { ...structuredClone(EMPTY_STATE), ...known };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log.warn?.(`Could not read state file (${filePath}), starting fresh:`, error.message);
      }
      return structuredClone(EMPTY_STATE);
    }
  }

  function write(state) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
      // Write-then-rename so an interrupted write cannot leave a truncated file.
      const temp = `${filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(state, null, 2));
      fs.renameSync(temp, filePath);
      return true;
    } catch (error) {
      log.warn?.(`Could not write state file (${filePath}):`, error.message);
      return false;
    }
  }

  return { read, write };
}

/** Team name -> rank, from an already-sorted list. */
function ranksFromStandings(sortedTeams) {
  return Object.fromEntries(sortedTeams.map((team, index) => [team.teamName, index + 1]));
}

/**
 * Folds a new set of standings into the previous state, returning the state to
 * persist plus whether the lead changed hands this update.
 */
function applyStandings(state, sortedTeams, at = new Date().toISOString()) {
  const leaderName = sortedTeams[0]?.teamName ?? null;
  const previousLeader = state.leader?.teamName ?? null;
  const leadChanged = Boolean(leaderName) && previousLeader !== null && leaderName !== previousLeader;

  const leadChanges = leadChanged
    ? [{ from: previousLeader, to: leaderName, at }, ...state.leadChanges].slice(0, MAX_LEAD_CHANGES)
    : state.leadChanges;

  return {
    next: {
      ...state,
      previousRanks: ranksFromStandings(sortedTeams),
      leader: leaderName
        ? { teamName: leaderName, since: leadChanged || !state.leader ? at : state.leader.since }
        : state.leader,
      leadChanges,
    },
    leadChanged,
  };
}

module.exports = { createStateStore, applyStandings, ranksFromStandings, EMPTY_STATE, MAX_LEAD_CHANGES };
