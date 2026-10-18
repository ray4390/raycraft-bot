"use strict";
const tickets = require("./tickets");
const style = require("./ticketStyle");

const TWO_HOURS = 2 * 60 * 60 * 1000;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

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
    const roles = style.pingRoles(ticket, config);
    await thread.send({
      content: roles.map(id => "<@&" + id + ">").join(" "),
      embeds: [style.notice("This ticket is still unclaimed. Please claim it and respond to the player.", "yellow", "Ticket Awaiting Claim")],
      allowedMentions: { parse: [], roles }
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
    const roles = style.pingRoles(updated, config);
    await thread.send({
      content: roles.map(id => "<@&" + id + ">").join(" "),
      embeds: [style.notice("The claimant did not respond after two reminders. This ticket is available for another staff member.", "red", "Ticket Unclaimed")],
      allowedMentions: { parse: [], roles }
    });
    await tickets.notifyOpener(client, ticket, "Your RayCraft ticket #" + ticket.number + " was returned to the staff queue due to inactivity.");
    return true;
  }
  await thread.send({
    content: "<@" + ticket.claimedBy + ">",
    embeds: [style.notice("You claimed this ticket but haven't responded. Please reply or unclaim it. Reminder " + count + " of 2.", "yellow", "Ticket Response Needed")],
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
