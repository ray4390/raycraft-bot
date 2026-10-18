"use strict";

const {
  ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle
} = require("discord.js");
const { authorized } = require("./policy");
const { replyPrivate, requireStaff, audit } = require("./common");

const drafts = new Map();
const pending = new Set();
const CHOICES = {
  help: "Player Help",
  report: "Report Griefing / Theft",
  appeal: "Appeals",
  technical: "Technical Support",
  other: "Other"
};
const NO_MENTIONS = { parse: [] };
const ephemeral = MessageFlags.Ephemeral;

function ticketEmbed(ticket) {
  return new EmbedBuilder().setColor(ticket.claimedBy ? 0x468e64 : 0xd89d43)
    .setTitle("RayCraft Modmail #" + ticket.number)
    .setDescription("**Player:** <@" + ticket.openerId + "> (\`" + ticket.openerId + "\`)")
    .addFields(
      { name: "Category", value: CHOICES[ticket.category] || ticket.category, inline: true },
      { name: "Claimed by", value: ticket.claimedBy ? "<@" + ticket.claimedBy + ">" : "Unclaimed", inline: true },
      { name: "Initial request", value: ticket.details.slice(0, 1024) }
    ).setFooter({ text: "Staff-only forum. Normal thread messages are relayed to the player via DM." });
}

function buttons(ticket) {
  if (ticket.status === "closed") return null;
  const controls = [];
  if (ticket.claimedBy) {
    controls.push(new ButtonBuilder().setCustomId("rct:unclaim").setLabel("Unclaim").setStyle(ButtonStyle.Secondary));
    controls.push(new ButtonBuilder().setCustomId("rct:ping").setLabel("Ping settings").setStyle(ButtonStyle.Primary));
    controls.push(new ButtonBuilder().setCustomId("rct:takeover").setLabel("Take over").setStyle(ButtonStyle.Secondary));
  } else controls.push(new ButtonBuilder().setCustomId("rct:claim").setLabel("Claim ticket").setStyle(ButtonStyle.Success));
  controls.push(new ButtonBuilder().setCustomId("rct:close").setLabel("Close ticket").setStyle(ButtonStyle.Danger));
  return new ActionRowBuilder().addComponents(controls);
}

function categoryButtons() {
  const items = Object.entries(CHOICES).map(([key, label]) =>
    new ButtonBuilder().setCustomId("rct:category:" + key).setLabel(label).setStyle(ButtonStyle.Secondary)
  );
  return new ActionRowBuilder().addComponents(items);
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
  // A per-role allow can override @everyone's deny; refuse any non-staff access.
  await guild.roles.fetch();
  const bot = await guild.members.fetchMe();
  const staffRoles = new Set([...config.moderatorRoles, ...config.helperRoles, ...bot.roles.cache.keys()]);
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.roles.everyone.id || staffRoles.has(role.id) ||
        role.permissions.has(PermissionFlagsBits.Administrator)) continue;
    if (forum.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error("Ticket forum grants access to a non-staff role: " + role.name + " (" + role.id + ")");
    }
  }
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
  return user.send({
    embeds: [new EmbedBuilder().setTitle("RayCraft Modmail")
      .setDescription("Choose a topic below to contact RayCraft staff. Your messages will be forwarded privately to the staff ticket forum. Please provide details and avoid sending passwords or other secrets.")
      .setColor(0x426c52)],
    components: [categoryButtons()],
    allowedMentions: NO_MENTIONS
  });
}

async function begin(interaction, client, config, store) {
  if (store.isBlacklisted(config.guildId, interaction.user.id)) {
    return replyPrivate(interaction, "Your account currently cannot open new modmail tickets. Contact the server owner if this is an error.");
  }
  if (store.openTicket(config.guildId, interaction.user.id)) {
    return replyPrivate(interaction, "You already have an open ticket. Reply to this bot in DMs to continue it.");
  }
  try {
    await forumFor(client, config);
    await promptUser(interaction.user);
    return replyPrivate(interaction, "Check your DMs to choose a ticket category and explain your request.");
  } catch (error) {
    console.error("Unable to open modmail prompt:", error.message);
    return replyPrivate(interaction, "Couldn't start modmail. Check that bot DMs are enabled and the ticket forum is configured as staff-only.");
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
    const desired = [ticket.category, ticket.claimedBy ? "claimed" : "unclaimed"];
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
      details, claimedBy: null, contact, pingOptIn: false,
      createdAt: new Date().toISOString(), lastStaffMessageAt: null,
      lastUserMessageAt: null, lastSpeaker: null, lastClaimedAt: null
    };
    const slug = (user.username || "player").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "player";
    const tags = [category, "unclaimed"].map((name) =>
      forum.availableTags.find((t) => t.name.toLowerCase() === name)?.id).filter(Boolean);
    // In case of Discord post-creation failure, the ticket counter can skip a value. That is safe.
    const thread = await forum.threads.create({
      name: slug + "-" + number,
      message: { embeds: [ticketEmbed(initial)], components: [buttons(initial)], allowedMentions: NO_MENTIONS },
      appliedTags: tags,
      autoArchiveDuration: 10080,
      reason: "RayCraft modmail opened by " + user.id
    });
    const starter = await thread.fetchStarterMessage().catch(() => null);
    const ticket = { ...initial, channelId: thread.id, starterMessageId: starter?.id || null };
    store.addTicket(ticket);
    if (starter) await starter.pin().catch(() => {});
    const message = "Your **" + CHOICES[category] + "** ticket #" + number +
      " has been opened. Reply in this DM to speak with staff. I'll react ✅ when a message reaches staff and ❌ if it fails.";
    await user.send({ content: message, allowedMentions: NO_MENTIONS }).catch((error) =>
      console.warn("Ticket created but user notification failed:", error.message));
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
      .setTitle("RayCraft — " + CHOICES[arg])
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("details").setLabel("Describe your issue")
          .setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1024).setRequired(true)
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
      embeds: [new EmbedBuilder().setColor(0xe6a347).setTitle("Confirm RayCraft Ticket")
        .addFields({ name: "Category", value: CHOICES[arg] }, { name: "Message", value: details })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rct:submit:" + nonce).setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("rct:cancel:" + nonce).setLabel("Cancel").setStyle(ButtonStyle.Danger)
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
      return interaction.editReply({ content: "Ticket #" + ticket.number + " opened! Continue by sending messages here.", embeds: [], components: [] });
    } catch (error) {
      console.error("Modmail create failed:", error);
      return interaction.editReply({ content: "Ticket could not be created: " + error.message, embeds: [], components: [] });
    }
  }
}

async function notifyOpener(client, ticket, message) {
  try {
    const user = await client.users.fetch(ticket.openerId);
    await user.send({ content: message, allowedMentions: NO_MENTIONS });
  } catch (error) {
    console.warn("Unable to DM ticket opener:", error.message);
  }
}

async function staffAction(interaction, client, config, store, action) {
  const actor = await requireStaff(interaction, config, "helper");
  if (!actor) return;
  const ticket = store.ticketByChannel(interaction.channelId);
  if (!ticket || interaction.channel.parentId !== config.ticketForumId) {
    return replyPrivate(interaction, "Use this action inside an active RayCraft ticket forum thread.");
  }
  if (ticket.category === "appeal" && !authorized(actor, interaction.guild, config, "moderator")) {
    return replyPrivate(interaction, "Appeal decisions require a Moderator.");
  }

  if (action === "close") {
    return interaction.reply({
      content: "Close this ticket? The conversation will be retained in the archived forum thread.",
      flags: ephemeral,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rct:closeconfirm").setLabel("Confirm close").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("rct:closecancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      )]
    });
  }
  if (action === "closecancel") {
    return interaction.update({ content: "Closure cancelled.", components: [] });
  }
  if (action === "closeconfirm") {
    await interaction.deferUpdate();
    store.changeTicket(ticket.channelId, { status: "closed", closedAt: new Date().toISOString(), closedBy: actor.id });
    await interaction.channel.send({ content: "Ticket closed by <@" + actor.id + ">.", allowedMentions: NO_MENTIONS });
    await updateTicketPost(client, { ...ticket, status: "closed" }).catch(() => {});
    await notifyOpener(client, ticket, "Your RayCraft ticket #" + ticket.number + " has been closed.");
    await interaction.channel.setArchived(true);
    await audit(interaction, config, "Ticket #" + ticket.number + " closed by <@" + actor.id + ">.");
    return interaction.editReply({ content: "Ticket closed and archived.", components: [] });
  }
  if (action === "claim" || action === "takeover") {
    if (ticket.claimedBy && action !== "takeover") return replyPrivate(interaction, "This ticket is already claimed. Moderators can take over when necessary.");
    if (action === "takeover" && !authorized(actor, interaction.guild, config, "moderator")) {
      return replyPrivate(interaction, "Only Moderators can take over claimed tickets.");
    }
    const changes = {
      claimedBy: actor.id, pingOptIn: false, lastClaimedAt: new Date().toISOString(),
      claimReminderCount: 0, lastClaimReminderAt: null
    };
    const updated = store.changeTicket(ticket.channelId, changes);
    await updateTicketPost(client, updated);
    await notifyOpener(client, ticket, "Your ticket #" + ticket.number + " has been claimed and is under review.");
    await audit(interaction, config, "Ticket #" + ticket.number + " claimed by <@" + actor.id + ">.");
    return replyPrivate(interaction, "Claimed ticket #" + ticket.number + ". Use Ping settings to opt in to follow-up mentions.");
  }
  if (action === "unclaim") {
    if (ticket.claimedBy !== actor.id && !authorized(actor, interaction.guild, config, "moderator")) {
      return replyPrivate(interaction, "Only the claimant or a Moderator may unclaim this ticket.");
    }
    const updated = store.changeTicket(ticket.channelId, {
      claimedBy: null, pingOptIn: false, lastClaimedAt: null,
      claimReminderCount: 0, lastClaimReminderAt: null, lastUnclaimedReminderAt: new Date().toISOString()
    });
    await updateTicketPost(client, updated);
    await notifyOpener(client, ticket, "Ticket #" + ticket.number + " is awaiting another staff member.");
    return replyPrivate(interaction, "Ticket unclaimed.");
  }
  if (action === "ping" || action === "pingon" || action === "pingoff") {
    if (ticket.claimedBy !== actor.id) return replyPrivate(interaction, "Only the current claimant controls ticket pings.");
    if (action === "ping") {
      return interaction.reply({
        content: "Notify you when the player replies? Current setting: **" + (ticket.pingOptIn ? "ON" : "OFF") + "**.",
        flags: ephemeral,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("rct:pingon").setLabel("Enable pings").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("rct:pingoff").setLabel("Disable pings").setStyle(ButtonStyle.Secondary)
        )]
      });
    }
    store.changeTicket(ticket.channelId, { pingOptIn: action === "pingon" });
    if (interaction.isButton()) return interaction.update({ content: "Ticket pings " + (action === "pingon" ? "enabled" : "disabled") + ".", components: [] });
    return replyPrivate(interaction, "Ticket ping settings updated.");
  }
  if (action === "remind") {
    const reminders = require("./ticketReminders");
    await reminders.remind(client, config, store, ticket, true);
    return replyPrivate(interaction, "Ticket reminder check triggered.");
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
      await audit(interaction, config, "Modmail " + (blocked ? "blacklist" : "unblacklist") + " by <@" + actor.id + "> for <@" + user.id + ">.");
      return replyPrivate(interaction, "Modmail for " + user.username + " is now " + (blocked ? "blocked" : "allowed") + ".");
    }
    if (store.openTicket(config.guildId, user.id)) {
      return replyPrivate(interaction, "That player already has an open ticket.");
    }
    const reason = interaction.options.getString("reason", true);
    await interaction.deferReply({ flags: ephemeral });
    try {
      await user.send({ content: "RayCraft staff would like to contact you: " + reason + "\nPlease reply here to communicate through modmail.", allowedMentions: NO_MENTIONS });
    } catch (error) {
      return interaction.editReply("Could not DM that player, so no ticket was opened.");
    }
    try {
      const ticket = await createTicket(client, config, store, user, "other", reason, true);
      await audit(interaction, config, "Staff-initiated ticket #" + ticket.number + " opened by <@" + actor.id + "> for <@" + user.id + ">.");
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
