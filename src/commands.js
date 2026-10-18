"use strict";

const { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType } = require("discord.js");
const { rules } = require("./policy");

const commands = [
  new SlashCommandBuilder().setName("rules").setDescription("Read RayCraft's community rules"),
  new SlashCommandBuilder().setName("connect").setDescription("How to join RayCraft"),
  new SlashCommandBuilder().setName("rulereminder").setDescription("Post a non-punitive rule reminder (staff)"),
  new SlashCommandBuilder().setName("warn").setDescription("Record a formal warning (moderators)")
    .addUserOption((x) => x.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((x) => x.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(900)),
  new SlashCommandBuilder().setName("timeout").setDescription("Temporarily timeout a member (moderators)")
    .addUserOption((x) => x.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption((x) => x.setName("minutes").setDescription("Duration (max 28 days)").setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption((x) => x.setName("reason").setDescription("Reason").setMaxLength(900).setRequired(true)),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member (moderators)")
    .addUserOption((x) => x.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((x) => x.setName("reason").setDescription("Reason").setMaxLength(900).setRequired(true)),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member (moderators)")
    .addUserOption((x) => x.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((x) => x.setName("reason").setDescription("Reason").setMaxLength(900).setRequired(true)),
  new SlashCommandBuilder().setName("history").setDescription("View moderation history (staff)")
    .addUserOption((x) => x.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("incident").setDescription("Record a private staff note (staff)")
    .addUserOption((x) => x.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((x) => x.setName("note").setDescription("Observation").setRequired(true).setMaxLength(900)),
  new SlashCommandBuilder().setName("purge").setDescription("Remove recent messages (moderators)")
    .addIntegerOption((x) => x.setName("count").setDescription("Between 1 and 100").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("ticket").setDescription("Private RayCraft support tickets")
    .addSubcommand((x) => x.setName("open").setDescription("Open a support ticket")
      .addStringOption((o) => o.setName("category").setDescription("Ticket type").setRequired(true).addChoices(
        { name: "Player help", value: "help" }, { name: "Report griefing or theft", value: "report" },
        { name: "Appeal", value: "appeal" }, { name: "Technical help", value: "technical" }
      ))
      .addStringOption((o) => o.setName("details").setDescription("Brief description").setRequired(true).setMaxLength(900)))
    .addSubcommand((x) => x.setName("claim").setDescription("Claim the current ticket (staff)"))
    .addSubcommand((x) => x.setName("close").setDescription("Close the current ticket")),
  new ContextMenuCommandBuilder().setName("Rules Reminder").setType(ApplicationCommandType.Message)
];

function reminderChoices() {
  return [{ label: "General reminder", value: "general", description: "Non-specific friendly reminder" }]
    .concat(rules.map((rule) => ({ label: rule.title.slice(0, 100), value: rule.id, description: rule.summary.slice(0, 100) })));
}

module.exports = { commands, reminderChoices };
