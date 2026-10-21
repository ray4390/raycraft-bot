"use strict";
const { authorized } = require("./policy");
const tickets = require("./tickets");
const style = require("./ticketStyle");
const { sendRelay } = require("./ticketMedia");

const NO_MENTIONS = { parse: [] };
const PROMPTS = new Map();
const USER_GAP_MS = 5 * 60 * 1000;

async function reaction(message, emoji) {
  try { await message.react(emoji); } catch (error) {
    console.warn("Modmail reaction failed:", error.message);
  }
}

function userPing(ticket, now) {
  if (!ticket.pingOptIn || !ticket.claimedBy) return false;
  if (ticket.lastSpeaker === "staff") return true;
  const lastUser = Date.parse(ticket.lastUserMessageAt || "");
  return ticket.lastSpeaker === "user" &&
    Number.isFinite(lastUser) && now - lastUser >= USER_GAP_MS;
}

async function dmMessage(message, client, config, store) {
  if (message.author.bot) return;
  const ticket = store.openTicket(config.guildId, message.author.id);
  if (!ticket) {
    if (store.isBlacklisted(config.guildId, message.author.id)) {
      await reaction(message, "❌");
      return;
    }
    const last = PROMPTS.get(message.author.id) || 0;
    if (Date.now() - last < 30000) return;
    PROMPTS.set(message.author.id, Date.now());
    await tickets.promptUser(message.author).catch(async () => {
      await message.reply("Use /ticket open inside RayCraft to start a modmail ticket.").catch(() => {});
    });
    return;
  }
  let forum;
  try {
    forum = await tickets.forumFor(client, config);
  } catch (error) {
    console.error("Refusing to forward DM to unsafe forum:", error);
    await message.reply("Your ticket is still open, but delivery is paused while staff fix the private forum permissions.").catch(() => {});
    await reaction(message, "❌");
    return;
  }
  const thread = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!thread || thread.parentId !== forum.id) {
    await reaction(message, "❌");
    return message.reply("The ticket forum thread is currently unavailable. Staff will need to investigate.").catch(() => {});
  }
  try {
    if (thread.archived) await thread.setArchived(false);
    const now = Date.now();
    const ping = userPing(ticket, now);
    const embed = style.incomingEmbed(message);
    await sendRelay(thread, embed, message, {
      content: ping ? "<@" + ticket.claimedBy + ">" : undefined,
      allowedMentions: ping ? { parse: [], users: [ticket.claimedBy] } : NO_MENTIONS
    });
    store.changeTicket(ticket.channelId, {
      lastSpeaker: "user", lastUserMessageAt: new Date(now).toISOString()
    });
    await reaction(message, "✅");
  } catch (error) {
    console.error("Failed to forward modmail DM:", error);
    await reaction(message, "❌");
    await message.reply("Delivery failed. Please try again shortly.").catch(() => {});
  }
}

async function staffMessage(message, client, config, store) {
  if (message.author.bot || !message.guild || message.guildId !== config.guildId) return;
  if (!message.channel.isThread?.() || message.channel.parentId !== config.ticketForumId) return;
  const ticket = store.ticketByChannel(message.channel.id);
  if (!ticket) return; // Closed/archived tickets do not relay anything.
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!authorized(member, message.guild, config, "helper") ||
      (ticket.category === "appeal" && !authorized(member, message.guild, config, "moderator"))) {
    console.warn("Ignored ticket forum message from unauthorized user:", message.author.id);
    return;
  }
  // Deliberate staff-only notes, unlike ordinary thread replies, are never relayed.
  if (message.content?.startsWith("//")) return;
  let user;
  try {
    user = await client.users.fetch(ticket.openerId);
    const embed = style.outgoingEmbed(message, ticket);
    await sendRelay(user, embed, message);
    const now = new Date().toISOString();
    const changes = {
      lastSpeaker: "staff", lastStaffMessageAt: now,
      claimReminderCount: 0, lastClaimReminderAt: null
    };
    if (!ticket.claimedBy) {
      changes.claimedBy = message.author.id;
      changes.lastClaimedAt = now;
      changes.pingOptIn = false;
    }
    const wasUnclaimed = !ticket.claimedBy;
    const updated = store.changeTicket(ticket.channelId, changes);
    if (wasUnclaimed) {
      await tickets.updateTicketPost(client, updated).catch(error => console.warn("Could not update automatically claimed ticket:", error.message));
      await tickets.notifyOpener(client, ticket, "Your ticket has been claimed and is now being reviewed.");
    }
    await reaction(message, "✅");
  } catch (error) {
    console.warn("Modmail reply failed for ticket #" + ticket.number + ":", error);
    await reaction(message, "❌");
    await message.channel.send({
      embeds: [style.notice("I couldn't DM this player. They may have disabled DMs, blocked RayBot, or left the server.", "red", "Message Delivery Failed")],
      allowedMentions: NO_MENTIONS
    }).catch(() => {});
  }
}

async function handleMessage(message, client, config, store) {
  if (message.author.bot) return;
  if (!message.guild) return dmMessage(message, client, config, store);
  return staffMessage(message, client, config, store);
}

module.exports = { handleMessage, userPing };
