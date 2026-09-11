'use strict';

const { renderHistory } = require('./history');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
} = require('discord.js');

/** Messages older than this cannot be bulk deleted by the Discord API. */
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const CLEAR_SCAN_LIMIT = 100;
const CONFIRM_TIMEOUT_MS = 30_000;

const definitions = [
  new SlashCommandBuilder()
    .setName('bingo-lead')
    .setDescription('Announce who is currently leading the bingo, and when the lead last changed.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('bingo-history')
    .setDescription('Show how the points race has developed over time.')
    .addStringOption((option) => option
      .setName('period')
      .setDescription('How far back to look (default: the whole bingo)')
      .addChoices(
        { name: 'Last 24 hours', value: '24h' },
        { name: 'Last 7 days', value: '7d' },
        { name: 'Whole bingo', value: 'all' },
      ))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('bingo-clear')
    .setDescription('Delete every message in this channel except the leaderboard.')
    // Gate the command in the UI. The handler re-checks, since default
    // permissions can be overridden per-guild by an administrator.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .toJSON(),
];

/**
 * Registers the commands against a single guild, which takes effect
 * immediately (global commands can take up to an hour to propagate).
 */
async function registerCommands({ config, log = console }) {
  if (!config.applicationId || !config.guildId) {
    log.warn?.(
      'Skipping slash command registration: applicationId and discordServerId must both be set in .env.'
    );
    return false;
  }

  const rest = new REST().setToken(config.botToken);
  await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), {
    body: definitions,
  });
  log.log?.(`Registered ${definitions.length} slash command(s) for guild ${config.guildId}.`);
  return true;
}

function formatLeadReply(state) {
  if (!state.leader) {
    return 'No leader recorded yet - the leaderboard has not updated since the bot last started.';
  }

  const since = Math.floor(new Date(state.leader.since).getTime() / 1000);
  const lines = [`🏆 **${state.leader.teamName}** currently lead the bingo, since <t:${since}:R>.`];

  const [latest] = state.leadChanges;
  if (latest) {
    const at = Math.floor(new Date(latest.at).getTime() / 1000);
    lines.push(`Last change: **${latest.to}** overtook **${latest.from}** <t:${at}:R>.`);
  } else {
    lines.push('They have led for as long as the bot has been watching.');
  }

  return lines.join('\n');
}

/**
 * `/bingo-lead` - posts the current leader publicly, so it doubles as the
 * "someone has taken the lead" announcement on demand.
 */
async function handleLead(interaction, { state }) {
  await interaction.reply({ content: formatLeadReply(state.read()) });
}

/** The period option maps to a window in hours; 0 means everything. */
const PERIODS = { '24h': 24, '7d': 24 * 7, all: 0 };

function formatHistoryReply(state, period = 'all', now = Date.now()) {
  const hours = PERIODS[period] ?? 0;
  const result = renderHistory(state.history ?? [], { hours, now });

  if (result.empty) {
    return `${result.text}

History is recorded on every update, so it fills in as the bingo runs.`;
  }

  const label = period === 'all' ? 'the whole bingo' : `the last ${period === '24h' ? '24 hours' : '7 days'}`;
  const lines = [
    `**Points over ${label}** - ${result.snapshots} snapshots`,
    '```',
    result.text,
    '```',
  ];
  if (result.topGain) {
    lines.push(`Biggest gain: **${result.topGain.name}** (+${result.topGain.gain.toLocaleString('en-GB')})`);
  }
  return lines.join('\n');
}

/**
 * `/bingo-history` - open to everyone. Renders each team's score over time as
 * a sparkline, scaled across all teams so the rows read as one race.
 */
async function handleHistory(interaction, { state }) {
  const period = interaction.options?.getString?.('period') ?? 'all';
  await interaction.reply({ content: formatHistoryReply(state.read(), period) });
}

/**
 * Splits messages into those Discord can bulk delete and those that must go
 * one at a time. Bulk deletion only accepts messages under 14 days old.
 */
function partitionByAge(messages, nowMs) {
  const bulk = [];
  const individual = [];
  for (const message of messages) {
    (nowMs - message.createdTimestamp < BULK_DELETE_MAX_AGE_MS ? bulk : individual).push(message);
  }
  return { bulk, individual };
}

/**
 * Everything in the channel that is not one of our board messages. `isBoard`
 * comes from the poster, so the boards stay protected by exactly the same test
 * that identifies them for editing.
 */
function selectDeletable(recent, isBoard) {
  return [...recent.values()].filter((message) => !isBoard(message) && !message.pinned);
}

function confirmRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bingo-clear:confirm')
      .setLabel('Delete them')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('bingo-clear:cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

/**
 * `/bingo-clear` - removes everything in the channel except the leaderboard
 * boards (and pinned messages, which are treated as deliberate keeps).
 *
 * This deletes other people's messages, so it is gated three ways: the command
 * is registered as requiring Manage Messages, the handler re-checks the caller,
 * and the caller must confirm on a button before anything is removed.
 */
async function handleClear(interaction, { poster, config = {}, log = console }) {
  // The developer always has access, whatever the guild's roles say.
  const isOwner = Boolean(config.ownerId) && interaction.user.id === config.ownerId;
  if (!isOwner && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: 'You need the Manage Messages permission to use this.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const recent = await interaction.channel.messages.fetch({ limit: CLEAR_SCAN_LIMIT });
  const deletable = selectDeletable(recent, poster.isBoard);

  if (deletable.length === 0) {
    await interaction.editReply('Nothing to clear - only the leaderboard is here.');
    return;
  }

  const { bulk, individual } = partitionByAge(deletable, Date.now());
  await interaction.editReply({
    content: `This will delete **${deletable.length}** message(s) in this channel.\n`
      + `The leaderboard and any pinned messages are kept.`
      + (individual.length > 0 ? `\n${individual.length} are over 14 days old and go one at a time.` : ''),
    components: [confirmRow()],
  });

  let button;
  try {
    const reply = await interaction.fetchReply();
    button = await reply.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id,
      time: CONFIRM_TIMEOUT_MS,
    });
  } catch {
    await interaction.editReply({ content: 'Timed out - nothing was deleted.', components: [] });
    return;
  }

  if (button.customId === 'bingo-clear:cancel') {
    await button.update({ content: 'Cancelled - nothing was deleted.', components: [] });
    return;
  }

  await button.update({ content: `Deleting ${deletable.length} message(s)...`, components: [] });

  let deleted = 0;
  const failures = [];

  try {
    if (bulk.length > 0) {
      const removed = await interaction.channel.bulkDelete(bulk, true);
      deleted += removed.size;
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

  const summary = failures.length > 0
    ? `Deleted ${deleted} message(s). Some could not be removed: ${[...new Set(failures)].join(' ')}`
    : `Deleted ${deleted} message(s). The leaderboard is untouched.`;

  log.log?.(`/bingo-clear by ${interaction.user.tag}: removed ${deleted} message(s).`);
  await interaction.editReply({ content: summary, components: [] });
}

/**
 * Deleting other people's messages needs Manage Messages, which Discord gates
 * behind two separate checks. Naming the right one matters because the fixes
 * live in completely different places.
 */
function explainDeleteFailure(error) {
  if (error.code === 60003) {
    return 'the server requires two-factor authentication for moderation, and the bot '
      + "owner's Discord account does not have 2FA enabled.";
  }
  if (error.code === 50013) {
    return 'the bot is missing the Manage Messages permission in this channel.';
  }
  if (error.code === 50034) {
    return 'some messages were over 14 days old.';
  }
  return error.message;
}

/** Routes an interaction to its handler. */
function createInteractionHandler(deps) {
  return async function onInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === 'bingo-lead') return await handleLead(interaction, deps);
      if (interaction.commandName === 'bingo-history') return await handleHistory(interaction, deps);
      if (interaction.commandName === 'bingo-clear') return await handleClear(interaction, deps);
    } catch (error) {
      (deps.log ?? console).error?.(`Command /${interaction.commandName} failed:`, error);
      const message = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else {
        await interaction.reply(message).catch(() => {});
      }
    }
  };
}

module.exports = {
  definitions,
  registerCommands,
  createInteractionHandler,
  formatLeadReply,
  formatHistoryReply,
  PERIODS,
  partitionByAge,
  selectDeletable,
  explainDeleteFailure,
  BULK_DELETE_MAX_AGE_MS,
};
