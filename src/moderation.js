"use strict";
const { PermissionFlagsBits, MessageFlags } = require("discord.js");
const { canModerate } = require("./policy");
const { panel, replyPrivate, requireStaff, audit } = require("./common");

async function execute(interaction, config, store) {
  const name = interaction.commandName;
  const actor = await requireStaff(interaction, config, "moderator");
  if (!actor) return;

  if (name === "purge") {
    const count = interaction.options.getInteger("count", true);
    if (!interaction.channel.bulkDelete) return replyPrivate(interaction, "Bulk deletion is unavailable here.");
    const bot = await interaction.guild.members.fetchMe();
    if (!bot.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageMessages)) {
      return replyPrivate(interaction, "RayCraft Bot needs Manage Messages in this channel.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const deleted = await interaction.channel.bulkDelete(count, true);
    await audit(interaction, config, "Purged " + deleted.size + " messages from <#" + interaction.channelId + "> by <@" + actor.id + ">.");
    return interaction.editReply("Deleted " + deleted.size + " messages. Discord does not bulk-delete messages older than 14 days.");
  }

  const user = interaction.options.getUser("user", true);
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!canModerate(actor, target, interaction.guild, config)) {
    return replyPrivate(interaction, "This member cannot be moderated by you (role hierarchy, owner, self, or unavailable).");
  }
  const reason = interaction.options.getString("reason", true).trim();
  if (!reason) return replyPrivate(interaction, "Specify a reason.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (name === "timeout") {
    if (!target.moderatable) return interaction.editReply("The bot's role is not high enough to timeout this member.");
    await target.timeout(interaction.options.getInteger("minutes", true) * 60000, reason);
  } else if (name === "kick") {
    if (!target.kickable) return interaction.editReply("The bot's role is not high enough to kick this member.");
    await target.kick(reason);
  } else if (name === "ban") {
    if (!target.bannable) return interaction.editReply("The bot's role is not high enough to ban this member.");
    await target.ban({ reason, deleteMessageSeconds: 0 });
  }

  const record = store.addCase(interaction.guildId, {
    type: name, targetId: user.id, actorId: actor.id, reason,
    ...(name === "timeout" ? { minutes: interaction.options.getInteger("minutes", true) } : {})
  });
  if (name === "warn") {
    await user.send({
      embeds: [panel("Official RayCraft Warning", reason + "\nCase #" + record.id, 0xd39e43)],
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }
  await audit(interaction, config, "Case #" + record.id + ": " + name +
    " | <@" + user.id + "> | by <@" + actor.id + ">\n" + reason);
  return interaction.editReply("Recorded " + name + " for " + user.username + " (case #" + record.id + ").");
}

async function history(interaction, config, store) {
  if (!await requireStaff(interaction, config)) return;
  const user = interaction.options.getUser("user", true);
  const records = store.history(interaction.guildId, user.id);
  const description = records.length
    ? records.map((item) => "#" + item.id + " [" + item.type + "] " +
      item.timestamp.slice(0, 10) + " — " + String(item.reason).slice(0, 200)).join("\n").slice(0, 3900)
    : "No staff records.";
  return replyPrivate(interaction, { embeds: [panel("History: " + user.username, description)] });
}

async function incident(interaction, config, store) {
  if (!await requireStaff(interaction, config)) return;
  const user = interaction.options.getUser("user", true);
  const note = interaction.options.getString("note", true);
  const record = store.addCase(interaction.guildId, {
    type: "incident", targetId: user.id, actorId: interaction.user.id, reason: note
  });
  await audit(interaction, config, "Staff incident #" + record.id + " recorded for <@" + user.id + "> by <@" + interaction.user.id + ">.");
  return replyPrivate(interaction, "Private incident #" + record.id + " saved. This is not an official warning.");
}

module.exports = { execute, history, incident };
