'use strict';

const { buildEmbed } = require('./embed');
const { sortTeams } = require('./sheet');
const { applyStandings } = require('./state');

/** How far back to look for our own board after a restart. */
const HISTORY_SCAN_LIMIT = 25;

/**
 * Owns the leaderboard message and keeps it at the bottom of the channel.
 *
 * While undisturbed the board is edited in place, which Discord does not
 * notify for. If anything is posted below it the board would be stranded up
 * the scrollback, so it is deleted and reposted underneath. Only messages this
 * bot authored are ever deleted; see `deleteOwnMessage`.
 *
 * `state` persists the message id, the previous ranking (so rank arrows
 * survive a restart) and the lead history.
 */
function createPoster({ client, config, readTeams, state, now = () => Date.now(), log = console }) {
  /** True only for messages this bot wrote. The guard on every delete. */
  function isOwnMessage(message) {
    return Boolean(message) && message.author?.id === client.user.id;
  }

  /**
   * Deletes one of our own messages. Refuses anything we did not author, so a
   * bug upstream can never remove somebody else's post.
   */
  async function deleteOwnMessage(message) {
    if (!isOwnMessage(message)) {
      throw new Error('Refusing to delete a message this bot did not author.');
    }
    await message.delete();
  }

  /** A leaderboard message: ours, and carrying an embed. */
  function isBoard(message) {
    return isOwnMessage(message) && (message.embeds?.length ?? 0) > 0;
  }

  /** Every board we own in the recent window, newest first. */
  function findBoards(recent) {
    return [...recent.values()].filter(isBoard);
  }

  async function update() {
    const teams = await readTeams();

    if (teams.length === 0) {
      throw new Error('No teams found in the sheet - refusing to post an empty leaderboard.');
    }

    const saved = state.read();
    const sorted = sortTeams(teams).slice(0, config.maxTeams);
    const at = now();
    const embed = buildEmbed(teams, config, at, saved.previousRanks);

    const channel = await client.channels.fetch(config.channelId);
    // Newest first, so the first entry is whatever sits at the bottom.
    const recent = await channel.messages.fetch({ limit: HISTORY_SCAN_LIMIT });
    const boards = findBoards(recent);
    const [current, ...duplicates] = boards;
    const newest = recent.first();

    // Only ever keep one board. Anything else we own is a leftover - from a
    // layout that has been retired, or a a crash mid-repost - and would
    // otherwise sit in the channel forever.
    for (const stale of duplicates) {
      await deleteOwnMessage(stale);
    }
    if (duplicates.length > 0) {
      log.log?.(`Removed ${duplicates.length} leftover board message(s).`);
    }

    const atBottom = Boolean(current && newest && newest.id === current.id);
    let action;
    let messageId;

    if (current && atBottom) {
      await current.edit({ embeds: [embed] });
      messageId = current.id;
      action = 'edited';
    } else {
      // Either there is no board yet, or something was posted below it. Remove
      // ours (never theirs) and post again so the board stays at the bottom.
      if (current) {
        await deleteOwnMessage(current);
      }
      const sent = await channel.send({ embeds: [embed] });
      messageId = sent.id;
      action = current ? 'reposted' : 'posted';
    }

    const { next, leadChanged } = applyStandings(saved, sorted, new Date(at).toISOString());
    state.write({ ...next, boardMessageId: messageId });

    return {
      action,
      teamCount: teams.length,
      unresolvedCount: teams.filter((team) => team.points === null).length,
      removedDuplicates: duplicates.length,
      leadChanged,
      leader: next.leader?.teamName ?? null,
    };
  }

  return { update, isOwnMessage, isBoard, findBoards };
}

module.exports = { createPoster, HISTORY_SCAN_LIMIT };
