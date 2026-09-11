'use strict';

const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { recordSnapshot } = require('../src/history');
const { renderPointsChart, toSeries, niceStep, SERIES_COLOURS, MAX_SERIES } = require('../src/chart');
const { createCanvas, drawText, encodePng, textWidth, renderTextRows, GLYPH_HEIGHT } = require('../src/png');

function buildHistory(hours, names) {
  let history = [];
  const now = Date.UTC(2026, 8, 11, 12, 0, 0);
  for (let h = hours; h >= 0; h--) {
    const teams = names.map((name, i) => ({ teamName: name, points: (10 - i) * (hours - h) }));
    history = recordSnapshot(history, teams, new Date(now - h * 3600 * 1000).toISOString());
  }
  return history;
}

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);

// --- PNG encoding ------------------------------------------------------------

test('the encoder produces a structurally valid PNG', () => {
  const png = encodePng(createCanvas(10, 6, '#112233'));

  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'signature');
  assert.equal(png.slice(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 10, 'width');
  assert.equal(png.readUInt32BE(20), 6, 'height');
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 6, 'colour type RGBA');
  assert.equal(png.slice(-8, -4).toString('ascii'), 'IEND');
});

test('the pixel data round-trips through the deflate stream', () => {
  const canvas = createCanvas(4, 2, '#ff0000');
  const png = encodePng(canvas);

  // Find IDAT and inflate it back to scanlines.
  let offset = 8;
  let idat = null;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat = png.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  assert.ok(idat, 'an IDAT chunk exists');

  const raw = zlib.inflateSync(idat);
  assert.equal(raw.length, 2 * (4 * 4 + 1), 'one filter byte per scanline plus RGBA');
  assert.equal(raw[0], 0, 'filter type none');
  assert.deepEqual([raw[1], raw[2], raw[3], raw[4]], [255, 0, 0, 255], 'first pixel is red');
});

// --- The font ----------------------------------------------------------------

test('every character the charts use has a glyph', () => {
  const used = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:-+%()/';
  for (const char of used) {
    const rows = renderTextRows(char);
    assert.equal(rows.length, GLYPH_HEIGHT, `${char} has the right height`);
    if (char !== ' ') {
      assert.ok(rows.some((row) => row.includes('#')), `${char} is not blank`);
    }
  }
});

test('confusable glyphs are drawn at different heights', () => {
  // 'g' sits at x-height, '9' at cap height; without that they are the same shape.
  const topRowOf = (char) => renderTextRows(char).findIndex((row) => row.includes('#'));
  assert.ok(topRowOf('g') > topRowOf('9'), 'g starts lower than 9');
  assert.ok(topRowOf('p') > topRowOf('P'), 'p starts lower than P');
});

test('text width matches what is actually drawn', () => {
  const canvas = createCanvas(200, 20, '#000000');
  drawText(canvas, 'Hi', 0, 0, '#ffffff', 1);

  let rightmost = 0;
  for (let x = 0; x < canvas.width; x++) {
    for (let y = 0; y < canvas.height; y++) {
      if (canvas.data[(y * canvas.width + x) * 4] > 0) rightmost = Math.max(rightmost, x);
    }
  }
  assert.ok(rightmost < textWidth('Hi'), `ink ends at ${rightmost}, inside ${textWidth('Hi')}`);
});

// --- Axis scaling ------------------------------------------------------------

test('axis steps are round numbers', () => {
  for (const [span, expected] of [[100, 20], [2700, 1000], [9, 2], [55000, 20000]]) {
    const step = niceStep(span, 5);
    assert.ok([1, 2, 5].includes(step / 10 ** Math.floor(Math.log10(step))), `${span} -> ${step}`);
    assert.equal(step, expected, `span ${span}`);
  }
});

// --- Series ------------------------------------------------------------------

test('series are taken best first and capped so hues stay distinct', () => {
  const names = Array.from({ length: 12 }, (_, i) => `Team${i}`);
  const series = toSeries(buildHistory(20, names));
  assert.equal(series.length, MAX_SERIES);
  assert.equal(series[0].name, 'Team0', 'the leader comes first');
});

test('colours are assigned in fixed slot order, never cycled', () => {
  const series = toSeries(buildHistory(20, ['A', 'B', 'C']));
  assert.deepEqual(series.map((s) => s.colour), SERIES_COLOURS.slice(0, 3));
});

// --- Rendering ---------------------------------------------------------------

test('a chart is not drawn from too little history', () => {
  assert.equal(renderPointsChart([], { now: NOW }), null);
  assert.equal(renderPointsChart(buildHistory(0, ['A']), { now: NOW }), null, 'one snapshot is not a line');
});

test('a chart renders to a PNG of sensible size', () => {
  const png = renderPointsChart(buildHistory(48, ['Alpha', 'Bravo']), { now: NOW });
  assert.ok(Buffer.isBuffer(png));
  assert.equal(png.slice(1, 4).toString('ascii'), 'PNG');

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.ok(width > 400 && width < 1600, `width ${width}`);
  assert.ok(height > 200 && height < 800, `height ${height}`);
  assert.ok(png.length < 200 * 1024, 'well inside Discord\'s attachment limit');
});

test('the image widens to fit the longest team name, so a label cannot be clipped', () => {
  const narrow = renderPointsChart(buildHistory(24, ['A']), { now: NOW }).readUInt32BE(16);
  const wide = renderPointsChart(
    buildHistory(24, ['Pot Arams Winning Gooners']), { now: NOW }
  ).readUInt32BE(16);
  assert.ok(wide > narrow, `${wide} should exceed ${narrow}`);
});

test('a period restricts the chart to that window', () => {
  const history = buildHistory(240, ['Alpha']);
  const all = renderPointsChart(history, { now: NOW, hours: 0 });
  const day = renderPointsChart(history, { now: NOW, hours: 24 });
  assert.ok(all && day);
  assert.notDeepEqual(all, day, 'a narrower window draws a different chart');
});
