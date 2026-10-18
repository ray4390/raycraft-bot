"use strict";

const { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType } = require("discord.js");
const { rules } = require("./policy");

const commands = [
  new SlashCommandBuilder().setName("rules").setDescription("Read RayCraft's community rules"),
  new SlashCommandBuilder().setName("connect").setDescription("How to join RayCraft"),
  new SlashCommandBuilder().setName("ping").setDescription("Check RayBot's connection and Discord API latency"),
  new SlashCommandBuilder().setName("help").setDescription("Browse RayBot's command directory"),
  new SlashCommandBuilder().setName("about").setDescription("About RayBot, version and uptime"),
  new SlashCommandBuilder().setName("status").setDescription("View RayBot's health and memory usage (staff)"),
  new SlashCommandBuilder().setName("modhelp").setDescription("View moderation and helper commands (staff)"),
  new SlashCommandBuilder().setName("reload").setDescription("Reload rules and synchronize commands (admins)"),
  new SlashCommandBuilder().setName("botlogs").setDescription("View sanitized bot event history (admins)"),
  new SlashCommandBuilder().setName("restart").setDescription("Restart RayBot under PM2 (server owner)"),
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
  new SlashCommandBuilder().setName("openticket").setDescription("Open RayCraft modmail through DMs"),
  new SlashCommandBuilder().setName("ticketpanel").setDescription("Post or refresh the Open a Ticket panel (admins)"),
  new SlashCommandBuilder().setName("ticket").setDescription("RayCraft staff modmail forum")
    .addSubcommand((x) => x.setName("open").setDescription("Start a private DM modmail ticket"))
    .addSubcommand((x) => x.setName("claim").setDescription("Claim this forum ticket (staff)"))
    .addSubcommand((x) => x.setName("unclaim").setDescription("Unclaim this forum ticket (staff)"))
    .addSubcommand((x) => x.setName("takeover").setDescription("Take over a claimed ticket (moderators)"))
    .addSubcommand((x) => x.setName("ping").setDescription("Set claimed ticket notification preference"))
    .addSubcommand((x) => x.setName("remind").setDescription("Run this ticket's reminder check"))
    .addSubcommand((x) => x.setName("close").setDescription("Close and archive this ticket (staff)"))
    .addSubcommand((x) => x.setName("contact").setDescription("Open a staff-initiated modmail ticket")
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason for contact").setRequired(true).setMaxLength(900)))
    .addSubcommand((x) => x.setName("blacklist").setDescription("Block abusive modmail submissions")
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true)))
    .addSubcommand((x) => x.setName("unblacklist").setDescription("Restore modmail access")
      .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))),
  new ContextMenuCommandBuilder().setName("Rules Reminder").setType(ApplicationCommandType.Message)
];

function reminderChoices() {
  return [{ label: "General reminder", value: "general", description: "Non-specific friendly reminder" }]
    .concat(rules.map((rule) => ({ label: rule.title.slice(0, 100), value: rule.id, description: rule.summary.replace(/\s+/g, " ").slice(0, 100) })));
}

module.exports = { commands, reminderChoices };
