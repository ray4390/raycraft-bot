"use strict";

const {
  ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle
} = require("discord.js");
const { authorized } = require("./policy");
const { replyPrivate, requireStaff } = require("./common");
const style = require("./ticketStyle");

const drafts = new Map();
const pending = new Set();
const CHOICES = Object.fromEntries(Object.entries(style.categories).map(([key, value]) => [key, value.name]));
const NO_MENTIONS = { parse: [] };
const ephemeral = MessageFlags.Ephemeral;

function ticketEmbed(ticket) {
  return style.openingEmbed(ticket);
}

function buttons(ticket) {
  if (ticket.status === "closed") return null;
  const controls = [];
  if (ticket.claimedBy) {
    controls.push(new ButtonBuilder().setCustomId("rct:unclaim").setLabel("Unclaim Ticket").setStyle(ButtonStyle.Secondary));
    controls.push(new ButtonBuilder().setCustomId("rct:ping").setLabel("Ping Settings").setStyle(ButtonStyle.Primary));
    controls.push(new ButtonBuilder().setCustomId("rct:takeover").setLabel("❗").setStyle(ButtonStyle.Secondary));
  } else controls.push(new ButtonBuilder().setCustomId("rct:claim").setLabel("Claim Ticket").setStyle(ButtonStyle.Success));
  controls.push(new ButtonBuilder().setCustomId("rct:close").setLabel("Close ticket").setStyle(ButtonStyle.Danger));
  return new ActionRowBuilder().addComponents(controls);
}

function categoryButtons() {
  return style.categoryMenu().components[0];
}

async function forumFor(client, config) {
  if (!config.ticketForumId) throw new Error("TICKET_FORUM_ID is not configured");
  const guild = await client.guilds.fetch(config.guildId);
  const forum = await guild.channels.fetch(config.ticketForumId);
  if (!forum || forum.type !== ChannelType.GuildForum) {
    throw new Error("TICKET_FORUM_ID must identify a Discord forum channel");
  }
  // Discord forum posts inherit forum visibility. Never place a player's report in a public forum.
  if (forum.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error("Ticket forum is visible to @everyone. Deny View Channel for @everyone before accepting tickets");
  }
  // Discord forum visibility is controlled by the server administrator.
  // Do not block startup for additional explicitly granted roles such as
  // the owner's personal role. @everyone must remain unable to view tickets.
  await guild.roles.fetch();
  const bot = await guild.members.fetchMe();
  for (const id of [...config.moderatorRoles, ...config.helperRoles]) {
    const role = guild.roles.cache.get(id);
    if (!role) throw new Error("Configured staff role ID not found in RayCraft Discord: " + id);
    if (!forum.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error("Configured staff role cannot view the private ticket forum: " + role.name);
    }
  }
  const permissions = forum.permissionsFor(bot);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.SendMessages) ||
      !permissions?.has(PermissionFlagsBits.SendMessagesInThreads)) {
    throw new Error("RayCraft Bot needs View Channel, Send Messages, and Send Messages in Threads in the private forum");
  }
  return forum;
}

async function promptUser(user) {
  return user.send(style.categoryMenu());
}

async function begin(interaction, client, config, store) {
  // Acknowledge the button/slash command before ANY Discord fetch or outbound DM.
  // This prevents "the application did not respond" even when a DM arrives.
  await interaction.deferReply({ flags: ephemeral });
  if (store.isBlacklisted(config.guildId, interaction.user.id)) {
    return replyPrivate(interaction, "Your account currently cannot open new modmail tickets. Contact the server owner if this is an error.");
  }
  if (store.openTicket(config.guildId, interaction.user.id)) {
    return replyPrivate(interaction, "You already have an open ticket. Reply to this bot in DMs to continue it.");
  }
  try {
    await forumFor(client, config);
    await promptUser(interaction.user);
    return interaction.editReply({ embeds: [style.notice("✅ **Check your DMs to proceed!** Choose a category and complete the form to submit your ticket.", "green", "RayCraft Modmail")], content: "" });
  } catch (error) {
    console.error("Unable to open modmail prompt:", error.message);
    return interaction.editReply({ embeds: [style.notice("I couldn't send a DM or access the private ticket forum. Please enable DMs from RayBot and try again. If the issue persists, contact staff.", "red", "Unable to Start Modmail")], content: "" });
  }
}

async function updateTicketPost(client, ticket) {
  const thread = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!thread) return;
  let starter = await thread.fetchStarterMessage().catch(() => null);
  if (!starter && ticket.starterMessageId) starter = await thread.messages.fetch(ticket.starterMessageId).catch(() => null);
  if (starter) await starter.edit({ embeds: [ticketEmbed(ticket)], components: ticket.status === "closed" ? [] : [buttons(ticket)] });
  const forum = thread.parent;
  if (forum?.availableTags) {
    const desired = [ticket.category, style.categoryName(ticket.category).toLowerCase(), ticket.claimedBy ? "claimed" : "unclaimed"];
    const tags = desired.map((name) => forum.availableTags.find((t) => t.name.toLowerCase() === name)?.id).filter(Boolean);
    if (tags.length) await thread.setAppliedTags(tags).catch((err) => console.error("Could not update forum tags:", err));
  }
}

async function createTicket(client, config, store, user, category, details, contact = false) {
  const key = config.guildId + ":" + user.id;
  if (pending.has(key)) throw new Error("Ticket creation already in progress");
  pending.add(key);
  try {
    const existing = store.openTicket(config.guildId, user.id);
    if (existing) throw new Error("You already have an open ticket");
    const forum = await forumFor(client, config);
    const number = store.nextTicketNumber(config.guildId);
    const initial = {
      number, guildId: config.guildId, openerId: user.id, category,
      details, playerName: user.username, avatarURL: user.displayAvatarURL?.() || null,
      claimedBy: null, contact, pingOptIn: false,
      createdAt: new Date().toISOString(), lastStaffMessageAt: null,
      lastUserMessageAt: null, lastSpeaker: null, lastClaimedAt: null
    };
    const slug = (user.username || "player").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "player";
    const tags = [category, style.categoryName(category).toLowerCase(), "unclaimed"]
      .map(name => forum.availableTags.find(t => t.name.toLowerCase() === name)?.id)
      .filter((id, index, array) => id && array.indexOf(id) === index);
    const roleIds = contact ? [] : style.pingRoles(initial, config);
    const pingContent = roleIds.map(id => "<@&" + id + ">").join(" ");
    // In case of Discord post-creation failure, the ticket counter can skip a value. That is safe.
    const thread = await forum.threads.create({
      name: slug + "-" + number,
      message: {
        content: pingContent,
        embeds: [ticketEmbed(initial)],
        components: [buttons(initial)],
        allowedMentions: { parse: [], roles: roleIds }
      },
      appliedTags: tags,
      autoArchiveDuration: 10080,
      reason: "RayCraft modmail opened by " + user.id
    });
    const starter = await thread.fetchStarterMessage().catch(() => null);
    const ticket = { ...initial, channelId: thread.id, starterMessageId: starter?.id || null };
    store.addTicket(ticket);
    if (starter) await starter.pin().catch(() => {});
    if (contact) {
      await user.send({ embeds: style.openedEmbeds(ticket), allowedMentions: NO_MENTIONS }).catch(error =>
        console.warn("Staff-initiated ticket created but player notification failed:", error.message));
    }
    return ticket;
  } finally {
    pending.delete(key);
  }
}

async function draftInteraction(interaction, client, config, store) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;
  const [prefix, action, arg] = interaction.customId.split(":");
  if (prefix !== "rct") return;
  if (action === "category" && interaction.isButton()) {
    if (!CHOICES[arg]) return;
    if (store.isBlacklisted(config.guildId, interaction.user.id)) {
      return replyPrivate(interaction, "You cannot open new modmail tickets.");
    }
    if (store.openTicket(config.guildId, interaction.user.id)) {
      return replyPrivate(interaction, "You already have a ticket. Reply to this bot here in DMs.");
    }
    const modal = new ModalBuilder().setCustomId("rct:details:" + arg)
      .setTitle("RayCraft Modmail System")
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("details").setLabel("Describe your issue")
          .setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1024).setRequired(true)
          .setPlaceholder("Please explain why you're opening this ticket.")
      ));
    return interaction.showModal(modal);
  }
  if (action === "details" && interaction.isModalSubmit()) {
    if (!CHOICES[arg]) return;
    if (store.isBlacklisted(config.guildId, interaction.user.id)) return replyPrivate(interaction, "You cannot open new modmail tickets.");
    const details = interaction.fields.getTextInputValue("details");
    const nonce = Date.now().toString(36);
    drafts.set(interaction.user.id, { category: arg, details, nonce, time: Date.now() });
    return interaction.reply({
      embeds: [style.confirmation(arg, details)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rct:submit:" + nonce).setLabel("Confirm").setEmoji("✔️").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("rct:cancel:" + nonce).setLabel("Cancel").setEmoji("✖️").setStyle(ButtonStyle.Danger)
      )]
    });
  }
  if (action === "submit" || action === "cancel") {
    const draft = drafts.get(interaction.user.id);
    if (!draft || draft.nonce !== arg || Date.now() - draft.time > 15 * 60 * 1000) {
      return replyPrivate(interaction, "This request expired. Start a new ticket.");
    }
    if (action === "cancel") {
      drafts.delete(interaction.user.id);
      return interaction.update({ content: "Ticket cancelled.", embeds: [], components: [] });
    }
    // Acknowledge promptly, then create the forum post. Never display ticket details in a public channel.
    await interaction.deferUpdate();
    if (store.isBlacklisted(config.guildId, interaction.user.id)) {
      return interaction.editReply({ content: "You cannot open new modmail tickets.", embeds: [], components: [] });
    }
    try {
      const ticket = await createTicket(client, config, store, interaction.user, draft.category, draft.details);
      drafts.delete(interaction.user.id);
      return interaction.editReply({ content: "", embeds: style.openedEmbeds(ticket), components: [] });
    } catch (error) {
      console.error("Modmail create failed:", error);
      return interaction.editReply({ content: "Ticket could not be created: " + error.message, embeds: [], components: [] });
    }
  }
}

async function notifyOpener(client, ticket, message, kind = "green") {
  try {
    const user = await client.users.fetch(ticket.openerId);
    const embed = style.notice(message, kind);
    await user.send({ embeds: [embed], allowedMentions: NO_MENTIONS });
  } catch (error) {
    console.warn("Unable to DM ticket opener:", error.message);
  }
}

async function staffAction(interaction, client, config, store, action) {
  // Acknowledge potentially slow moderator actions before remote requests.
  if (["claim", "takeover", "unclaim", "remind"].includes(action)) {
    await interaction.deferReply({ flags: ephemeral });
  }
  if (action === "closeconfirm") await interaction.deferUpdate();

  const actor = await requireStaff(interaction, config, "helper");
  if (!actor) return;
  const ticket = store.ticketByChannel(interaction.channelId);
  if (!ticket || interaction.channel.parentId !== config.ticketForumId) {
    return replyPrivate(interaction, "This command must be used inside an active RayCraft ticket.");
  }
  if (ticket.category === "appeal" && !authorized(actor, interaction.guild, config, "moderator")) {
    return replyPrivate(interaction, "Only Moderators may handle appeal tickets.");
  }

  if (action === "close") {
    return interaction.reply({
      embeds: [style.notice("Are you sure you want to close this ticket? The conversation will be retained in the archived forum thread.", "red", "Close Ticket?")],
      flags: ephemeral,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rct:closeconfirm").setLabel("Confirm").setEmoji("✔️").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("rct:closecancel").setLabel("Cancel").setEmoji("✖️").setStyle(ButtonStyle.Danger)
      )]
    });
  }
  if (action === "closecancel") {
    return interaction.update({ content: "Ticket closure cancelled.", embeds: [], components: [] });
  }
  if (action === "closeconfirm") {
    // Mark closed before archiving to prevent any further DM relay.
    store.changeTicket(ticket.channelId, { status: "closed", closedAt: new Date().toISOString(), closedBy: actor.id });
    await interaction.channel.send({
      embeds: [style.notice("This thread has been closed by <@" + actor.id + ">.", "red", "Ticket Closed")],
      allowedMentions: NO_MENTIONS
    });
    await updateTicketPost(client, { ...ticket, status: "closed" }).catch(error =>
      console.warn("Could not update closed ticket starter:", error.message));
    await notifyOpener(client, ticket, "Your **" + style.categoryName(ticket.category) + "** ticket **#" + ticket.number + "** has been closed.", "red");
    await interaction.channel.setArchived(true);
    return interaction.editReply({ content: "Ticket closed and archived.", embeds: [], components: [] });
  }

  if (action === "claim" || action === "takeover") {
    if (ticket.claimedBy && action === "claim") return replyPrivate(interaction, "Ticket already claimed. A Moderator may take it over.");
    if (action === "takeover" && !authorized(actor, interaction.guild, config, "moderator")) {
      return replyPrivate(interaction, "Only Moderators may override a claimed ticket.");
    }
    if (action === "takeover" && !ticket.claimedBy) return replyPrivate(interaction, "This ticket is unclaimed; use Claim Ticket.");
    if (action === "claim" && ticket.claimedBy === actor.id) return replyPrivate(interaction, "You have already claimed this ticket.");
    const updated = store.changeTicket(ticket.channelId, {
      claimedBy: actor.id, pingOptIn: false, lastClaimedAt: new Date().toISOString(),
      claimReminderCount: 0, lastClaimReminderAt: null
    });
    await updateTicketPost(client, updated).catch(error =>
      console.warn("Could not refresh claimed ticket controls (claim is saved):", error));
    await interaction.channel.send({
      embeds: [style.notice(
        "This ticket has been " + (action === "takeover" ? "taken over" : "claimed") + " by <@" + actor.id + ">.",
        action === "takeover" ? "yellow" : "green"
      )],
      allowedMentions: NO_MENTIONS
    });
    await notifyOpener(client, ticket,
      "Your ticket has been " + (action === "takeover" ? "reassigned to another staff member" : "claimed and is now being reviewed") + ".", 
      action === "takeover" ? "yellow" : "green");
    return replyPrivate(interaction, {
      embeds: [style.notice("You've claimed ticket **#" + ticket.number + "**. Configure whether RayBot should ping you when the player replies.", "green", "Ticket Claimed")],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rct:pingon").setLabel("Enable pings").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("rct:pingoff").setLabel("No pings").setStyle(ButtonStyle.Secondary)
      )]
    });
  }

  if (action === "unclaim") {
    if (!ticket.claimedBy) return replyPrivate(interaction, "This ticket is already unclaimed.");
    if (ticket.claimedBy !== actor.id && !authorized(actor, interaction.guild, config, "moderator")) {
      return replyPrivate(interaction, "Only the claimant or a Moderator may unclaim this ticket.");
    }
    const updated = store.changeTicket(ticket.channelId, {
      claimedBy: null, pingOptIn: false, lastClaimedAt: null,
      claimReminderCount: 0, lastClaimReminderAt: null, lastUnclaimedReminderAt: new Date().toISOString()
    });
    await updateTicketPost(client, updated).catch(error =>
      console.warn("Could not refresh unclaimed ticket controls (state is saved):", error));
    const roles = style.pingRoles(updated, config);
    await interaction.channel.send({
      content: roles.map(id => "<@&" + id + ">").join(" "),
      embeds: [style.notice("Ticket unclaimed by <@" + actor.id + ">. This request is awaiting a new staff member.", "red", "Ticket Available")],
      allowedMentions: { parse: [], roles }
    });
    await notifyOpener(client, ticket, "Your ticket has been unclaimed and is awaiting another staff member.", "red");
    return replyPrivate(interaction, { embeds: [style.notice("Ticket returned to the staff queue.", "green")] });
  }

  if (["ping", "pingon", "pingoff"].includes(action)) {
    if (ticket.claimedBy !== actor.id) return replyPrivate(interaction, "Only the current claimant may change their ticket ping preferences.");
    if (action === "ping") {
      return interaction.reply({
        embeds: [style.notice(
          "**Claimed by:** <@" + actor.id + ">\n**Pings:** " + (ticket.pingOptIn ? "Enabled" : "Disabled") +
          "\n\nWhen enabled, RayBot will mention you when the player sends a message after staff spoke last, or after they've waited at least five minutes between messages.",
          ticket.pingOptIn ? "green" : "gray", "Ticket Ping Settings")],
        flags: ephemeral,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("rct:pingon").setLabel("Enable pings").setStyle(ButtonStyle.Success).setDisabled(!!ticket.pingOptIn),
          new ButtonBuilder().setCustomId("rct:pingoff").setLabel("No pings").setStyle(ButtonStyle.Secondary).setDisabled(!ticket.pingOptIn)
        )]
      });
    }
    const enabled = action === "pingon";
    store.changeTicket(ticket.channelId, { pingOptIn: enabled });
    const payload = { embeds: [style.notice("Ticket claimant pings are now **" + (enabled ? "enabled" : "disabled") + "**.", enabled ? "green" : "gray")], components: [] };
    if (interaction.isButton()) return interaction.update(payload);
    return replyPrivate(interaction, payload);
  }

  if (action === "remind") {
    const reminders = require("./ticketReminders");
    await reminders.remind(client, config, store, ticket, true);
    return replyPrivate(interaction, { embeds: [style.notice("Ticket reminder check triggered.", "yellow")] });
  }
}

async function command(interaction, client, config, store) {
  const sub = interaction.options.getSubcommand();
  if (sub === "open") return begin(interaction, client, config, store);
  if (sub === "contact" || sub === "blacklist" || sub === "unblacklist") {
    const actor = await requireStaff(interaction, config, "moderator");
    if (!actor) return;
    const user = interaction.options.getUser("user", true);
    if (sub === "blacklist" || sub === "unblacklist") {
      const blocked = sub === "blacklist";
      store.setBlacklisted(config.guildId, user.id, blocked);
      return replyPrivate(interaction, "Modmail for " + user.username + " is now " + (blocked ? "blocked" : "allowed") + ".");
    }
    if (store.openTicket(config.guildId, user.id)) {
      return replyPrivate(interaction, "That player already has an open ticket.");
    }
    const reason = interaction.options.getString("reason", true);
    await interaction.deferReply({ flags: ephemeral });
    try {
      await user.send({ embeds: [style.notice("RayCraft staff have opened a modmail conversation with you.\n\n**Reason:** " + reason + "\n\nReply here to communicate privately with staff.", "yellow", "RayCraft Staff Contact")], allowedMentions: NO_MENTIONS });
    } catch (error) {
      return interaction.editReply("Could not DM that player, so no ticket was opened.");
    }
    try {
      const ticket = await createTicket(client, config, store, user, "other", reason, true);
      return interaction.editReply("Staff-initiated ticket opened: <#" + ticket.channelId + ">.");
    } catch (error) {
      console.error("Failed to initiate staff modmail ticket:", error);
      return interaction.editReply("Could not create the forum ticket: " + error.message);
    }
  }
  return staffAction(interaction, client, config, store, sub);
}

async function component(interaction, client, config, store) {
  const action = interaction.customId.split(":")[1];
  return staffAction(interaction, client, config, store, action);
}

module.exports = {
  CHOICES, forumFor, begin, createTicket, command, component, draftInteraction,
  promptUser, ticketEmbed, buttons, updateTicketPost, notifyOpener
};
