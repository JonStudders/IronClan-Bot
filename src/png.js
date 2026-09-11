'use strict';

const zlib = require('node:zlib');

/**
 * A minimal RGBA canvas that encodes to PNG, with no dependencies.
 *
 * Chart images could come from a native canvas binding or an external chart
 * service. Neither is wanted here: native modules are awkward to build on the
 * ARM host, and an external service would mean sending the clan's scores to a
 * third party for a picture we can draw ourselves.
 *
 * Everything is drawn at a supersampled scale and averaged down on encode,
 * which is what gives the lines smooth edges without an anti-aliasing pass.
 */

/**
 * 5x7 bitmap font. Written as readable rows so a typo is visible on sight, and
 * verifiable by rendering a string to text - see `renderTextRows`.
 */
const GLYPHS = {
  ' ': '...../...../...../...../...../...../.....',
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.###.',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '.###./..#../..#../..#../..#../..#../.###.',
  J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#...#/#...#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  a: '...../...../.###./....#/.####/#...#/.####',
  b: '#..../#..../####./#...#/#...#/#...#/####.',
  c: '...../...../.###./#..../#..../#...#/.###.',
  d: '....#/....#/.####/#...#/#...#/#...#/.####',
  e: '...../...../.###./#...#/#####/#..../.###.',
  f: '..##./.#..#/.#.../###../.#.../.#.../.#...',
  g: '...../...../.###./#...#/.####/....#/.###.',
  h: '#..../#..../####./#...#/#...#/#...#/#...#',
  i: '..#../...../.##../..#../..#../..#../.###.',
  j: '...#./...../..##./...#./...#./#..#./.##..',
  k: '#..../#..../#..#./#.#../##.../#.#../#..#.',
  l: '.##../..#../..#../..#../..#../..#../.###.',
  m: '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#',
  n: '...../...../####./#...#/#...#/#...#/#...#',
  o: '...../...../.###./#...#/#...#/#...#/.###.',
  p: '...../...../####./#...#/####./#..../#....',
  q: '...../...../.####/#...#/.####/....#/....#',
  r: '...../...../#.##./##..#/#..../#..../#....',
  s: '...../...../.####/##.../..##./...##/####.',
  t: '.#.../.#.../###../.#.../.#.../.#..#/..##.',
  u: '...../...../#...#/#...#/#...#/#..##/.##.#',
  v: '...../...../#...#/#...#/#...#/.#.#./..#..',
  w: '...../...../#...#/#.#.#/#.#.#/#.#.#/.#.#.',
  x: '...../...../#...#/.#.#./..#../.#.#./#...#',
  y: '...../...../#...#/#...#/.####/....#/.###.',
  z: '...../...../#####/...#./..#../.#.../#####',
  0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  1: '..#../.##../..#../..#../..#../..#../.###.',
  2: '.###./#...#/....#/...#./..#../.#.../#####',
  3: '#####/...#./..#../...#./....#/#...#/.###.',
  4: '...#./..##./.#.#./#..#./#####/...#./...#.',
  5: '#####/#..../####./....#/....#/#...#/.###.',
  6: '..##./.#.../#..../####./#...#/#...#/.###.',
  7: '#####/....#/...#./..#../.#.../.#.../.#...',
  8: '.###./#...#/#...#/.###./#...#/#...#/.###.',
  9: '.###./#...#/#...#/.####/....#/...#./.##..',
  '.': '...../...../...../...../...../.##../.##..',
  ',': '...../...../...../...../.##../.##../#....',
  ':': '...../.##../.##../...../.##../.##../.....',
  '-': '...../...../...../#####/...../...../.....',
  '+': '...../..#../..#../#####/..#../..#../.....',
  '%': '##..#/##..#/...#./..#../.#.../#..##/#..##',
  "'": '..#../..#../...../...../...../...../.....',
  '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
  ')': '.#.../..#../...#./...#./...#./..#../.#...',
  '/': '....#/...#./...#./..#../.#.../.#.../#....',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  '!': '..#../..#../..#../..#../..#../...../..#..',
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
/** One blank column between characters. */
const GLYPH_SPACING = 1;

const compiled = new Map();

function glyph(char) {
  if (compiled.has(char)) return compiled.get(char);

  const source = GLYPHS[char] ?? GLYPHS['?'];
  const rows = source.split('/').map((row) => [...row].map((cell) => cell === '#'));
  compiled.set(char, rows);
  return rows;
}

/** Width in pixels of a string at scale 1, including inter-character spacing. */
function textWidth(text) {
  if (text.length === 0) return 0;
  return text.length * (GLYPH_WIDTH + GLYPH_SPACING) - GLYPH_SPACING;
}

/** Renders a string to rows of '#' and '.', so the font can be eyeballed. */
function renderTextRows(text) {
  const rows = [];
  for (let y = 0; y < GLYPH_HEIGHT; y++) {
    let line = '';
    for (const char of text) {
      line += glyph(char)[y].map((on) => (on ? '#' : '.')).join('') + ' ';
    }
    rows.push(line.trimEnd());
  }
  return rows;
}

function parseColour(hex) {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
    clean.length >= 8 ? Number.parseInt(clean.slice(6, 8), 16) : 255,
  ];
}

function createCanvas(width, height, background = '#000000') {
  const data = Buffer.alloc(width * height * 4);
  const canvas = { width, height, data };
  fillRect(canvas, 0, 0, width, height, background);
  return canvas;
}

/** Alpha-blends one pixel. Out-of-bounds writes are dropped, not wrapped. */
function setPixel(canvas, x, y, [r, g, b, a]) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;

  const i = (py * canvas.width + px) * 4;
  if (a >= 255) {
    canvas.data[i] = r;
    canvas.data[i + 1] = g;
    canvas.data[i + 2] = b;
    canvas.data[i + 3] = 255;
    return;
  }
  const alpha = a / 255;
  canvas.data[i] = Math.round(canvas.data[i] * (1 - alpha) + r * alpha);
  canvas.data[i + 1] = Math.round(canvas.data[i + 1] * (1 - alpha) + g * alpha);
  canvas.data[i + 2] = Math.round(canvas.data[i + 2] * (1 - alpha) + b * alpha);
  canvas.data[i + 3] = 255;
}

function fillRect(canvas, x, y, width, height, colour) {
  const rgba = parseColour(colour);
  for (let py = Math.round(y); py < Math.round(y + height); py++) {
    for (let px = Math.round(x); px < Math.round(x + width); px++) {
      setPixel(canvas, px, py, rgba);
    }
  }
}

/** A line of the given thickness, drawn by stepping along its longer axis. */
function drawLine(canvas, x0, y0, x1, y1, colour, thickness = 1) {
  const rgba = parseColour(colour);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const half = thickness / 2;

  for (let i = 0; i <= steps; i++) {
    const x = x0 + (dx * i) / steps;
    const y = y0 + (dy * i) / steps;

    if (thickness <= 1) {
      setPixel(canvas, x, y, rgba);
      continue;
    }
    // Square the pen across the line rather than along it, so diagonals do not
    // thin out.
    for (let ox = -half; ox <= half; ox += 0.5) {
      for (let oy = -half; oy <= half; oy += 0.5) {
        if (ox * ox + oy * oy <= half * half + 0.25) setPixel(canvas, x + ox, y + oy, rgba);
      }
    }
  }
}

function drawText(canvas, text, x, y, colour, scale = 1) {
  const rgba = parseColour(colour);
  let cursor = x;

  for (const char of String(text)) {
    const rows = glyph(char);
    for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
      for (let gx = 0; gx < GLYPH_WIDTH; gx++) {
        if (!rows[gy][gx]) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPixel(canvas, cursor + gx * scale + sx, y + gy * scale + sy, rgba);
          }
        }
      }
    }
    cursor += (GLYPH_WIDTH + GLYPH_SPACING) * scale;
  }
}

/** Box-averages the canvas down by `factor`, which is what smooths the edges. */
function downsample(canvas, factor) {
  if (factor <= 1) return canvas;

  const width = Math.floor(canvas.width / factor);
  const height = Math.floor(canvas.height / factor);
  const out = { width, height, data: Buffer.alloc(width * height * 4) };
  const samples = factor * factor;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * canvas.width + (x * factor + sx)) * 4;
          r += canvas.data[i];
          g += canvas.data[i + 1];
          b += canvas.data[i + 2];
        }
      }
      const o = (y * width + x) * 4;
      out.data[o] = Math.round(r / samples);
      out.data[o + 1] = Math.round(g / samples);
      out.data[o + 2] = Math.round(b / samples);
      out.data[o + 3] = 255;
    }
  }
  return out;
}

// --- PNG encoding ------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

function encodePng(canvas) {
  const { width, height, data } = canvas;

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bit depth
  header[9] = 6;  // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    raw[start] = 0;
    data.copy(raw, start + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = {
  createCanvas,
  fillRect,
  drawLine,
  drawText,
  downsample,
  encodePng,
  textWidth,
  renderTextRows,
  GLYPH_WIDTH,
  GLYPH_HEIGHT,
  GLYPH_SPACING,
};
