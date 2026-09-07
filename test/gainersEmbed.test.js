'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const {
  buildGainersEmbed, GAINERS_TITLE, rankFor, formatMetric,
} = require('../src/gainersEmbed');

const config = loadConfig({ botToken: 't', sheetId: 's', discordChannelId: 'c' });
const FIXED_NOW = 1_700_000_000_000;

const entry = (player, value) => ({ player, value });
const gainers = [
  { team: 'Llama', ehb: entry('A Llama', 12.4), ehp: entry('Llamaboy', 9.8), xp: entry('A Llama', 12_300_000) },
  { team: 'Fetired', ehb: entry('Fetired', 11.1), ehp: entry('Fetired', 8.2), xp: entry('Fetired', 9_800_000) },
  { team: 'C8B', ehb: entry('C8B', 8.2), ehp: entry('C8B', 6.4), xp: entry('Kappadonn', 900_000) },
];

const codeBlock = (embed) => embed.data.description.split('```')[1].trim();
const lines = (embed) => codeBlock(embed).split('\n');
const widest = (embed) => Math.max(...lines(embed).map((l) => l.length));
const withRows = (n) => loadConfig({ botToken: 't', sheetId: 's', discordChannelId: 'c', gainersRows: String(n) });

// --- Value formatting --------------------------------------------------------

test('EHB and EHP keep one decimal', () => {
  assert.equal(formatMetric('ehb', 12.44), '12.4');
  assert.equal(formatMetric('ehp', 0), '0.0');
});

test('XP is abbreviated so the column stays narrow', () => {
  assert.equal(formatMetric('xp', 12_300_000), '12.3M');
  assert.equal(formatMetric('xp', 900_000), '900K');
  assert.equal(formatMetric('xp', 450), '450');
});

test('a missing value renders as a dash, not blank or NaN', () => {
  assert.equal(formatMetric('ehb', null), '-');
  assert.equal(formatMetric('xp', undefined), '-');
});

test('long team names are shown in full, never truncated', () => {
  const long = [{
    team: 'Pot Arams Winning Gooners',
    ehb: { player: 'IM AlbinP', value: 66.2 },
  }];
  const block = codeBlock(buildGainersEmbed(long, withRows(3), FIXED_NOW));
  assert.ok(block.includes('Pot Arams Winning Gooners'), block);
  assert.ok(!block.includes('…'), 'no ellipsis anywhere');
});

test('columns still line up when names differ wildly in length', () => {
  const mixed = [
    { team: 'A', ehb: { player: 'X', value: 9 } },
    { team: 'Pot Arams Winning Gooners', ehb: { player: 'IM AlbinP', value: 8 } },
  ];
  const rows = lines(buildGainersEmbed(mixed, withRows(3), FIXED_NOW)).slice(1);
  assert.equal(rows[0].length, rows[1].length, 'padded rows should share a width');
  assert.ok(rows[0].endsWith('9.0'), rows[0]);
  assert.ok(rows[1].endsWith('8.0'), rows[1]);
});

// --- Ranking -----------------------------------------------------------------

test('each section is ranked best first, not left in sheet order', () => {
  const shuffled = [gainers[2], gainers[0], gainers[1]];
  assert.deepEqual(rankFor(shuffled, 'ehb', 5).map((r) => r.team), ['Llama', 'Fetired', 'C8B']);
});

test('each metric is ranked independently of the others', () => {
  const flipped = [
    { team: 'A', ehb: entry('a', 1), xp: entry('a', 999) },
    { team: 'B', ehb: entry('b', 9), xp: entry('b', 1) },
  ];
  assert.equal(rankFor(flipped, 'ehb', 1)[0].team, 'B');
  assert.equal(rankFor(flipped, 'xp', 1)[0].team, 'A');
});

test('teams without a value for a metric sink rather than disappear', () => {
  const withGap = [...gainers, { team: 'Ghost', ehb: entry('Nobody', null) }];
  const ranked = rankFor(withGap, 'ehb', 10);
  assert.equal(ranked.at(-1).team, 'Ghost');
  assert.equal(ranked.length, 4);
});

test('teams with no entry at all for a metric are excluded', () => {
  const partial = [...gainers, { team: 'Ghost' }];
  assert.equal(rankFor(partial, 'ehb', 10).length, 3);
});

test('the ranking is limited to the configured row count', () => {
  assert.equal(rankFor(gainers, 'ehb', 2).length, 2);
});

// --- Rendering ---------------------------------------------------------------

test('carries the title the poster identifies it by', () => {
  const embed = buildGainersEmbed(gainers, config, FIXED_NOW);
  assert.equal(embed.data.title, GAINERS_TITLE);
});

test('has no timestamp of its own: the leaderboard above carries it', () => {
  const embed = buildGainersEmbed(gainers, config, FIXED_NOW);
  assert.ok(!embed.data.description.includes('Last Updated'));
  assert.ok(!/<t:\d+:R>/.test(embed.data.description), 'no relative timestamp');
  assert.ok(embed.data.description.startsWith('```'), 'the table starts the description');
});

test('renders one section per metric, inside a code block', () => {
  const embed = buildGainersEmbed(gainers, config, FIXED_NOW);
  assert.ok(embed.data.description.includes('```'));
  for (const label of ['EHB gained', 'EHP gained', 'XP gained']) {
    assert.ok(codeBlock(embed).includes(label), `should contain ${label}`);
  }
});

test('there is no repeated column header row', () => {
  const embed = buildGainersEmbed(gainers, config, FIXED_NOW);
  assert.ok(!codeBlock(embed).includes('Player'), 'the header row was dropped to save height');
});

test('real-world team names stay narrow enough to avoid wrapping', () => {
  const real = [
    { team: 'Pot Arams Winning Gooners', ehb: { player: 'IM AlbinP', value: 66.2 }, xp: { player: 'IM AlbinP', value: 19_200_000 } },
    { team: 'Euskadi Ta Askatasuna', ehb: { player: 'Neurron', value: 55.4 }, xp: { player: 'Misuli', value: 14_100_000 } },
    { team: 'Zappers Aint Playin', ehb: { player: 'Ironborn PVM', value: 60.1 }, xp: { player: 'gmg', value: 15_200_000 } },
  ];
  const embed = buildGainersEmbed(real, withRows(3), FIXED_NOW);
  assert.ok(widest(embed) <= 55, `expected <=55 chars, got ${widest(embed)}`);
});

test('height is bounded by the configured rows per metric', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    team: `Team${i}`, ehb: entry(`P${i}`, 20 - i), ehp: entry(`P${i}`, 20 - i), xp: entry(`P${i}`, 20 - i),
  }));
  // 3 sections x (1 label + N rows) + 2 blank separators
  assert.equal(lines(buildGainersEmbed(many, withRows(5), FIXED_NOW)).length, 20);
  assert.equal(lines(buildGainersEmbed(many, withRows(3), FIXED_NOW)).length, 14);
});

test('the footer states the cut-off and the one-per-team caveat', () => {
  const embed = buildGainersEmbed(gainers, withRows(3), FIXED_NOW);
  assert.match(embed.data.footer.text, /Top 3 per category/);
  // The sheet only supplies each team's own best player, so the pool is
  // one entry per team rather than every player in the clan.
  assert.match(embed.data.footer.text, /one entry per team/);
});

test('players are listed best first with a rank number', () => {
  const block = codeBlock(buildGainersEmbed(gainers, withRows(3), FIXED_NOW));
  const ehb = block.split('\n\n')[0].split('\n').slice(1);
  assert.match(ehb[0], /^1\. A Llama/);
  assert.match(ehb[1], /^2\. Fetired/);
  assert.match(ehb[2], /^3\. C8B/);
});

test('each row leads with the player, followed by their team', () => {
  const block = codeBlock(buildGainersEmbed(gainers, withRows(3), FIXED_NOW));
  const [firstEhbRow] = block.split('\n').slice(1);
  // Llamaboy plays for Llama, so the EHP section must pair them.
  const ehpSection = block.split('\n\n')[1];
  assert.match(ehpSection.split('\n')[1], /Llamaboy\s+Llama/);
  assert.match(firstEhbRow, /A Llama\s+Llama/);
});

test('contains no emoji, which would break alignment', () => {
  const embed = buildGainersEmbed(gainers, config, FIXED_NOW);
  assert.ok(!/\p{Extended_Pictographic}/u.test(codeBlock(embed)));
});

test('a metric absent from the sheet is omitted entirely', () => {
  const noXp = gainers.map(({ team, ehb, ehp }) => ({ team, ehb, ehp }));
  const block = codeBlock(buildGainersEmbed(noXp, config, FIXED_NOW));
  assert.ok(!block.includes('XP gained'));
  assert.ok(block.includes('EHB gained'));
});

test('an empty sheet says so rather than rendering an empty table', () => {
  const embed = buildGainersEmbed([], config, FIXED_NOW);
  assert.match(embed.data.description, /No gainer data/);
  assert.ok(!embed.data.description.includes('```'));
});

test('a large sheet stays within the embed description limit', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    team: `LongTeamName${i}`,
    ehb: entry(`LongPlayer${i}`, 100 - i),
    ehp: entry(`LongPlayer${i}`, 90 - i),
    xp: entry(`LongPlayer${i}`, 50_000_000 - i),
  }));
  const embed = buildGainersEmbed(many, withRows(25), FIXED_NOW);
  assert.ok(embed.data.description.length <= 4096, `was ${embed.data.description.length}`);
});
