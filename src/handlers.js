"use strict";
const { rules } = require("./policy");
const { panel, replyPrivate, requireStaff } = require("./common");
const reminders = require("./reminders");
const moderation = require("./moderation");
const tickets = require("./tickets");
const utilities = require("./utilities");
const ticketPanel = require("./ticketPanel");

async function handleInteraction(interaction, client, config, store) {
  // DM ticket category buttons and modals are allowed outside a guild, but all staff
  // actions and server commands remain isolated to RayCraft.
  if (!interaction.inGuild() && interaction.customId?.startsWith("rct:")) {
    return tickets.draftInteraction(interaction, client, config, store);
  }
  if (!interaction.inGuild() || interaction.guildId !== config.guildId) {
    if (interaction.isRepliable()) await replyPrivate(interaction, "RayCraft Bot is not configured for this server.");
    return;
  }

  if (interaction.isMessageContextMenuCommand() && interaction.commandName === "Rules Reminder") {
    return reminders.begin(interaction, config, interaction.targetId);
  }

  if (interaction.isButton() && interaction.customId?.startsWith("rcrm:")) {
    return reminders.component(interaction, config, store);
  }

  if (interaction.isButton() && interaction.customId === "rct:open") {
    return tickets.begin(interaction, client, config, store);
  }
  if (interaction.isButton() && interaction.customId?.startsWith("rct:")) {
    return tickets.component(interaction, client, config, store);
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) &&
      interaction.customId?.startsWith("rutil:")) {
    return utilities.component(interaction, client, config);
  }
  if (!interaction.isChatInputCommand()) return;
  const command = interaction.commandName;

  if (["ping", "help", "about", "status", "modhelp", "reload", "restart", "botlogs"].includes(command)) {
    return utilities.execute(interaction, client, config);
  }
  if (command === "rulereminder") return reminders.begin(interaction, config);
  if (["warn", "timeout", "kick", "ban", "purge"].includes(command)) {
    return moderation.execute(interaction, config, store);
  }
  if (command === "history") return moderation.history(interaction, config, store);
  if (command === "incident") return moderation.incident(interaction, config, store);

  if (command === "ticket") return tickets.command(interaction, client, config, store);
  if (command === "openticket") return tickets.begin(interaction, client, config, store);
  if (command === "ticketpanel") return ticketPanel.command(interaction, client, config, store);

  if (command === "rules") {
    const body = rules.map((rule, index) => "**" + (index + 1) + ". " + rule.title + "**\n" + rule.summary).join("\n\n");
    return replyPrivate(interaction, {
      embeds: [panel("RayCraft Rules", body + (config.rulesChannelId
        ? "\n\nFor the full policy, see <#" + config.rulesChannelId + ">." : ""))]
    });
  }
  if (command === "connect") {
    return replyPrivate(interaction, {
      embeds: [panel("Join RayCraft", "**Java:** raycraft.ddnsfree.com\n**Bedrock:** raycraft.ddnsfree.com (UDP port 19132)\n**Map:** http://map.raycraft.ddnsfree.com")]
    });
  }
}

module.exports = { handleInteraction };
