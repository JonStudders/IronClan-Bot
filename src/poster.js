'use strict';

const { applyStandings } = require('./state');
const { recordSnapshot, lastKnownFrom } = require('./history');

/** How far back to look for our own messages. */
const HISTORY_SCAN_LIMIT = 25;

/**
 * Owns the bot's messages in the channel.
 *
 * A "panel" is one message the bot maintains. On every update the bot deletes
 * the messages it posted last time and posts fresh ones, so the board is
 * always the newest thing in the channel regardless of what has been said in
 * between. That does notify the channel on every update - the trade for never
 * being stranded up the scrollback.
 *
 * Only messages this bot authored are ever deleted; see `deleteOwnMessage`.
 */
function createPoster({ client, config, render, state, now = () => Date.now(), log = console }) {
  /** True only for messages this bot wrote. The guard on every delete. */
  function isOwnMessage(message) {
    return Boolean(message) && message.author?.id === client.user.id;
  }

  async function deleteOwnMessage(message) {
    if (!isOwnMessage(message)) {
      throw new Error('Refusing to delete a message this bot did not author.');
    }
    await message.delete();
  }

  /** One of the bot's panel messages: ours, and carrying an embed. */
  function isBoard(message) {
    return isOwnMessage(message) && (message.embeds?.length ?? 0) > 0;
  }

  async function update() {
    const saved = state.read();
    const at = now();
    const { panels, teams, teamCount, unresolvedCount, carriedCount } = await render({
      previousRanks: saved.previousRanks,
      lastKnownPoints: saved.lastKnownPoints,
      at,
    });

    if (panels.length === 0) {
      throw new Error('Nothing to post - no panels are enabled.');
    }

    const channel = await client.channels.fetch(config.channelId);
    const recent = await channel.messages.fetch({ limit: HISTORY_SCAN_LIMIT });

    // Clear out everything we posted before. This covers the previous update's
    // panels, anything left by a retired panel, and any duplicate a crashed
    // run left behind - so the channel converges on exactly one set.
    const ours = [...recent.values()].filter(isBoard);
    for (const message of ours) {
      await deleteOwnMessage(message);
    }

    for (const panel of panels) {
      await channel.send({ embeds: [panel.embed] });
    }

    const timestamp = new Date(at).toISOString();
    const { next, leadChanged } = applyStandings(saved, teams, timestamp);
    state.write({
      ...next,
      panelCount: panels.length,
      history: recordSnapshot(saved.history ?? [], teams, timestamp),
      lastKnownPoints: lastKnownFrom(teams, saved.lastKnownPoints),
    });

    return {
      action: ours.length > 0 ? 'reposted' : 'posted',
      teamCount,
      unresolvedCount,
      carriedCount,
      panelCount: panels.length,
      removedPrevious: ours.length,
      leadChanged,
      leader: next.leader?.teamName ?? null,
    };
  }

  return { update, isOwnMessage, isBoard };
}

module.exports = { createPoster, HISTORY_SCAN_LIMIT };
