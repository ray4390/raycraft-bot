"use strict";

const {
  ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle
} = require("discord.js");
const { authorized } = require("./policy");
const { replyPrivate } = require("./common");
const {
  isSuggestionThread, isSuggestionId, normalizeSuggestion, normalizePoll,
  canChangeStatus, safeText, CATEGORIES, FORUM_STATUSES, TERMINAL
} = require("./suggestionPolicy");

const NO_MENTIONS = { parse: [] };
const processing = new Set();
const STATUS_LABELS = {
  pending: "Awaiting Approval", rejected: "Rejected", open: "Open for Discussion",
  reviewing: "Under Review", polling: "Poll Open", planned: "Planned",
  declined: "Declined", implemented: "Implemented"
};
const STATUS_TAG = {
  open: "Open", reviewing: "Under Review", polling: "Poll Open",
  planned: "Planned", declined: "Declined", implemented: "Implemented"
};
const STATUS_COLOR = {
  pending: 0xe0ad53, rejected: 0xa95f65, open: 0x6a93c2,
  reviewing: 0xe0ad53, polling: 0x9380ce, planned: 0x5695a7,
  declined: 0xa95f65, implemented: 0x57a078
};

function records(store) {
  store.state.suggestions ??= [];
  if (!Array.isArray(store.state.suggestions)) throw new Error("Suggestion records are invalid.");
  return store.state.suggestions;
}
function get(store, number) {
  return records(store).find(r => String(r.number) === String(number)) || null;
}
function byThread(store, id) {
  return records(store).find(r => r.threadId === id) || null;
}
function guildLink(config, channelId, messageId) {
  return "https://discord.com/channels/" + config.guildId + "/" + channelId + (messageId ? "/" + messageId : "");
}
function fmt(record) {
  return "**Proposal**\n" + safeText(record.proposal) + "\n\n**Why this would help**\n" + safeText(record.reason);
}
function authorName(record) {
  return String(record.authorName || "RayCraft member").slice(0, 80);
}
function reviewEmbed(record, config) {
  const lines = [
    "**Status:** " + STATUS_LABELS[record.status],
    "**Category:** " + record.category,
    "**Submitted by:** <@" + record.authorId + ">",
    "",
    fmt(record)
  ];
  if (record.threadId) lines.push("\n**Forum:** " + guildLink(config, record.threadId));
  if (record.pollMessageId) lines.push("**Poll:** " + guildLink(config, config.suggestionPollsChannelId, record.pollMessageId));
  if (record.decision) lines.push("**Staff explanation:** " + safeText(record.decision));
  return new EmbedBuilder()
    .setColor(STATUS_COLOR[record.status])
    .setAuthor({ name: authorName(record), iconURL: record.avatarURL || undefined })
    .setTitle("Suggestion #" + record.number + " · " + record.title)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: "RayCraft • Moderator approval required before publication" })
    .setTimestamp(new Date(record.createdAt));
}
function reviewButtons(record) {
  if (TERMINAL.has(record.status)) return [];
  const controls = record.status === "pending" ? [
    ["approve", "Approve & Publish", ButtonStyle.Success],
    ["reject", "Reject", ButtonStyle.Danger]
  ] : [
    ["review", "Review", ButtonStyle.Primary],
    ["plan", "Plan", ButtonStyle.Success],
    ["decline", "Decline", ButtonStyle.Danger],
    ["done", "Implemented", ButtonStyle.Success],
    ["poll", "Create Poll", ButtonStyle.Secondary]
  ];
  return [new ActionRowBuilder().addComponents(controls.map(([key, label, style]) =>
    new ButtonBuilder().setCustomId("rcs:" + key + ":" + record.number)
      .setLabel(label).setStyle(style)
      .setDisabled((key === "poll" && Boolean(record.pollMessageId)) ||
        (key === "review" && record.status === "reviewing") ||
        (key === "plan" && record.status === "planned"))
  ))];
}
async function reviewChannels(client, config) {
  const guild = await client.guilds.fetch(config.guildId);
  const [forum, queue] = await Promise.all([
    guild.channels.fetch(config.suggestionForumId), guild.channels.fetch(config.suggestionReviewChannelId)
  ]);
  if (forum?.type !== ChannelType.GuildForum || queue?.type !== ChannelType.GuildText ||
      forum.guildId !== guild.id || queue.guildId !== guild.id) {
    throw new Error("Suggestion forum or review queue is unavailable or of the wrong type.");
  }
  if (queue.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error("Suggestion-processing channel must be hidden from @everyone.");
  }
  await guild.roles.fetch();
  for (const id of config.moderatorRoles) {
    const role = guild.roles.cache.get(id);
    if (!role || !queue.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error("Moderator role cannot see suggestion-processing channel: " + id);
    }
  }
  const me = await guild.members.fetchMe();
  const perms = queue.permissionsFor(me);
  if ([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks]
    .some(p => !perms?.has(p))) throw new Error("RayBot lacks review queue permissions.");
  return { guild, forum, queue, me };
}

// Never remove or rename tags created manually. The bot only adds missing built-in tags.
async function ensureTags(forum, me) {
  const wanted = [...CATEGORIES, ...FORUM_STATUSES];
  const existing = forum.availableTags || [];
  const missing = wanted.filter(n => !existing.some(t => t.name.toLowerCase() === n.toLowerCase()));
  if (!missing.length) return existing;
  if (!forum.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("RayBot needs Manage Channels in #suggestions to create its missing tags: " + missing.join(", "));
  }
  if (existing.length + missing.length > 20) {
    throw new Error("Not enough Discord forum tag slots; existing tags were preserved. Missing: " + missing.join(", "));
  }
  await forum.setAvailableTags(
    [...existing.map(t => ({ id: t.id, name: t.name, moderated: t.moderated, emoji: t.emoji || undefined })),
      ...missing.map(name => ({ name, moderated: false }))],
    "RayBot suggestion categories and status tags"
  );
  await forum.fetch();
  return forum.availableTags;
}
function appliedTags(forum, record) {
  const names = [record.category, STATUS_TAG[record.status] || "Open"];
  return names.map(n => forum.availableTags.find(t => t.name.toLowerCase() === n.toLowerCase())?.id).filter(Boolean);
}
async function updateTags(thread, forum, record) {
  if (!thread?.setAppliedTags) return;
  const categoryAndStatusIds = new Set([...CATEGORIES, ...FORUM_STATUSES]
    .map(n => forum.availableTags.find(t => t.name.toLowerCase() === n.toLowerCase())?.id)
    .filter(Boolean));
  // Preserve unrelated manually assigned tags and replace only RayBot-managed tags.
  const preserved = (thread.appliedTags || []).filter(id => !categoryAndStatusIds.has(id));
  const tags = [...new Set([...preserved, ...appliedTags(forum, record)])].slice(0, 5);
  await thread.setAppliedTags(tags, "RayBot suggestion status changed");
}
async function ensureForumPostingPolicy(forum, guild, me) {
  // A public forum needs to be read/replied to, but regular members should not
  // bypass moderator approval by creating posts themselves.
  if (!forum.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
    console.warn("RayBot suggestions: cannot enforce create-post restriction without Manage Channels.");
    return;
  }
  const overwrite = forum.permissionOverwrites.cache.get(guild.roles.everyone.id);
  if (overwrite?.deny?.has(PermissionFlagsBits.SendMessages)) return;
  await forum.permissionOverwrites.edit(guild.roles.everyone, {
    SendMessages: false,
    SendMessagesInThreads: true,
    AddReactions: true
  }, { reason: "Suggestions must be submitted by /suggest for moderator approval" });
}
async function verify(client, config) {
  const { guild, forum, me } = await reviewChannels(client, config);
  await ensureTags(forum, me);
  await ensureForumPostingPolicy(forum, guild, me);
  console.log("RayBot suggestions configured: forum " + forum.id + ", staff queue " + config.suggestionReviewChannelId);
}
async function publishReview(queue, record, config, store) {
  let msg = record.queueMessageId ? await queue.messages.fetch(record.queueMessageId).catch(() => null) : null;
  const data = { embeds: [reviewEmbed(record, config)], components: reviewButtons(record), allowedMentions: NO_MENTIONS };
  msg = msg ? await msg.edit(data) : await queue.send(data);
  if (record.queueMessageId !== msg.id) {
    record.queueMessageId = msg.id;
    store.save();
  }
  return msg;
}
async function notify(client, record, message) {
  try {
    const user = await client.users.fetch(record.authorId);
    await user.send({ content: message, allowedMentions: NO_MENTIONS });
  } catch (error) {
    console.warn("Could not DM suggestion #" + record.number + " submitter: " + error.message);
  }
}
function proposalModal(category) {
  const slug = CATEGORIES.indexOf(category);
  return new ModalBuilder().setCustomId("rcs:submit:" + slug)
    .setTitle("Submit a RayCraft suggestion")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("title").setLabel("Short title")
          .setPlaceholder("What would you like to change?")
          .setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(100).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("proposal").setLabel("Describe your suggestion")
          .setPlaceholder("What should be added, changed, or removed?")
          .setStyle(TextInputStyle.Paragraph).setMinLength(15).setMaxLength(1900).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel("Why would this improve RayCraft?")
          .setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(900).setRequired(true)
      )
    );
}
async function command(interaction, client, config, store) {
  if (interaction.commandName === "suggest") {
    const category = interaction.options.getString("category") || CATEGORIES[0];
    return interaction.showModal(proposalModal(category));
  }
  if (interaction.commandName !== "suggestsync") return;
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!authorized(actor, interaction.guild, config, "moderator")) {
    return replyPrivate(interaction, "Only moderators can synchronize review cards.");
  }
  const id = interaction.options.getInteger("number", true);
  const record = get(store, id);
  if (!record) return replyPrivate(interaction, "Suggestion #" + id + " does not exist.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { queue } = await reviewChannels(client, config);
  await publishReview(queue, record, config, store);
  return interaction.editReply("Review card synchronized for suggestion #" + id +
    (record.threadId ? ": " + guildLink(config, record.threadId) : "."));
}
async function submission(interaction, client, config, store) {
  const [, , categoryIndex] = interaction.customId.split(":");
  const category = CATEGORIES[Number(categoryIndex)];
  if (!category) return replyPrivate(interaction, "Invalid category. Please retry /suggest.");
  let values;
  try {
    values = normalizeSuggestion(
      interaction.fields.getTextInputValue("title"),
      interaction.fields.getTextInputValue("proposal"),
      interaction.fields.getTextInputValue("reason"), category
    );
  } catch (error) {
    return replyPrivate(interaction, error.message);
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const key = "new:" + interaction.user.id;
  if (processing.has(key)) return interaction.editReply("Your suggestion is already being submitted.");
  processing.add(key);
  try {
    const pending = records(store).find(r => r.guildId === config.guildId &&
      r.authorId === interaction.user.id && r.status === "pending");
    if (pending) return interaction.editReply("You already have suggestion #" + pending.number +
      " awaiting approval. Please wait for a moderator to review it.");
    const { queue } = await reviewChannels(client, config);
    const counterKey = "suggestion:" + config.guildId;
    const number = (store.state.counters[counterKey] || 0) + 1;
    store.state.counters[counterKey] = number;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const record = {
      number, guildId: config.guildId, authorId: interaction.user.id,
      authorName: member?.displayName || interaction.user.globalName || interaction.user.username,
      avatarURL: member?.displayAvatarURL({ extension: "png", size: 128 }) ||
        interaction.user.displayAvatarURL({ extension: "png", size: 128 }),
      ...values, status: "pending", threadId: null, queueMessageId: null,
      pollMessageId: null, decision: null, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    records(store).push(record);
    store.save();
    try {
      await publishReview(queue, record, config, store);
    } catch (error) {
      console.error("Suggestion queue publish failed:", error);
      return interaction.editReply("Suggestion #" + number + " saved, but its review card could not be posted. " +
        "Staff can recover it with /suggestsync.");
    }
    return interaction.editReply("**Suggestion #" + number + " submitted for approval.** " +
      "Moderators will review it privately before it appears in <#" + config.suggestionForumId +
      ">. You'll receive a DM when it's approved or declined, if your DMs are open.");
  } finally {
    processing.delete(key);
  }
}
function textModal(action, record) {
  const label = action === "reject" ? "Reason for rejection" : "Reason for declining";
  return new ModalBuilder().setCustomId("rcs:" + action + "form:" + record.number)
    .setTitle(action === "reject" ? "Reject pending suggestion" : "Decline published suggestion")
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel(label)
        .setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(900).setRequired(true)
    ));
}
function pollModal(record) {
  return new ModalBuilder().setCustomId("rcs:pollform:" + record.number).setTitle("Create community poll")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("question").setLabel("Poll question")
          .setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(true)
          .setValue(record.title.slice(0, 300))),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("yes").setLabel("First answer")
          .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(55).setRequired(true)
          .setValue("Yes, make this change")),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("no").setLabel("Second answer")
          .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(55).setRequired(true)
          .setValue("No, keep the current approach"))
    );
}
async function createPublicPost(interaction, client, config, record) {
  const { forum, me } = await reviewChannels(client, config);
  await ensureTags(forum, me);
  const tags = appliedTags(forum, { ...record, status: "open" });
  const content = fmt(record) + "\n\n— *Submitted by <@" + record.authorId +
    "> through RayBot · Approved for discussion by moderators*";
  let posted;
  let mode = "webhook";
  const perms = forum.permissionsFor(me);
  if (perms?.has(PermissionFlagsBits.ManageWebhooks)) {
    let hook = [...(await forum.fetchWebhooks()).values()].find(w =>
      w.name === "RayCraft Suggestions" && w.owner?.id === client.user.id && w.token);
    if (!hook) hook = await forum.createWebhook({
      name: "RayCraft Suggestions", reason: "Approved RayCraft player suggestions"
    });
    posted = await hook.send({
      threadName: record.title, appliedTags: tags, content,
      username: authorName(record), avatarURL: record.avatarURL || undefined,
      allowedMentions: NO_MENTIONS, wait: true
    });
  } else {
    mode = "bot";
    // Fallback when Manage Webhooks is unavailable: the author is still clearly
    // identified by display name/avatar in a normal RayBot-owned forum post.
    posted = await forum.threads.create({
      name: record.title, appliedTags: tags,
      message: {
        embeds: [new EmbedBuilder().setColor(0x668db4)
          .setAuthor({ name: authorName(record), iconURL: record.avatarURL || undefined })
          .setDescription(content.slice(0, 3900))
          .setFooter({ text: "Submitted through RayBot • Approved by moderators" })],
        allowedMentions: NO_MENTIONS
      },
      autoArchiveDuration: 10080,
      reason: "Approved suggestion #" + record.number
    });
  }
  const threadId = posted.channelId || posted.id;
  if (!isSuggestionId(threadId)) throw new Error("Forum publication succeeded but no valid post ID was returned.");
  return { threadId, mode };
}
async function publicNotice(interaction, config, record, description) {
  if (!record.threadId) return;
  try {
    const thread = await interaction.guild.channels.fetch(record.threadId);
    if (thread && isSuggestionThread(thread, config.guildId, config.suggestionForumId)) {
      await thread.send({
        embeds: [new EmbedBuilder().setColor(STATUS_COLOR[record.status])
          .setTitle("Suggestion update · " + STATUS_LABELS[record.status])
          .setDescription(description).setFooter({ text: "RayCraft moderation" })],
        allowedMentions: NO_MENTIONS
      });
    }
  } catch (error) {
    console.warn("Unable to announce suggestion status:", error.message);
  }
}
async function applyStatus(interaction, client, config, store, record, status, reason) {
  if (!canChangeStatus(record.status, status)) return interaction.editReply("That status transition is unavailable.");
  record.status = status;
  record.decision = reason || null;
  record.updatedAt = new Date().toISOString();
  record.decidedBy = interaction.user.id;
  store.save();
  const { forum, queue } = await reviewChannels(client, config);
  const thread = await interaction.guild.channels.fetch(record.threadId).catch(() => null);
  if (thread) await updateTags(thread, forum, record).catch(e =>
    console.warn("Unable to update suggestion tags:", e.message));
  await publishReview(queue, record, config, store);
  const desc = status === "reviewing" ? "Staff are reviewing this suggestion." :
    status === "planned" ? "This suggestion has been added to the planning list." :
    status === "implemented" ? "This suggestion has been implemented." :
    "This suggestion was considered but is not being adopted.";
  await publicNotice(interaction, config, record, desc + (reason ? "\n\n**Reason:** " + safeText(reason) : ""));
  return interaction.editReply("Suggestion #" + record.number + " marked **" +
    STATUS_LABELS[status] + "**. " + guildLink(config, record.threadId));
}
async function createPoll(interaction, client, config, store, record) {
  if (!record.threadId || record.pollMessageId || TERMINAL.has(record.status)) {
    return interaction.editReply("Only a published, unpolled suggestion can be sent to a poll.");
  }
  const poll = normalizePoll(
    interaction.fields.getTextInputValue("question"),
    interaction.fields.getTextInputValue("yes"),
    interaction.fields.getTextInputValue("no")
  );
  const polls = await interaction.guild.channels.fetch(config.suggestionPollsChannelId);
  const me = await interaction.guild.members.fetchMe();
  if (polls?.type !== ChannelType.GuildText ||
      !polls.permissionsFor(me)?.has(PermissionFlagsBits.SendPolls)) {
    return interaction.editReply("RayBot needs Send Polls permission in the configured polls channel.");
  }
  const msg = await polls.send({
    content: "**RayCraft Community Poll**\n" + guildLink(config, record.threadId) +
      "\n*Advisory poll; staff will publish the final decision.*",
    poll: { question: { text: poll.question },
      answers: [{ text: poll.yes }, { text: poll.no }],
      duration: poll.duration, allowMultiselect: false },
    allowedMentions: NO_MENTIONS
  });
  record.pollMessageId = msg.id;
  record.status = "polling";
  record.updatedAt = new Date().toISOString();
  store.save();
  const { forum, queue } = await reviewChannels(client, config);
  const thread = await interaction.guild.channels.fetch(record.threadId).catch(() => null);
  if (thread) await updateTags(thread, forum, record).catch(e =>
    console.warn("Unable to change poll tag:", e.message));
  await publishReview(queue, record, config, store);
  const link = guildLink(config, polls.id, msg.id);
  await publicNotice(interaction, config, record, "**Community poll:** " + link + "\nThe poll lasts seven days.");
  return interaction.editReply("Community poll posted: " + link);
}
async function component(interaction, client, config, store) {
  if (interaction.isModalSubmit() && interaction.customId?.startsWith("rcs:submit:")) {
    return submission(interaction, client, config, store);
  }
  if (!interaction.customId?.startsWith("rcs:") ||
      (!interaction.isButton() && !interaction.isModalSubmit())) return;
  const [, action, value] = interaction.customId.split(":");
  if (interaction.channelId !== config.suggestionReviewChannelId ||
      !/^[1-9]\d{0,8}$/.test(value)) {
    return replyPrivate(interaction, "Suggestion decisions belong in the staff processing channel.");
  }
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!authorized(actor, interaction.guild, config, "moderator")) {
    return replyPrivate(interaction, "Only RayCraft moderators can approve or decide suggestions.");
  }
  const record = get(store, Number(value));
  if (!record || record.guildId !== config.guildId) {
    return replyPrivate(interaction, "Suggestion not found.");
  }
  if (interaction.isButton() && interaction.message.id !== record.queueMessageId) {
    return replyPrivate(interaction, "This review card is outdated.");
  }
  if (TERMINAL.has(record.status)) return replyPrivate(interaction, "This suggestion is already closed.");
  if (interaction.isButton()) {
    if (action === "reject" && record.status === "pending") return interaction.showModal(textModal("reject", record));
    if (action === "decline" && record.threadId) return interaction.showModal(textModal("decline", record));
    if (action === "poll" && record.threadId && !record.pollMessageId) return interaction.showModal(pollModal(record));
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lock = "decision:" + record.number;
  if (processing.has(lock)) return interaction.editReply("Another moderator is handling this suggestion.");
  processing.add(lock);
  try {
    const { queue } = await reviewChannels(client, config);
    if (action === "rejectform" && interaction.isModalSubmit()) {
      if (record.status !== "pending") return interaction.editReply("Already handled.");
      const reason = interaction.fields.getTextInputValue("reason").trim();
      if (reason.length < 10) return interaction.editReply("Provide a meaningful reason.");
      record.status = "rejected";
      record.decision = reason;
      record.decidedBy = interaction.user.id;
      record.updatedAt = new Date().toISOString();
      store.save();
      await publishReview(queue, record, config, store);
      await notify(client, record, "Your RayCraft suggestion #" + record.number +
        " was not approved for publication.\n\n**Reason:** " + safeText(reason));
      return interaction.editReply("Suggestion #" + record.number + " rejected privately.");
    }
    if (action === "approve" && interaction.isButton()) {
      if (record.status !== "pending") return interaction.editReply("Already handled.");
      // Once a remote forum post exists, do not make it again on retry.
      let post = { threadId: record.threadId, mode: "existing" };
      if (!record.threadId) post = await createPublicPost(interaction, client, config, record);
      record.threadId = post.threadId;
      record.status = "open";
      record.decidedBy = interaction.user.id;
      record.updatedAt = new Date().toISOString();
      store.save();
      await publishReview(queue, record, config, store);
      await notify(client, record, "Your RayCraft suggestion #" + record.number +
        " was approved and posted for discussion: " + guildLink(config, post.threadId));
      return interaction.editReply("Suggestion published **as " + authorName(record) +
        "** (" + post.mode + "): " + guildLink(config, post.threadId));
    }
    if (action === "pollform" && interaction.isModalSubmit()) {
      return createPoll(interaction, client, config, store, record);
    }
    if (action === "declineform" && interaction.isModalSubmit()) {
      if (!record.threadId) return interaction.editReply("This suggestion has not been published.");
      const reason = interaction.fields.getTextInputValue("reason").trim();
      if (reason.length < 10) return interaction.editReply("Provide a meaningful reason.");
      return applyStatus(interaction, client, config, store, record, "declined", reason);
    }
    const status = { review: "reviewing", plan: "planned", done: "implemented" }[action];
    if (status && record.threadId) return applyStatus(interaction, client, config, store, record, status);
    return interaction.editReply("This action is unavailable for the suggestion's current status.");
  } finally {
    processing.delete(lock);
  }
}
module.exports = { verify, command, component, ensureTags, reviewButtons };
