"use strict";

const {
  ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle
} = require("discord.js");
const { authorized } = require("./policy");
const { replyPrivate } = require("./common");
const { isSuggestionThread, isSuggestionId, normalizePoll, canChangeStatus, TERMINAL } = require("./suggestionPolicy");

const NO_MENTIONS = { parse: [] };
const busy = new Set();
const NAMES = {
  submitted: "Submitted", reviewing: "Under Review", polling: "Community Poll",
  planned: "Planned", declined: "Declined", implemented: "Implemented"
};
const COLORS = {
  submitted: 0x6983a2, reviewing: 0xe0a34c, polling: 0x7189d9,
  planned: 0x4c96a2, declined: 0xb76666, implemented: 0x4c9b69
};

function records(store) {
  if (store.state.suggestions === undefined) store.state.suggestions = [];
  if (!Array.isArray(store.state.suggestions)) throw new Error("RayBot suggestion state is invalid; refusing to overwrite it.");
  return store.state.suggestions;
}

function byId(store, id) {
  return records(store).find((item) => item.threadId === id) || null;
}

function url(config, threadId) {
  return "https://discord.com/channels/" + config.guildId + "/" + threadId;
}

function queueEmbed(record, config) {
  const title = String(record.title || "Untitled proposal").slice(0, 170);
  const lines = [
    "**Status:** " + (NAMES[record.status] || record.status),
    "**Author:** <@" + record.authorId + ">",
    "**Proposal:** [Open forum discussion](" + url(config, record.threadId) + ")",
    "**Feedback:** Use the forum's configured reaction to show support. Reactions are advisory, not a binding vote."
  ];
  if (record.pollMessageId) {
    lines.push("**Formal poll:** https://discord.com/channels/" + config.guildId +
      "/" + config.suggestionPollsChannelId + "/" + record.pollMessageId);
  }
  if (record.decision) lines.push("**Decision:** " + String(record.decision).slice(0, 900));
  return new EmbedBuilder()
    .setTitle("RayCraft Suggestion · " + title)
    .setDescription(lines.join("\n"))
    .setColor(COLORS[record.status] || COLORS.submitted)
    .setFooter({ text: "Staff review • Discussion and reactions are not binding" })
    .setTimestamp(new Date(record.updatedAt || record.createdAt));
}

function buttons(record) {
  if (TERMINAL.has(record.status)) return [];
  const names = [
    ["review", "Review", ButtonStyle.Primary],
    ["plan", "Plan", ButtonStyle.Success],
    ["decline", "Decline", ButtonStyle.Danger],
    ["done", "Implemented", ButtonStyle.Success],
    ["poll", "Create Poll", ButtonStyle.Secondary]
  ];
  return [new ActionRowBuilder().addComponents(names.map(([action, name, style]) =>
    new ButtonBuilder().setCustomId("rcs:" + action + ":" + record.threadId)
      .setLabel(name).setStyle(style)
      .setDisabled((action === "poll" && Boolean(record.pollMessageId)) ||
        (action === "review" && record.status === "reviewing") ||
        (action === "plan" && record.status === "planned"))
  ))];
}

async function channels(client, config) {
  const guild = await client.guilds.fetch(config.guildId);
  const [forum, queue] = await Promise.all([
    guild.channels.fetch(config.suggestionForumId),
    guild.channels.fetch(config.suggestionReviewChannelId)
  ]);
  if (forum?.type !== ChannelType.GuildForum ||
      queue?.type !== ChannelType.GuildText) {
    throw new Error("Suggestion forum or private review channel has the wrong Discord channel type.");
  }
  // Never leak staff review cards to a public channel, even after a config mistake.
  if (queue.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error("Suggestion processing channel is visible to @everyone; refusing to post private review cards.");
  }
  const me = await guild.members.fetchMe();
  const permissions = queue.permissionsFor(me);
  const required = [
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks
  ];
  if (required.some((permission) => !permissions?.has(permission))) {
    throw new Error("RayBot needs View, Send, Read History and Embed Links in the suggestion-processing channel.");
  }
  return { guild, forum, queue };
}

async function verify(client, config) {
  const { guild, forum, queue } = await channels(client, config);
  if (forum.guildId !== guild.id || queue.guildId !== guild.id) {
    throw new Error("Suggestion channels must belong to the RayCraft guild.");
  }
  console.log("RayBot suggestions configured: forum " + forum.id + ", staff queue " + queue.id);
}

async function publishQueue(queue, record, config, store) {
  let message = record.queueMessageId ?
    await queue.messages.fetch(record.queueMessageId).catch(() => null) : null;
  const payload = { embeds: [queueEmbed(record, config)], components: buttons(record), allowedMentions: NO_MENTIONS };
  message = message ? await message.edit(payload) : await queue.send(payload);
  if (record.queueMessageId !== message.id) {
    record.queueMessageId = message.id;
    store.save();
  }
  return message;
}

async function intake(thread, client, config, store) {
  if (!isSuggestionThread(thread, config.guildId, config.suggestionForumId)) return null;
  if (busy.has(thread.id)) return null;
  busy.add(thread.id);
  try {
    const { queue } = await channels(client, config);
    let record = byId(store, thread.id);
    if (!record) {
      // The starter post can take a moment to become readable after THREAD_CREATE.
      let starter = await thread.fetchStarterMessage().catch(() => null);
      if (!starter) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        starter = await thread.fetchStarterMessage().catch(() => null);
      }
      const authorId = starter?.author?.id || thread.ownerId;
      if (!isSuggestionId(authorId)) throw new Error("Cannot determine forum post author; retry with /suggestsync.");
      record = {
        threadId: thread.id, guildId: config.guildId, authorId,
        title: String(thread.name).slice(0, 160), status: "submitted",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        queueMessageId: null, pollMessageId: null, decision: null
      };
      records(store).push(record);
      store.save();
    }
    await publishQueue(queue, record, config, store);
    return record;
  } finally {
    busy.delete(thread.id);
  }
}

async function command(interaction, client, config, store) {
  if (interaction.commandName === "suggest") {
    return replyPrivate(interaction, {
      embeds: [new EmbedBuilder().setColor(0x6485b5).setTitle("Suggest an improvement to RayCraft")
        .setDescription("Open <#" + config.suggestionForumId + "> and create a forum post. Explain what you want to change and why.\n\n" +
          "Members can use the forum's **default reaction** to support suggestions, or reply with constructive feedback. " +
          "Staff consider the discussion and may create a separate formal poll when needed. Reactions are advisory, not binding.")],
      allowedMentions: NO_MENTIONS
    });
  }
  if (interaction.commandName !== "suggestsync") return;
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!authorized(actor, interaction.guild, config, "moderator")) {
    return replyPrivate(interaction, "Only moderators can synchronize suggestion review cards.");
  }
  const threadId = interaction.options.getString("post", true).trim();
  if (!isSuggestionId(threadId)) return replyPrivate(interaction, "Enter the forum post's numeric channel ID.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
  if (!isSuggestionThread(thread, config.guildId, config.suggestionForumId)) {
    return interaction.editReply("That ID is not a thread in the RayCraft suggestions forum.");
  }
  const record = await intake(thread, client, config, store);
  return interaction.editReply(record ? "Suggestion review card synchronized: " + url(config, thread.id) :
    "That suggestion is already being processed. Please retry in a moment.");
}

function reasonModal(id) {
  return new ModalBuilder().setCustomId("rcs:declineform:" + id).setTitle("Decline suggestion")
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("Reason visible to the community")
        .setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(900).setRequired(true)
    ));
}

function pollModal(id, record) {
  return new ModalBuilder().setCustomId("rcs:pollform:" + id).setTitle("Create a community poll")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("question").setLabel("Poll question")
          .setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(true)
          .setValue(String(record.title).slice(0, 300))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("yes").setLabel("First option")
          .setStyle(TextInputStyle.Short).setMaxLength(55).setRequired(true)
          .setValue("Yes, make this change")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("no").setLabel("Second option")
          .setStyle(TextInputStyle.Short).setMaxLength(55).setRequired(true)
          .setValue("No, keep the current approach")
      )
    );
}

async function announce(interaction, config, record, text) {
  try {
    const thread = await interaction.guild.channels.fetch(record.threadId);
    if (thread && isSuggestionThread(thread, config.guildId, config.suggestionForumId)) {
      await thread.send({
        embeds: [new EmbedBuilder().setColor(COLORS[record.status]).setTitle("Suggestion update · " + NAMES[record.status])
          .setDescription(text).setFooter({ text: "RayCraft staff decision • Feedback remains welcome" })],
        allowedMentions: NO_MENTIONS
      });
    }
  } catch (error) {
    console.warn("Suggestion update could not be posted to forum:", error.message);
  }
}

async function changeStatus(interaction, client, config, store, record, status, decision) {
  if (!canChangeStatus(record.status, status)) return interaction.editReply("This suggestion cannot be changed to that status.");
  record.status = status;
  record.decision = decision || null;
  record.updatedAt = new Date().toISOString();
  record.decidedBy = interaction.user.id;
  store.save();
  const { queue } = await channels(client, config);
  await publishQueue(queue, record, config, store);
  const line = (status === "reviewing" ? "Staff are reviewing this proposal." :
    status === "planned" ? "This suggestion has been accepted for future consideration or implementation." :
    status === "implemented" ? "This suggestion has been implemented." :
    "This suggestion will not be adopted at this time.");
  await announce(interaction, config, record, line + (decision ? "\n\n**Reason:** " + decision : ""));
  return interaction.editReply("Marked **" + NAMES[status] + "**. " + url(config, record.threadId));
}

async function publishPoll(interaction, client, config, store, record) {
  if (record.pollMessageId || TERMINAL.has(record.status)) {
    return interaction.editReply("This suggestion has already been polled or closed.");
  }
  const poll = normalizePoll(
    interaction.fields.getTextInputValue("question"),
    interaction.fields.getTextInputValue("yes"),
    interaction.fields.getTextInputValue("no")
  );
  const channel = await interaction.guild.channels.fetch(config.suggestionPollsChannelId);
  if (channel?.type !== ChannelType.GuildText) {
    return interaction.editReply("The configured polls channel must be a text channel.");
  }
  const me = await interaction.guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendPolls) ||
      !channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel)) {
    return interaction.editReply("RayBot needs View Channel and Send Polls in <#" + channel.id + ">.");
  }
  const message = await channel.send({
    content: "**RayCraft Community Poll**\nRelated suggestion: " + url(config, record.threadId) +
      "\nThis poll informs staff decisions; it does not automatically change server rules.",
    poll: {
      question: { text: poll.question },
      answers: [{ text: poll.yes }, { text: poll.no }],
      duration: poll.duration,
      allowMultiselect: false
    },
    allowedMentions: NO_MENTIONS
  });
  record.pollMessageId = message.id;
  record.status = "polling";
  record.updatedAt = new Date().toISOString();
  record.decidedBy = interaction.user.id;
  store.save();
  const { queue } = await channels(client, config);
  await publishQueue(queue, record, config, store);
  const pollLink = "https://discord.com/channels/" + config.guildId + "/" + channel.id + "/" + message.id;
  await announce(interaction, config, record, "Staff opened a **seven-day community poll**: " + pollLink +
    "\n\nThe poll is advisory; a moderator will publish the final decision.");
  return interaction.editReply("Poll published: " + pollLink);
}

async function component(interaction, client, config, store) {
  if (!interaction.customId?.startsWith("rcs:") ||
      (!interaction.isButton() && !interaction.isModalSubmit())) return;
  const [, action, id] = interaction.customId.split(":");
  if (!isSuggestionId(id) || interaction.channelId !== config.suggestionReviewChannelId) {
    return replyPrivate(interaction, "Suggestion staff controls work only in the private processing channel.");
  }
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!authorized(actor, interaction.guild, config, "moderator")) {
    return replyPrivate(interaction, "Only moderators can decide or formally poll suggestions.");
  }
  const record = byId(store, id);
  if (!record) return replyPrivate(interaction, "Suggestion record not found.");
  if (interaction.isButton() && record.queueMessageId !== interaction.message.id) {
    return replyPrivate(interaction, "That review card is outdated. Use the current processing card.");
  }
  if (TERMINAL.has(record.status)) return replyPrivate(interaction, "This suggestion has already been closed.");
  if (interaction.isButton()) {
    if (action === "decline") return interaction.showModal(reasonModal(id));
    if (action === "poll") {
      if (record.pollMessageId) return replyPrivate(interaction, "A poll was already created for this suggestion.");
      return interaction.showModal(pollModal(id, record));
    }
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (busy.has(id)) return interaction.editReply("Another action is processing this suggestion.");
  busy.add(id);
  try {
    if (interaction.isModalSubmit() && action === "declineform") {
      const reason = interaction.fields.getTextInputValue("reason").trim();
      if (reason.length < 10) return interaction.editReply("Please include a meaningful decision reason.");
      return await changeStatus(interaction, client, config, store, record, "declined", reason);
    }
    if (interaction.isModalSubmit() && action === "pollform") {
      return await publishPoll(interaction, client, config, store, record);
    }
    const next = { review: "reviewing", plan: "planned", done: "implemented" }[action];
    if (!next) return interaction.editReply("Unknown suggestion action.");
    return await changeStatus(interaction, client, config, store, record, next);
  } finally {
    busy.delete(id);
  }
}

module.exports = { verify, intake, command, component };
