"use strict";
const { EmbedBuilder, MessageFlags } = require("discord.js");
const { authorized } = require("./policy");

function panel(title, description, color = 0x416b51) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}
async function replyPrivate(interaction, payload) {
  const body = typeof payload === "string" ? { content: payload } : payload;
  if (interaction.deferred || interaction.replied) return interaction.editReply(body);
  return interaction.reply({ ...body, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
async function requireStaff(interaction, config, minimum = "helper") {
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!authorized(actor, interaction.guild, config, minimum)) {
    await replyPrivate(interaction, "This command requires a RayCraft " + (minimum === "moderator" ? "moderator" : "staff") + " role.");
    return null;
  }
  return actor;
}
async function audit(interaction, config, content) {
  if (!config.modLogChannelId) return;
  try {
    const channel = await interaction.guild.channels.fetch(config.modLogChannelId);
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [panel("RayCraft Staff Log", String(content).slice(0, 3900), 0x647681)],
        allowedMentions: { parse: [] }
      });
    }
  } catch (err) {
    console.error("Failed to deliver audit log:", err);
  }
}
module.exports = { panel, replyPrivate, requireStaff, audit };
