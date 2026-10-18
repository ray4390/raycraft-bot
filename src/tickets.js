"use strict";
const { ChannelType, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { authorized } = require("./policy");
const { replyPrivate, audit } = require("./common");

const pending = new Set();

async function open(interaction, client, config, store) {
  if (!config.ticketCategoryId) return replyPrivate(interaction, "Ticket support isn't configured yet. Contact staff.");
  const key = interaction.guildId + ":" + interaction.user.id;
  if (pending.has(key)) return replyPrivate(interaction, "Your ticket is already being created.");
  const existing = store.openTicket(interaction.guildId, interaction.user.id);
  if (existing) return replyPrivate(interaction, "You already have an open ticket: <#" + existing.channelId + ">.");

  const category = await interaction.guild.channels.fetch(config.ticketCategoryId).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) {
    return replyPrivate(interaction, "The ticket category has not been configured correctly.");
  }
  pending.add(key);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const type = interaction.options.getString("category", true);
    const details = interaction.options.getString("details", true);
    const staffRoles = [...new Set([...config.moderatorRoles, ...config.helperRoles])]
      .filter((id) => interaction.guild.roles.cache.has(id));
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles
      ] },
      { id: client.user.id, allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels
      ] },
      ...staffRoles.map((id) => ({ id, allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ] }))
    ];
    const slug = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 16) || "player";
    const channel = await interaction.guild.channels.create({
      name: "ticket-" + slug + "-" + interaction.user.id.slice(-4),
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
      reason: "RayCraft ticket by " + interaction.user.id
    });
    store.addTicket({
      guildId: interaction.guildId, openerId: interaction.user.id,
      category: type, details, channelId: channel.id
    });
    await channel.send({
      content: "<@" + interaction.user.id + "> — your private RayCraft ticket is open.\n**Category:** " + type +
        "\n**Details:** " + details + "\nHelpers and moderators can assist. Run /ticket close when finished.",
      allowedMentions: { parse: [], users: [interaction.user.id] }
    });
    await audit(interaction, config, "Ticket opened: <#" + channel.id + "> by <@" + interaction.user.id + "> (" + type + ").");
    return interaction.editReply("Created private support ticket: <#" + channel.id + ">.");
  } finally {
    pending.delete(key);
  }
}

async function handle(interaction, config, store) {
  const ticket = store.ticketByChannel(interaction.channelId);
  if (!ticket) return replyPrivate(interaction, "Run this command in an open RayCraft ticket.");
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const isStaff = authorized(member, interaction.guild, config);
  if (!isStaff && interaction.user.id !== ticket.openerId) {
    return replyPrivate(interaction, "You cannot manage this ticket.");
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "claim") {
    if (!isStaff) return replyPrivate(interaction, "Only Helpers or Moderators can claim tickets.");
    if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
      return replyPrivate(interaction, "Already claimed by another staff member.");
    }
    store.changeTicket(interaction.channelId, { claimedBy: interaction.user.id });
    await interaction.channel.send({ content: "Ticket claimed by <@" + interaction.user.id + ">.", allowedMentions: { parse: [] } });
    return replyPrivate(interaction, "Ticket claimed.");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.channel.permissionOverwrites.edit(ticket.openerId, { SendMessages: false });
  store.changeTicket(interaction.channelId, {
    status: "closed", closedAt: new Date().toISOString(), closedBy: interaction.user.id
  });
  await interaction.channel.setName("closed-" +
    interaction.channel.name.replace(/^(ticket-|closed-)/, "").slice(0, 80)).catch(() => {});
  await interaction.channel.send({
    content: "Ticket closed by <@" + interaction.user.id + ">. Messages retained for staff review.",
    allowedMentions: { parse: [] }
  });
  await audit(interaction, config, "Ticket closed: <#" + ticket.channelId + "> by <@" + interaction.user.id + ">.");
  return interaction.editReply("Ticket closed. No messages were deleted.");
}

module.exports = { open, handle };
