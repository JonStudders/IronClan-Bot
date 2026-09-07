'use strict';

const { applyStandings } = require('./state');

/** How far back to look for our own messages after a restart. */
const HISTORY_SCAN_LIMIT = 25;

/**
 * Owns the bot's messages in the channel and keeps them together at the
 * bottom, in order.
 *
 * A "panel" is one message the bot maintains, identified by its embed title.
 * While the panels are undisturbed they are edited in place, which Discord
 * does not notify for. If anything is posted below them, or they have drifted
 * out of order, they are deleted and reposted underneath.
 *
 * Only messages this bot authored are ever deleted; see `deleteOwnMessage`.
 * Any embed message of ours whose title matches no current panel is a leftover
 * from a retired panel and is removed, so the channel converges on exactly the
 * configured set.
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

  function titleOf(message) {
    return message.embeds?.[0]?.title ?? '';
  }

  /**
   * Matches existing messages to panels by embed title. Returns the message
   * per panel plus everything of ours that no panel claims.
   */
  function matchPanels(recent, panels) {
    const ours = [...recent.values()].filter(isBoard);
    const claimed = new Set();
    const matched = new Map();

    for (const panel of panels) {
      const found = ours.find((message) => !claimed.has(message.id) && titleOf(message) === panel.title);
      if (found) {
        claimed.add(found.id);
        matched.set(panel.key, found);
      }
    }

    const leftovers = ours.filter((message) => !claimed.has(message.id));
    return { matched, leftovers };
  }

  /**
   * True when our panels are the last messages in the channel and appear in
   * the configured order.
   */
  function panelsAreInPlace(recent, panels, matched) {
    if (matched.size !== panels.length) return false;
    const expected = panels.map((panel) => matched.get(panel.key).id);
    // recent is newest first, so the tail of the channel reversed is our order.
    const newest = [...recent.values()].slice(0, panels.length).map((message) => message.id).reverse();
    return newest.length === expected.length && newest.every((id, i) => id === expected[i]);
  }

  async function update() {
    const saved = state.read();
    const at = now();
    const { panels, teams, teamCount, unresolvedCount } = await render({
      previousRanks: saved.previousRanks,
      at,
    });

    if (panels.length === 0) {
      throw new Error('Nothing to post - no panels are enabled.');
    }

    const channel = await client.channels.fetch(config.channelId);
    const recent = await channel.messages.fetch({ limit: HISTORY_SCAN_LIMIT });
    const { matched, leftovers } = matchPanels(recent, panels);

    // Retired panels and duplicates would otherwise sit in the channel forever.
    for (const stale of leftovers) {
      await deleteOwnMessage(stale);
    }
    if (leftovers.length > 0) {
      log.log?.(`Removed ${leftovers.length} leftover message(s).`);
    }

    let action;
    if (panelsAreInPlace(recent, panels, matched)) {
      for (const panel of panels) {
        await matched.get(panel.key).edit({ embeds: [panel.embed] });
      }
      action = 'edited';
    } else {
      const had = matched.size > 0;
      for (const message of matched.values()) {
        await deleteOwnMessage(message);
      }
      for (const panel of panels) {
        await channel.send({ embeds: [panel.embed] });
      }
      action = had ? 'reposted' : 'posted';
    }

    const { next, leadChanged } = applyStandings(saved, teams, new Date(at).toISOString());
    state.write({ ...next, panelCount: panels.length });

    return {
      action,
      teamCount,
      unresolvedCount,
      panelCount: panels.length,
      removedLeftovers: leftovers.length,
      leadChanged,
      leader: next.leader?.teamName ?? null,
    };
  }

  return { update, isOwnMessage, isBoard, titleOf };
}

module.exports = { createPoster, HISTORY_SCAN_LIMIT };
