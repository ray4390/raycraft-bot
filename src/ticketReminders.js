"use strict";
const { EmbedBuilder } = require("discord.js");
const tickets = require("./tickets");

const TWO_HOURS = 2 * 60 * 60 * 1000;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const NO_MENTIONS = { parse: [] };

function elapsed(now, iso) {
  const time = Date.parse(iso || "");
  return Number.isFinite(time) ? now - time : Infinity;
}

async function remind(client, config, store, ticket, force = false) {
  const forum = await tickets.forumFor(client, config);
  const thread = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!thread || thread.parentId !== forum.id || thread.archived) return false;
  const now = Date.now();

  if (!ticket.claimedBy) {
    const last = ticket.lastUnclaimedReminderAt || ticket.createdAt;
    if (!force && elapsed(now, last) < TWO_HOURS) return false;
    await thread.send({
      embeds: [new EmbedBuilder().setColor(0xf4ba50).setTitle("Ticket awaiting claim")
        .setDescription("A player ticket is still unclaimed. Helpers or Moderators, please review this request.")],
      allowedMentions: NO_MENTIONS
    });
    store.changeTicket(ticket.channelId, {
      lastUnclaimedReminderAt: new Date(now).toISOString(),
      unclaimedReminderCount: (ticket.unclaimedReminderCount || 0) + 1
    });
    await tickets.notifyOpener(client, ticket, "Your RayCraft ticket #" + ticket.number + " is still open. Staff have been reminded to respond.");
    return true;
  }

  const lastClaimed = Date.parse(ticket.lastClaimedAt || "");
  const lastStaff = Date.parse(ticket.lastStaffMessageAt || "");
  // If anyone on staff has replied since the latest claim, stop claim reminders.
  if (Number.isFinite(lastStaff) && Number.isFinite(lastClaimed) && lastStaff >= lastClaimed) return false;
  if (!force && (elapsed(now, ticket.lastClaimedAt) < TWELVE_HOURS ||
      (ticket.lastClaimReminderAt && elapsed(now, ticket.lastClaimReminderAt) < TWELVE_HOURS))) return false;

  const count = (ticket.claimReminderCount || 0) + 1;
  if (count >= 3) {
    const updated = store.changeTicket(ticket.channelId, {
      claimedBy: null, pingOptIn: false, lastClaimedAt: null,
      claimReminderCount: 0, lastClaimReminderAt: null,
      lastUnclaimedReminderAt: new Date(now).toISOString()
    });
    await tickets.updateTicketPost(client, updated);
    await thread.send({
      embeds: [new EmbedBuilder().setColor(0xce6f51).setTitle("Ticket unclaimed")
        .setDescription("The claimant did not respond after two reminders. This ticket is now available for another staff member.")],
      allowedMentions: NO_MENTIONS
    });
    await tickets.notifyOpener(client, ticket, "Your RayCraft ticket #" + ticket.number + " was returned to the staff queue due to inactivity.");
    return true;
  }
  await thread.send({
    content: "<@" + ticket.claimedBy + ">",
    embeds: [new EmbedBuilder().setColor(0xdb9656).setTitle("Ticket response needed")
      .setDescription("You claimed this ticket but haven't responded. Please reply or unclaim it. Reminder " + count + " of 2.")],
    allowedMentions: { parse: [], users: [ticket.claimedBy] }
  });
  store.changeTicket(ticket.channelId, {
    claimReminderCount: count, lastClaimReminderAt: new Date(now).toISOString()
  });
  return true;
}

async function sweep(client, config, store) {
  let count = 0;
  for (const ticket of store.activeTickets(config.guildId)) {
    try {
      if (await remind(client, config, store, ticket)) count++;
    } catch (error) {
      console.error("Ticket reminder sweep failed for ticket #" + ticket.number, error);
    }
  }
  return count;
}

module.exports = { remind, sweep };
