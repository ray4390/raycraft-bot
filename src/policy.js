"use strict";

const fs = require("node:fs");
const path = require("node:path");
const rules = require("../config/rules.json");

function reloadRules() {
  const fresh = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../config/rules.json"), "utf8"));
  if (!Array.isArray(fresh) || fresh.length < 1 || fresh.length > 24) {
    throw new Error("Expected 1-24 rule definitions.");
  }
  const seen = new Set();
  for (const rule of fresh) {
    if (!rule || typeof rule.id !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(rule.id) ||
        seen.has(rule.id) ||
        typeof rule.title !== "string" || !rule.title.trim() || rule.title.length > 100 ||
        typeof rule.summary !== "string" || !rule.summary.trim() || rule.summary.length > 1000) {
      throw new Error("Invalid or duplicate rule entry in config/rules.json.");
    }
    seen.add(rule.id);
  }
  // Update the shared array used by both command menus and the reminder handlers.
  rules.splice(0, rules.length, ...fresh);
  return rules.length;
}

function ids(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{15,22}$/.test(item));
}

function readConfig(env = process.env) {
  return {
    token: env.DISCORD_TOKEN || "",
    guildId: env.GUILD_ID || "",
    moderatorRoles: ids(env.MODERATOR_ROLE_IDS),
    helperRoles: ids(env.HELPER_ROLE_IDS),
    modLogChannelId: env.MOD_LOG_CHANNEL_ID || "",
    rulesChannelId: env.RULES_CHANNEL_ID || "",
    ticketForumId: env.TICKET_FORUM_ID || "",
    expectedBotId: env.BOT_APPLICATION_ID || "",
    dataFile: env.DATA_FILE || "./data/raycraft.json"
  };
}

function validateConfig(config) {
  if (!config.token || !/^\d{15,22}$/.test(config.guildId)) {
    throw new Error("DISCORD_TOKEN and a valid GUILD_ID are required.");
  }
  if (!config.moderatorRoles.length) {
    throw new Error("Set MODERATOR_ROLE_IDS before starting the bot.");
  }
}

function staffLevel(member, guild, config) {
  if (!member || !guild || guild.id !== config.guildId) return "none";
  if (guild.ownerId === member.id || member.permissions?.has?.("Administrator")) return "moderator";
  const has = (role) => member.roles?.cache?.has?.(role);
  if (config.moderatorRoles.some(has)) return "moderator";
  if (config.helperRoles.some(has)) return "helper";
  return "none";
}

function authorized(member, guild, config, minimum = "helper") {
  const level = staffLevel(member, guild, config);
  return level === "moderator" || (minimum === "helper" && level === "helper");
}

function canModerate(actor, target, guild, config) {
  if (!authorized(actor, guild, config, "moderator") || !target) return false;
  if (target.id === actor.id || target.id === guild.ownerId) return false;
  if (actor.id === guild.ownerId) return true;
  return actor.roles.highest.position > target.roles.highest.position;
}

function getRule(id) {
  return rules.find((rule) => rule.id === id) || null;
}

function reminderText(id, options = {}) {
  const name = options.mention || "everyone";
  const link = options.rulesChannelId ? "\nRead the full rules in <#" + options.rulesChannelId + ">." : "";
  if (id === "general") {
    return {
      title: "RayCraft Rules Reminder",
      description: "Friendly reminder, " + name + ": please respect other players, their builds and belongings, and our server's fairness and performance rules." + link + "\n\nThis is a reminder, not a formal warning."
    };
  }
  const rule = getRule(id);
  if (!rule) throw new Error("Unknown rule: " + id);
  return {
    title: "RayCraft Reminder: " + rule.title,
    description: name + ", " + rule.summary + link + "\n\nThis is a reminder, not a formal warning."
  };
}

module.exports = { rules, reloadRules, ids, readConfig, validateConfig, staffLevel, authorized, canModerate, getRule, reminderText };
