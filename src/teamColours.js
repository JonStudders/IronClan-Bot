'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Team colours, read from team-colours.json at the repo root.
 *
 * Kept in a committed file rather than .env: there is one entry per team, it
 * changes every bingo, and a push redeploys it - no hand edit on the server.
 *
 * Entries are keyed by captain for now, since team names are not decided, but
 * a team name is accepted as a key too. A captain match wins, because that is
 * what the file is written against.
 */
const DEFAULT_FILE = path.join(__dirname, '..', 'team-colours.json');
const HEX = /^#[0-9a-f]{6}$/i;

/** "  CAPTAIN  Peww " and "captain peww" are the same person. */
function normaliseName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Builds a lookup from a { name: "#hex" } map. Invalid colours are dropped
 * with a warning rather than failing startup - a typo in one colour must not
 * take the leaderboard down.
 */
function createColourLookup(colours = {}, { log = console } = {}) {
  const byName = new Map();

  for (const [name, colour] of Object.entries(colours)) {
    if (!HEX.test(String(colour))) {
      log.warn?.(`Ignoring team colour for "${name}": "${colour}" is not a #rrggbb colour.`);
      continue;
    }
    byName.set(normaliseName(name), colour.toLowerCase());
  }

  return function colourFor({ captain, teamName } = {}) {
    return byName.get(normaliseName(captain)) ?? byName.get(normaliseName(teamName)) ?? null;
  };
}

/** Loads the committed file. A missing or unreadable file means no colours, not a crash. */
function loadColourLookup({ file = DEFAULT_FILE, log = console } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return createColourLookup(parsed.colours ?? {}, { log });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.warn?.(`Could not read team colours from ${file}:`, error.message);
    }
    return createColourLookup({}, { log });
  }
}

module.exports = { createColourLookup, loadColourLookup, normaliseName };
