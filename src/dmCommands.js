'use strict';

const { partitionByAge, explainDeleteFailure } = require('./commands');
const { renderPointsChart } = require('./chart');

/**
 * Developer commands, sent to the bot as a direct message.
 *
 *   -reload         force a leaderboard update now
 *   -delete <n>     remove the last n messages from the leaderboard channel
 *   -post <text>    post text to the leaderboard channel
 *   -help           list the commands
 *
 * Only the configured owner is obeyed. Anyone else is ignored in silence
 * rather than told the commands exist.
 *
 * Reading DM text needs no privileged intent: Discord exempts DMs with the
 * app from the Message Content intent, alongside messages that mention it.
 */
const PREFIX = '-';

/** Discord refuses to fetch more than 100 messages in one call. */
const MAX_DELETE = 100;
const DISCORD_MESSAGE_LIMIT = 2000;

/** `-post 'hello there'` -> `hello there`. Quotes are optional. */
function stripQuotes(text) {
  const trimmed = text.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (trimmed.length >= 2 && (first === "'" || first === '"') && last === first) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Splits "-delete 5" into { name: 'delete', args: '5' }, or null if not a command. */
function parseCommand(content) {
  const text = String(content ?? '').trim();
  if (!text.startsWith(PREFIX)) return null;

  const body = text.slice(PREFIX.length).trim();
  if (body === '') return null;

  const [name, ...rest] = body.split(/\s+/);
  return { name: name.toLowerCase(), args: rest.join(' ').trim() };
}

function helpText() {
  return [
    '**Developer commands** (DM only)',
    '```',
    '-reload         Force a leaderboard update now',
    '-delete <n>     Delete the last n messages in the leaderboard channel',
    '                (the leaderboard panels themselves are kept)',
    "-post <text>    Post text to the leaderboard channel",
    '-freeze         Stop the timer updating the board',
    '-unfreeze       Resume automatic updates',
    '-line-test [p]  Points chart as an image, DMed back (p: 24h, 7d, blank=all)',
    '-bingo-start    Wipe the history and start fresh, as if the bingo just began',
    '-help           This list',
    '```',
    'Quotes around `-post` text are optional.',
    '`-reload` works even while frozen.',
  ].join('\n');
}

/** Discord rejects anything over 2000 characters, so never send more. */
function truncate(text) {
  return text.length <= DISCORD_MESSAGE_LIMIT
    ? text
    : `${text.slice(0, DISCORD_MESSAGE_LIMIT - 3)}...`;
}

function createDmHandler({ client, config, poster, state, describeUpdate, log = console }) {
  async function leaderboardChannel() {
    return client.channels.fetch(config.channelId);
  }

  function setFrozen(frozen) {
    state.write({ ...state.read(), frozen });
  }

  async function cmdFreeze() {
    if (state.read().frozen) return 'Already frozen. `-unfreeze` to resume.';
    setFrozen(true);
    log.log?.('Updates frozen by the developer.');
    return 'Frozen. The timer will skip updates until `-unfreeze`.'
      + ' `-reload` still works if you want a one-off update.';
  }

  async function cmdUnfreeze() {
    if (!state.read().frozen) return 'Not frozen - updates are already running.';
    setFrozen(false);
    log.log?.('Updates resumed by the developer.');
    return 'Unfrozen. The next scheduled update will run as normal.';
  }

  /**
   * `-bingo-start` - wipe everything remembered about the race and post a
   * fresh board, as though the bingo had just begun.
   *
   * The bot records history from the moment it is deployed, so by the time the
   * bingo actually starts it has banked days of all-zero snapshots and a
   * meaningless "leader". This throws those away.
   *
   * Erasing history cannot be undone, so it asks for confirmation - but only
   * once there is something worth losing. Before the bingo starts every score
   * is zero and there is nothing to protect, so the common case stays a single
   * command.
   */
  async function cmdBingoStart(args) {
    const saved = state.read();
    const history = saved.history ?? [];
    const scored = history.some((snapshot) => Object.values(snapshot.points).some((v) => v > 0));

    if (scored && args.trim().toLowerCase() !== 'confirm') {
      return `That would erase ${history.length} snapshot(s), and some record real scores -`
        + ' the whole points history and every rank arrow would go with them.\n'
        + 'Run `-bingo-start confirm` if you really mean it.';
    }

    state.write({
      ...saved,
      history: [],
      previousRanks: {},
      lastKnownPoints: {},
      leader: null,
      leadChanges: [],
    });
    log.log?.(`Bingo restarted by the developer: cleared ${history.length} snapshot(s).`);

    const result = await poster.update();
    const lines = [
      `Bingo started. Cleared ${history.length} snapshot(s), the rank history and the lead record.`,
      '```',
      describeUpdate(result),
      '```',
      'Every team will show NEW until the next update gives them something to move against.',
    ];
    if (saved.frozen) {
      lines.push('Note: updates are still **frozen** - `-unfreeze` when you want the timer running.');
    }
    return lines.join('\n');
  }

  /** Windows accepted by -line-test, matching the /bingo-history choices. */
  const CHART_PERIODS = { '24h': 24, '7d': 24 * 7, all: 0, '': 0 };

  /**
   * `-line-test` - the points chart as a PNG, DMed back rather than posted, so
   * the rendering can be iterated on without the channel seeing every attempt.
   */
  async function cmdLineTest(args) {
    const key = args.trim().toLowerCase();
    if (!(key in CHART_PERIODS)) {
      return `Unknown period "${args}". Use 24h, 7d, or leave it blank for the whole bingo.`;
    }

    const hours = CHART_PERIODS[key];
    const label = hours === 24 ? 'the last 24 hours' : hours ? 'the last 7 days' : 'the whole bingo';
    const png = renderPointsChart(state.read().history ?? [], { hours, title: `Points over ${label}` });

    if (!png) {
      return 'Not enough history to draw a line yet - two snapshots are needed,'
        + ' and they are recorded one per update.';
    }

    return {
      content: `Points over ${label} (${(png.length / 1024).toFixed(1)} KB)`,
      files: [{ attachment: png, name: 'bingo-history.png' }],
    };
  }

  async function cmdReload() {
    const result = await poster.update();
    return `Reloaded.\n\`\`\`\n${describeUpdate(result)}\n\`\`\``;
  }

  async function cmdDelete(args) {
    const count = Number.parseInt(args, 10);
    if (!Number.isInteger(count) || count < 1) {
      return `\`-delete\` needs a whole number, e.g. \`-delete 5\`.`;
    }
    if (count > MAX_DELETE) {
      return `Discord only allows ${MAX_DELETE} at a time. Try \`-delete ${MAX_DELETE}\`.`;
    }

    const channel = await leaderboardChannel();
    // Fetch a little extra: the board panels are skipped, so they would
    // otherwise eat into the count the developer asked for.
    const recent = await channel.messages.fetch({ limit: Math.min(count + 5, MAX_DELETE) });
    const targets = [...recent.values()]
      .filter((message) => !poster.isBoard(message) && !message.pinned)
      .slice(0, count);

    if (targets.length === 0) {
      return 'Nothing to delete - only the leaderboard and pinned messages are there.';
    }

    const { bulk, individual } = partitionByAge(targets, Date.now());
    let deleted = 0;
    const failures = [];

    try {
      if (bulk.length > 0) {
        deleted += (await channel.bulkDelete(bulk, true)).size;
      }
    } catch (error) {
      failures.push(explainDeleteFailure(error));
    }

    for (const message of individual) {
      try {
        await message.delete();
        deleted += 1;
      } catch (error) {
        failures.push(explainDeleteFailure(error));
      }
    }

    log.log?.(`DM -delete ${count}: removed ${deleted} message(s).`);

    if (failures.length > 0) {
      return `Deleted ${deleted} of ${targets.length}. Some could not be removed: `
        + [...new Set(failures)].join(' ');
    }
    return `Deleted ${deleted} message(s). The leaderboard was left alone.`;
  }

  async function cmdPost(args) {
    const text = stripQuotes(args);
    if (text === '') {
      return "`-post` needs something to say, e.g. `-post 'board is frozen for an hour'`.";
    }

    const channel = await leaderboardChannel();
    const sent = await channel.send(truncate(text));
    log.log?.(`DM -post by owner: ${text.length} character(s).`);
    // A plain message carries no embed, so the poster will not treat it as one
    // of its panels and will not delete it on the next update.
    return `Posted. ${sent.url}`;
  }

  const COMMANDS = {
    reload: cmdReload,
    delete: cmdDelete,
    post: cmdPost,
    freeze: cmdFreeze,
    unfreeze: cmdUnfreeze,
    'line-test': cmdLineTest,
    'bingo-start': cmdBingoStart,
    help: async () => helpText(),
  };

  return async function onMessage(message) {
    try {
      if (message.author?.bot) return;
      // DMs only. In a guild, message.guild is set.
      if (message.guild) return;

      const command = parseCommand(message.content);
      if (!command) return;

      if (!config.ownerId || message.author.id !== config.ownerId) {
        // Silence rather than "you are not allowed": do not advertise that
        // developer commands exist.
        log.warn?.(`Ignored DM command "${command.name}" from ${message.author.id}.`);
        return;
      }

      const handler = COMMANDS[command.name];
      if (!handler) {
        await message.reply(`Unknown command \`${PREFIX}${command.name}\`. Try \`-help\`.`);
        return;
      }

      // Discord's own content check can come back empty if the message was not
      // actually a DM; say so rather than failing mysteriously.
      if (message.content === '') {
        await message.reply(
          'I received an empty message. If this keeps happening, enable the '
          + 'Message Content intent in the Discord Developer Portal.'
        );
        return;
      }

      // A handler may return text, or a payload with an attachment.
      const result = await handler(command.args);
      await message.reply(typeof result === 'string' ? truncate(result) : result);
    } catch (error) {
      log.error?.('DM command failed:', error);
      await message.reply(`That failed: ${error.message}`).catch(() => {});
    }
  };
}

module.exports = { createDmHandler, parseCommand, stripQuotes, helpText, PREFIX, MAX_DELETE };
