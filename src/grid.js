'use strict';

/**
 * Reads a sheet tab as a raw 2D grid of cells.
 *
 * The leaderboard itself is read with public-google-sheets-parser, which keys
 * rows by their header text. That is the right shape for a single table, but
 * it silently drops every column whose header cell is blank - and the gainer
 * tables further down the tab sit under blank headers. So they need the
 * untouched grid, which is what Google's gviz endpoint returns.
 */
const GVIZ_PREFIX_PATTERN = /^[^{]*setResponse\(/;

function buildUrl(sheetId, sheetName) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}`
    + `/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
}

/**
 * gviz wraps its JSON in a JavaScript callback, e.g.
 * `/*O_o* /\ngoogle.visualization.Query.setResponse({...});`
 */
function unwrapGvizResponse(body) {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Unexpected response from Google Sheets - is the sheet public?');
  }
  return JSON.parse(body.slice(start, end + 1));
}

/** Prefer the formatted value, so "0.00" and "1,234" survive as displayed. */
function cellText(cell) {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null) return String(cell.f);
  if (cell.v !== undefined && cell.v !== null) return String(cell.v);
  return '';
}

/** Turns a gviz payload into a rectangular grid of trimmed strings. */
function toGrid(payload) {
  const table = payload?.table;
  if (!table || !Array.isArray(table.rows)) {
    throw new Error('Sheet returned no usable grid data.');
  }

  const width = Math.max(
    table.cols?.length ?? 0,
    ...table.rows.map((row) => row?.c?.length ?? 0)
  );

  return table.rows.map((row) => {
    const cells = row?.c ?? [];
    return Array.from({ length: width }, (_, i) => cellText(cells[i]).trim());
  });
}

async function fetchGrid(sheetId, sheetName, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(buildUrl(sheetId, sheetName));
  if (!response.ok) {
    throw new Error(`Google Sheets returned ${response.status} for tab "${sheetName}".`);
  }
  return toGrid(unwrapGvizResponse(await response.text()));
}

/** Wraps the reader so callers depend on this module, not on fetch. */
function createGridReader(config) {
  return async function readGrid() {
    return fetchGrid(config.sheetId, config.sheetName);
  };
}

module.exports = { fetchGrid, createGridReader, toGrid, unwrapGvizResponse, cellText, buildUrl };
