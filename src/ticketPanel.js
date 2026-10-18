"use strict";

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ChannelType, PermissionFlagsBits, MessageFlags
} = require("discord.js");
const { forumFor } = require("./tickets");

const OPEN_BUTTON_ID = "rct:open";
const locks = new Map();

function payload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x518663)
        .setTitle("📨  RayCraft Support & Tickets")
        .setDescription(
          "Need a hand? Want to report griefing or theft, appeal an action, or contact RayCraft staff?\n\n" +
          "**Press Open a Ticket below** to start a private conversation with the staff team.\n" +
          "RayBot will DM you a category menu and ask you to describe what you need. " +
          "Our staff respond through the bot's private modmail system."
        )
        .addFields(
          { name: "🧭 Player Help", value: "Questions about playing, rules, or the community.", inline: true },
          { name: "🛡️ Player Reports", value: "Griefing, stealing, cheating, or other rule concerns.", inline: true },
          { name: "📋 Appeals", value: "Request a review of a moderation decision.", inline: true },
          { name: "🛠️ Technical Support", value: "Connection, cross-play, or game issues.", inline: true }
        )
        .addFields({
          name: "Before opening a ticket",
          value: "Allow DMs from RayBot. For reports, include any relevant names, times, locations, or message links. " +
            "Please do not share passwords or account secrets."
        })
        .setFooter({ text: "RayCraft • Friendly survival community • Tickets go to staff, not this channel" })
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(OPEN_BUTTON_ID)
          .setLabel("Open a Ticket").setEmoji("📨").setStyle(ButtonStyle.Primary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function belongsToBot(message, botId) {
  return message?.author?.id === botId &&
    message.components?.some(row => row.components?.some(button => button.customId === OPEN_BUTTON_ID));
}

async function publish(client, config, store) {
  await forumFor(client, config);
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.ticketPanelChannelId);
  if (!channel || channel.guildId !== config.guildId ||
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    throw new Error("Ticket panel channel must be a text or announcement channel in the RayCraft Discord.");
  }
  const bot = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(bot);
  for (const permission of [
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks
  ]) {
    if (!permissions?.has(permission)) {
      throw new Error("RayBot lacks permissions needed to publish or update the ticket panel.");
    }
  }
  const storedId = store.panelMessageId(channel.id);
  let old = storedId ? await channel.messages.fetch(storedId).catch(() => null) : null;
  if (!belongsToBot(old, client.user.id)) old = null;
  if (!old) {
    const recent = await channel.messages.fetch({ limit: 100 });
    old = recent.find(message => belongsToBot(message, client.user.id)) || null;
  }
  const published = old ? await old.edit(payload()) : await channel.send(payload());
  if (storedId !== published.id) store.setPanelMessage(channel.id, published.id);
  return { channelId: channel.id, messageId: published.id, created: !old };
}

async function ensure(client, config, store) {
  const key = config.ticketPanelChannelId;
  if (!key) throw new Error("TICKET_PANEL_CHANNEL_ID is missing.");
  if (locks.has(key)) return locks.get(key);
  const work = publish(client, config, store);
  locks.set(key, work);
  try {
    return await work;
  } finally {
    locks.delete(key);
  }
}

async function command(interaction, client, config, store) {
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (actor.id !== interaction.guild.ownerId && !actor.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "Only Discord administrators can publish RayCraft's ticket panel.",
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await ensure(client, config, store);
    const verb = result.created ? "Posted" : "Refreshed";
    return interaction.editReply(verb + " the ticket panel: https://discord.com/channels/" +
      config.guildId + "/" + result.channelId + "/" + result.messageId);
  } catch (error) {
    console.error("Ticket panel publish failed:", error);
    return interaction.editReply("Ticket panel could not be published. Check RayBot's channel permissions and private staff forum settings in PM2 logs.");
  }
}

module.exports = { ensure, command };
