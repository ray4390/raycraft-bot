"use strict";
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { reminderText } = require("./policy");
const { reminderChoices } = require("./commands");
const { panel, requireStaff, audit } = require("./common");

const cooldown = new Map();
const row = (items) => new ActionRowBuilder().addComponents(items);

async function begin(interaction, config, messageId = "0") {
  if (!await requireStaff(interaction, config, "helper")) return;
  return interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [panel("RayCraft Rule Reminder", "Select a rule, review the message, then confirm. This is a friendly reminder, not an official warning.")],
    components: [row([
      new StringSelectMenuBuilder()
        .setCustomId(["rcselect", interaction.user.id, interaction.channelId, messageId].join(":"))
        .setPlaceholder("Choose a rule")
        .addOptions(reminderChoices())
    ])]
  });
}

async function component(interaction, config, store) {
  const [type, ownerId, channelId, messageId, ruleId] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId || interaction.channelId !== channelId) {
    return interaction.reply({ content: "This menu is not yours.", flags: MessageFlags.Ephemeral });
  }
  if (!await requireStaff(interaction, config, "helper")) return;

  if (type === "rcselect" && interaction.isStringSelectMenu()) {
    const selected = interaction.values[0];
    const preview = reminderText(selected, { rulesChannelId: config.rulesChannelId });
    return interaction.update({
      embeds: [panel("Preview: " + preview.title, preview.description)],
      components: [row([
        new ButtonBuilder().setCustomId(["rcpost", ownerId, channelId, messageId, selected].join(":"))
          .setLabel("Post reminder").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(["rccancel", ownerId, channelId].join(":"))
          .setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      ])]
    });
  }
  if (type === "rccancel" && interaction.isButton()) {
    return interaction.update({ content: "Reminder cancelled.", embeds: [], components: [] });
  }
  if (type !== "rcpost" || !interaction.isButton()) return;

  const key = ownerId + ":" + channelId;
  if ((cooldown.get(key) || 0) > Date.now() - 20000) {
    return interaction.update({ content: "Wait 20 seconds before sending another reminder in this channel.", embeds: [], components: [] });
  }
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.send) {
    return interaction.update({ content: "The original channel no longer exists.", embeds: [], components: [] });
  }
  const target = messageId === "0" ? null : await channel.messages.fetch(messageId).catch(() => null);
  if (messageId !== "0" && !target) {
    return interaction.update({ content: "The original message is no longer available.", embeds: [], components: [] });
  }

  const reminder = reminderText(ruleId, {
    mention: target ? "<@" + target.author.id + ">" : undefined,
    rulesChannelId: config.rulesChannelId
  });
  await interaction.deferUpdate();
  const payload = {
    embeds: [panel(reminder.title, reminder.description)],
    allowedMentions: target ? { parse: [], users: [target.author.id] } : { parse: [] }
  };
  if (target) await target.reply(payload);
  else await channel.send(payload);
  cooldown.set(key, Date.now());

  // Separate non-punitive history record, never a warning.
  const record = store.addCase(interaction.guildId, {
    type: "reminder", targetId: target?.author.id ?? null,
    actorId: ownerId, reason: ruleId, channelId,
    messageId: messageId === "0" ? null : messageId
  });
  await audit(interaction, config, "Non-punitive reminder #" + record.id + ": " + ruleId +
    " by <@" + ownerId + ">" + (record.targetId ? " to <@" + record.targetId + ">" : ""));
  return interaction.editReply({ content: "Reminder posted.", embeds: [], components: [] });
}

module.exports = { begin, component };
