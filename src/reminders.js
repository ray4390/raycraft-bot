"use strict";

const { randomBytes } = require("node:crypto");
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  TextDisplayBuilder, SeparatorBuilder, MessageFlags
} = require("discord.js");
const { rules, getRule, authorized } = require("./policy");
const { replyPrivate, audit } = require("./common");

const sessions = new Map();
const cooldown = new Map();
const TTL_MS = 2 * 60 * 1000;
const COOLDOWN_MS = 20 * 1000;
const V2 = MessageFlags.IsComponentsV2;
const PRIVATE_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const NO_MENTIONS = { parse: [] };

const guidance = {
  respect: "Speak respectfully, even when you disagree. Avoid harassment, insults directed at other players, excessive toxicity, and deliberately ruining someone's experience.",
  griefing: "Leave other people's builds, containers, farms, items, and property alone unless you have permission. If you're unsure whether something belongs to someone, ask first.",
  cheating: "Play without hacked clients, X-ray, duplication glitches, or other unfair advantages. If you're unsure whether a mechanic is an exploit, ask staff before using it.",
  performance: "Avoid lag machines and oversized redstone or entity-heavy systems. If a build produces unreasonable server load, scale it back or ask staff for guidance.",
  farms: "Semi-automatic farms must require meaningful, active player involvement. For example, mobs may be funneled and damaged but the player must manually kill them. Don't use fully automatic or AFK resource, mob, or XP farms.",
  builds: "Use whatever architectural style you like, but integrate technical structures into the landscape or a proper building. Conceal giant floating platforms, exposed farms, and utilitarian boxes where practical.",
  space: "Leave reasonable space between major bases and projects. Don't crowd another player's build or interfere with their plans without permission.",
  "common-sense": "Consider server performance, fairness, other players, and the environment. If something could clearly cause problems, don't do it. Check with staff when unsure.",
  general: "Be respectful, don't grief or steal, avoid cheating and lag, keep farms active rather than AFK or fully automated, build considerately, give other players space, and use common sense."
};

function row(buttons) {
  return new ActionRowBuilder().addComponents(buttons);
}

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

function separator() {
  return new SeparatorBuilder().setDivider(true).setSpacing(1);
}

function feedback(message) {
  return new ContainerBuilder().setAccentColor([255, 255, 255])
    .addTextDisplayComponents(text(message));
}

function rulesURL(guildId, channelId) {
  return /^\d{15,22}$/.test(channelId || "")
    ? "https://discord.com/channels/" + guildId + "/" + channelId
    : null;
}

function messageURL(guildId, channelId, messageId) {
  return "https://discord.com/channels/" + guildId + "/" + channelId + "/" + messageId;
}

function activeRuleIdAt(session, index) {
  const n = Number(index);
  return Number.isInteger(n) && n >= 0 && n < session.ruleIds.length
    ? session.ruleIds[n] : null;
}

function ruleAtId(id) {
  const i = rules.findIndex(r => r.id === id);
  if (i < 0) return null;
  return { rule: rules[i], number: i + 1 };
}

function chooser(session, config) {
  const buttons = session.ruleIds.map((id, i) =>
    new ButtonBuilder().setCustomId("rcrm:pick:" + session.nonce + ":" + i)
      .setLabel("Rule " + (i + 1)).setStyle(ButtonStyle.Primary)
  );
  const list = session.ruleIds.map((id, i) => {
    const current = ruleAtId(id);
    return "**" + (i + 1) + ".** " + (current?.rule?.title || id);
  });
  const opening = [
    "### 📕  Rules Reminder",
    "This menu lets RayCraft staff send a specific rule reminder or a general reminder.",
    "",
    list.join("\n"),
    "",
    "-# Make sure the reminder fits the situation. It is not an official warning."
  ];
  const container = new ContainerBuilder().setAccentColor([255, 255, 255])
    .addTextDisplayComponents(text(opening.join("\n")))
    .addSeparatorComponents(separator());
  if (session.messageId) {
    const targetLink = messageURL(session.guildId, session.channelId, session.messageId);
    container.addTextDisplayComponents(text(
      "**Targeted User / Message:**\n<@" + session.targetId +
      "> — [Click to jump to message](" + targetLink + ")"
    )).addSeparatorComponents(separator());
  }
  for (let i = 0; i < buttons.length; i += 5) {
    container.addActionRowComponents(row(buttons.slice(i, i + 5)));
  }
  container.addActionRowComponents(row([
    new ButtonBuilder().setCustomId("rcrm:pick:" + session.nonce + ":general")
      .setLabel("General Reminder").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("rcrm:cancel:" + session.nonce)
      .setLabel("Cancel").setStyle(ButtonStyle.Danger)
  ]));
  const rulesLink = rulesURL(session.guildId, config.rulesChannelId);
  container.addTextDisplayComponents(text("-# The selection expires in 2 minutes. " +
    (rulesLink ? "[Read the full RayCraft rules](" + rulesLink + ")." : "Please refer to the published server rules.")));
  return container;
}

function reminderDisplay(ruleId, target, guildId, channelId, messageId, config) {
  const found = ruleId === "general" ? null : ruleAtId(ruleId);
  if (ruleId !== "general" && !found) throw new Error("Unknown RayCraft rule");
  const targeted = !!target;
  const heading = ruleId === "general" ? "General Rules Reminder" : "Rule " + found.number + " Reminder";
  const hello = targeted ? "Hey there, <@" + target.id + ">!" : "Hey there, everybody!";
  const description = ruleId === "general"
    ? "RayCraft is a friendly survival community, and that works best when everyone respects the rules and each other. " +
      "Please make sure you're following our community's expectations while playing and chatting."
    : targeted
      ? "One of your messages or the behavior it refers to may be heading toward a violation of Rule " +
        found.number + ". This isn't a warning, just a reminder to review the rule and make any necessary adjustments."
      : "A message, conversation, or activity involving this channel may be heading toward a violation of Rule " +
        found.number + ". This isn't a warning; it's a reminder of the rule and how to avoid problems.";

  const container = new ContainerBuilder().setAccentColor([255, 255, 255])
    .addTextDisplayComponents(text("### 📑  " + heading + "\n" + hello))
    .addTextDisplayComponents(text(description));

  if (found) {
    container.addTextDisplayComponents(text(
      "> **Rule " + found.number + " - " + found.rule.title + "**\n" +
      found.rule.summary.split("\n").map(line => line ? "> " + line : ">").join("\n")
    ));
  } else {
    container.addTextDisplayComponents(text(
      "Please follow **all eight RayCraft rules**, including respecting others and their builds, " +
      "avoiding cheating and lag machines, keeping farms player-operated, and building considerately."
    ));
  }

  container.addTextDisplayComponents(text(
    "-# *This reminder was posted by RayCraft staff. It is not an official warning. " +
    "Take it in good faith; if you have questions, open a private ticket rather than arguing in public chats.*"
  ));
  container.addSeparatorComponents(separator());

  const buttons = [];
  if (targeted && messageId) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link)
      .setURL(messageURL(guildId, channelId, messageId))
      .setLabel("Flagged Message").setEmoji("📨"));
  }
  buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Secondary)
    .setCustomId("rcrm:info:" + ruleId).setLabel("Get More Info").setEmoji("ℹ️"));
  const url = rulesURL(guildId, config.rulesChannelId);
  if (url) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link)
    .setURL(url).setLabel("Rules & Info").setEmoji("📝"));
  container.addActionRowComponents(row(buttons));
  return { components: [container], flags: V2,
    allowedMentions: targeted ? { parse: [], users: [target.id] } : NO_MENTIONS };
}

function infoDisplay(ruleId, config, guildId) {
  const found = ruleId === "general" ? null : ruleAtId(ruleId);
  if (ruleId !== "general" && !found) return null;
  const title = found ? "Rule " + found.number + " - " + found.rule.title : "General Rules";
  const description = found ? found.rule.summary : "All eight RayCraft rules apply across the community.";
  const advice = guidance[ruleId] || guidance.general;
  const container = new ContainerBuilder().setAccentColor([255, 255, 255])
    .addTextDisplayComponents(text("### ❔  What does " + title + " mean?\n" + description))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text("### ✅  How can I follow this rule?\n" + advice))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      "-# Still have questions about how the rules apply? Open a ticket to speak with RayCraft staff privately."
    ));
  const buttons = [
    new ButtonBuilder().setCustomId("rct:open").setLabel("Open a Ticket")
      .setEmoji("📩").setStyle(ButtonStyle.Primary)
  ];
  const url = rulesURL(guildId, config.rulesChannelId);
  if (url) buttons.push(new ButtonBuilder().setURL(url).setStyle(ButtonStyle.Link)
    .setEmoji("📝").setLabel("Full Rules"));
  container.addActionRowComponents(row(buttons));
  return { components: [container], flags: PRIVATE_V2, allowedMentions: NO_MENTIONS };
}

async function begin(interaction, config, messageId = "0") {
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!authorized(actor, interaction.guild, config, "helper")) {
    return replyPrivate(interaction, "This action requires a RayCraft staff role.");
  }
  const chosen = interaction.isMessageContextMenuCommand() ?
    interaction.targetMessage : null;
  const targetId = chosen?.author?.id || null;
  const selectedId = messageId && messageId !== "0" ? messageId : null;
  if (selectedId && !targetId) {
    return replyPrivate(interaction, "That message is unavailable. Try the message action again.");
  }

  // Expire old menus; each menu is bound to its creator and channel.
  for (const [nonce, item] of sessions) {
    if (Date.now() > item.expires) sessions.delete(nonce);
  }
  const nonce = randomBytes(6).toString("hex");
  const session = {
    nonce, actorId: actor.id, guildId: interaction.guildId, channelId: interaction.channelId,
    messageId: selectedId, targetId, ruleIds: rules.map(rule => rule.id),
    expires: Date.now() + TTL_MS, busy: false
  };
  sessions.set(nonce, session);
  try {
    return await interaction.reply({
      components: [chooser(session, config)],
      flags: PRIVATE_V2,
      allowedMentions: NO_MENTIONS
    });
  } catch (error) {
    sessions.delete(nonce);
    throw error;
  }
}

async function component(interaction, config, store) {
  if (!interaction.isButton()) return;
  const [, action, nonce, index] = interaction.customId.split(":");

  if (action === "info") {
    const info = infoDisplay(nonce, config, interaction.guildId);
    if (!info) return replyPrivate(interaction, "That rule is no longer available.");
    return interaction.reply(info);
  }
  const session = sessions.get(nonce);
  if (!session || Date.now() > session.expires) {
    sessions.delete(nonce);
    return interaction.reply({ content: "This reminder prompt expired. Run /rulereminder again.", flags: MessageFlags.Ephemeral });
  }
  if (session.actorId !== interaction.user.id ||
      session.guildId !== interaction.guildId ||
      session.channelId !== interaction.channelId) {
    return interaction.reply({ content: "This rule reminder menu belongs to another staff member.", flags: MessageFlags.Ephemeral });
  }
  // Immediately acknowledge the click, rather than waiting for history lookups and posting.
  await interaction.deferUpdate();
  if (session.busy) return;
  if (action === "cancel") {
    sessions.delete(nonce);
    return interaction.editReply({ components: [feedback("Prompt Cancelled.")] });
  }
  if (action !== "pick") return interaction.editReply({ components: [feedback("Unknown rule selection. Please run the command again.")] });

  const ruleId = index === "general" ? "general" : activeRuleIdAt(session, index);
  if (!ruleId || (ruleId !== "general" && !getRule(ruleId))) {
    return interaction.editReply({ components: [feedback("Rule no longer available. Please run the command again.")] });
  }
  const key = session.actorId + ":" + session.channelId;
  if (Date.now() - (cooldown.get(key) || 0) < COOLDOWN_MS) {
    return interaction.editReply({ components: [chooser(session, config)] });
  }

  session.busy = true;
  try {
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!authorized(actor, interaction.guild, config, "helper")) {
      sessions.delete(nonce);
      return interaction.editReply({ components: [feedback("Staff permission is required to send reminders.")] });
    }
    const channel = await interaction.guild.channels.fetch(session.channelId);
    if (!channel?.isTextBased() || typeof channel.send !== "function") {
      throw new Error("Reminder channel unavailable");
    }

    const original = session.messageId ?
      await channel.messages.fetch(session.messageId).catch(() => null) : null;
    if (session.messageId && !original) {
      throw new Error("Flagged message is unavailable");
    }

    const payload = reminderDisplay(ruleId, original?.author ?? null,
      session.guildId, session.channelId, session.messageId, config);
    const posted = original ? await original.reply(payload) : await channel.send(payload);
    cooldown.set(key, Date.now());
    sessions.delete(nonce);

    // Reminders remain nonpunitive records, separate from formal warnings.
    const record = store.addCase(interaction.guildId, {
      type: "reminder", targetId: original?.author?.id ?? null,
      actorId: interaction.user.id, reason: ruleId, channelId: session.channelId,
      messageId: session.messageId, postedMessageId: posted.id
    });
    // A failed log must not trigger a duplicate reminder; the message already posted.
    await audit(interaction, config,
      "Non-punitive reminder #" + record.id + ": " + ruleId +
      " by <@" + interaction.user.id + ">" +
      (record.targetId ? " to <@" + record.targetId + ">" : ""));
    return interaction.editReply({ components: [feedback(
      "✅ Reminder Sent! Thank you for doing your part to keep RayCraft welcoming."
    )] });
  } catch (error) {
    console.error("Failed to send RayCraft reminder:", error);
    return interaction.editReply({ components: [feedback(
      "Couldn't post that reminder. The flagged message may have been deleted or RayBot may lack permission. Try the command again."
    )] });
  } finally {
    session.busy = false;
  }
}

module.exports = { begin, component };
