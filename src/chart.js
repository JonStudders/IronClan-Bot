'use strict';

const {
  createCanvas, fillRect, drawLine, drawText, downsample, encodePng, textWidth,
  GLYPH_HEIGHT,
} = require('./png');
const { withinPeriod, seriesFor } = require('./history');

/**
 * A points-over-time line chart, rendered to PNG.
 *
 * Colours are the validated dark-mode categorical palette, in fixed slot order
 * so a team keeps its colour as others come and go. The worst adjacent pair
 * sits in the 6-8 colour-vision separation band, which is only permitted
 * alongside a second encoding - hence the direct labels on every line, which
 * are not decoration but the thing that makes the chart readable without
 * relying on hue.
 */
const SURFACE = '#1a1a19';
const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#c3c2b7';
const GRID = '#2f2f2d';

/** Categorical slots 1-6, dark steps. Assigned in order, never cycled. */
const SERIES_COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

/** Past this, hues stop being separable - fold the rest away instead. */
const MAX_SERIES = SERIES_COLOURS.length;

/** Drawn at this multiple and averaged down, which is what smooths the lines. */
const SUPERSAMPLE = 2;

const FONT = { label: 2, title: 3 };

function scaled(size) {
  return size * SUPERSAMPLE;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString('en-GB');
}

/** Round numbers for the y axis: 1/2/5 x a power of ten. */
function niceStep(span, targetTicks) {
  const rough = span / Math.max(targetTicks, 1);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  for (const multiple of [1, 2, 5, 10]) {
    if (magnitude * multiple >= rough) return magnitude * multiple;
  }
  return magnitude * 10;
}

function shortTime(iso) {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
  return `${day} ${month}`;
}

/**
 * Builds one series per team from the history, best first, capped so the hues
 * stay distinguishable.
 */
function toSeries(history, maxSeries = MAX_SERIES) {
  const latest = history[history.length - 1];
  return Object.keys(latest.points)
    .sort((a, b) => latest.points[b] - latest.points[a])
    .slice(0, maxSeries)
    .map((name, index) => ({
      name,
      colour: SERIES_COLOURS[index],
      values: seriesFor(history, name),
    }))
    .filter((series) => series.values.length > 1);
}

/**
 * Renders the chart. Returns a PNG buffer, or null when there is not yet
 * enough history to draw a line.
 */
function renderPointsChart(history, { hours = 0, now = Date.now(), title = 'Points over time' } = {}) {
  const period = withinPeriod(history, hours, now);
  if (period.length < 2) return null;

  const series = toSeries(period);
  if (series.length === 0) return null;

  const all = series.flatMap((s) => s.values);
  const dataMax = Math.max(...all);
  const dataMin = Math.min(...all);

  const step = niceStep(dataMax - Math.min(dataMin, 0) || 1, 5);
  const yMax = Math.ceil(dataMax / step) * step || step;
  // Scores do not go negative, so the axis starts at zero rather than opening
  // an empty band below it.
  const yMin = dataMin >= 0 ? 0 : Math.floor(dataMin / step) * step;

  // The right gutter is sized to the longest team name, so a direct label can
  // never be clipped - an anti-pattern the labels exist to avoid.
  const longestLabel = Math.max(...series.map((s) => textWidth(s.name) * FONT.label))
    + FONT.label * 3 + 5;
  const padding = {
    left: 12 + textWidth(formatNumber(yMax)) * FONT.label + 10,
    right: longestLabel + 26,
    top: 18 + GLYPH_HEIGHT * FONT.title + 16,
    bottom: 14 + GLYPH_HEIGHT * FONT.label + 12,
  };

  const plotWidth = 520;
  const plotHeight = 260;
  const width = padding.left + plotWidth + padding.right;
  const height = padding.top + plotHeight + padding.bottom;

  const canvas = createCanvas(scaled(width), scaled(height), SURFACE);

  const px = (value) => scaled(padding.left + value);
  const py = (value) => scaled(padding.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight);

  drawText(canvas, title, scaled(padding.left), scaled(18), TEXT_PRIMARY, scaled(FONT.title));

  // Gridlines: solid hairlines one shade off the surface, never dashed.
  for (let value = yMin; value <= yMax; value += step) {
    const y = py(value);
    drawLine(canvas, px(0), y, px(plotWidth), y, GRID, 1);
    const label = formatNumber(value);
    drawText(
      canvas,
      label,
      scaled(padding.left - 10) - textWidth(label) * scaled(FONT.label),
      y - scaled((GLYPH_HEIGHT * FONT.label) / 2),
      TEXT_SECONDARY,
      scaled(FONT.label)
    );
  }

  // The x axis carries only its endpoints: a tick per snapshot would be noise.
  const axisY = py(yMin);
  drawLine(canvas, px(0), axisY, px(plotWidth), axisY, GRID, 2);
  const from = shortTime(period[0].at);
  const to = shortTime(period[period.length - 1].at);
  const labelY = scaled(padding.top + plotHeight + 14);
  drawText(canvas, from, px(0), labelY, TEXT_SECONDARY, scaled(FONT.label));
  drawText(
    canvas,
    to,
    px(plotWidth) - textWidth(to) * scaled(FONT.label),
    labelY,
    TEXT_SECONDARY,
    scaled(FONT.label)
  );

  // Lines, then labels, so a label is never drawn under a later line.
  const ends = [];
  for (const line of series) {
    const count = line.values.length;
    for (let i = 1; i < count; i++) {
      drawLine(
        canvas,
        px(((i - 1) / (count - 1)) * plotWidth), py(line.values[i - 1]),
        px((i / (count - 1)) * plotWidth), py(line.values[i]),
        line.colour,
        scaled(2)
      );
    }
    ends.push({ ...line, y: py(line.values[count - 1]) });
  }

  // Nudge labels apart so two close finishes do not overprint each other.
  const labelHeight = scaled(GLYPH_HEIGHT * FONT.label + 4);
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].y - ends[i - 1].y < labelHeight) ends[i].y = ends[i - 1].y + labelHeight;
  }

  // A coloured swatch carries the identity; the name itself wears text ink.
  // Colour-alone labelling is what fails a colour-blind reader.
  const swatch = scaled(FONT.label * 3);
  for (const end of ends) {
    const top = end.y - scaled((GLYPH_HEIGHT * FONT.label) / 2);
    fillRect(canvas, px(plotWidth) + scaled(10), top + scaled(2), swatch, swatch, end.colour);
    drawText(
      canvas,
      end.name,
      px(plotWidth) + scaled(10) + swatch + scaled(5),
      top,
      TEXT_PRIMARY,
      scaled(FONT.label)
    );
  }

  return encodePng(downsample(canvas, SUPERSAMPLE));
}

module.exports = { renderPointsChart, toSeries, niceStep, SERIES_COLOURS, MAX_SERIES };
