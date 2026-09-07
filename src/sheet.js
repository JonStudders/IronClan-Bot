'use strict';

const PublicGoogleSheetsParser = require('public-google-sheets-parser');

/**
 * Expected sheet headers, most preferred name first. Several are listed per
 * field because the header text has changed between bingos (e.g. "Points"
 * became "Total Points (Bonus Included)"), and matching a list means a rename
 * does not silently blank the column.
 *
 * Row keys are trimmed before lookup, so trailing whitespace does not matter.
 */
const COLUMNS = {
  teamName: ['Team Name'],
  points: ['Total Points (Bonus Included)', 'Total Points', 'Points'],
  captain: ['Team Captain'],
  coCaptain: ['Team Co-Captain'],
  completion: ['Board Completion %'],
};

/**
 * Google Sheets renders failed formulas as these literal strings. They arrive
 * as text, so without this they would coerce to NaN and be indistinguishable
 * from a genuinely malformed cell.
 */
const SHEET_ERROR_VALUES = new Set([
  '#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!', '#ERROR!',
]);

/** Strips whitespace from a row's column names so header edits don't break us. */
function normaliseKeys(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), value]));
}

/** First candidate header actually present on the row, or undefined. */
function findKey(row, candidates) {
  return candidates.find((name) => Object.hasOwn(row, name));
}

function readCell(row, candidates) {
  const key = findKey(row, candidates);
  return key === undefined ? undefined : row[key];
}

function isSheetError(value) {
  return typeof value === 'string' && SHEET_ERROR_VALUES.has(value.trim().toUpperCase());
}

/** Numeric cell value, or null for blanks, sheet errors and unparseable text. */
function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (isSheetError(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTrimmedString(value) {
  if (value === undefined || value === null || isSheetError(value)) return '';
  return String(value).trim();
}

/**
 * A row belongs to the leaderboard if it names a team AND carries the
 * leaderboard's own points column.
 *
 * The second test is what separates the leaderboard from the other tables
 * further down the same tab (the WOM link, the "Top EHB gainer per team"
 * block): those rows reuse the first column for their own purposes, so some
 * carry a team name, but none of them have the points column. Filtering rather
 * than stopping at the first non-team row means blank spacer rows inside the
 * leaderboard are still tolerated.
 */
function isLeaderboardRow(row) {
  return toTrimmedString(readCell(row, COLUMNS.teamName)) !== '' && findKey(row, COLUMNS.points) !== undefined;
}

/**
 * Turns raw sheet rows into team objects, keeping raw numeric values so we can
 * sort on them accurately and format only at render time.
 */
function parseTeams(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('Sheet returned no usable data - check the sheet id and that it is public.');
  }

  return rows
    .map(normaliseKeys)
    .filter(isLeaderboardRow)
    .map((row) => ({
      teamName: toTrimmedString(readCell(row, COLUMNS.teamName)),
      captain: toTrimmedString(readCell(row, COLUMNS.captain)),
      coCaptain: toTrimmedString(readCell(row, COLUMNS.coCaptain)),
      points: toNumberOrNull(readCell(row, COLUMNS.points)),
      completion: toNumberOrNull(readCell(row, COLUMNS.completion)),
    }));
}

/**
 * Highest points first, ties broken by board completion. Teams whose points
 * are unreadable sink to the bottom rather than being dropped, so the problem
 * is visible on the board instead of silent. Returns a new array.
 */
function sortTeams(teams) {
  return [...teams].sort((a, b) => {
    if (a.points === null && b.points === null) return 0;
    if (a.points === null) return 1;
    if (b.points === null) return -1;
    return b.points - a.points || (b.completion ?? 0) - (a.completion ?? 0);
  });
}

/**
 * Wraps the sheet parser so callers depend on this module rather than the
 * third-party client, and so tests can swap in a stub.
 */
function createSheetReader(config) {
  const parser = new PublicGoogleSheetsParser(config.sheetId, { sheetName: config.sheetName });
  return async function readTeams() {
    return parseTeams(await parser.parse());
  };
}

module.exports = {
  COLUMNS,
  SHEET_ERROR_VALUES,
  parseTeams,
  sortTeams,
  createSheetReader,
  normaliseKeys,
  toNumberOrNull,
  isSheetError,
  isLeaderboardRow,
};
