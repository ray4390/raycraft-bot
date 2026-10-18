"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, Routes, version: djsVersion } = require("discord.js");
const { authorized, staffLevel, reloadRules } = require("./policy");
const { commands } = require("./commands");
const { replyPrivate, panel } = require("./common");
const pkg = require("../package.json");

// A bounded list of metadata; NEVER display raw process logs, user message
// content, tokens, environment variables, stack traces, or error strings.
const events = [];
function logEvent(type, action = "") {
  if (!["ready", "command", "error", "reload", "restart", "gateway"].includes(type)) return;
  const name = String(action).replace(/[^a-z0-9_ /.-]/gi, "").slice(0, 40);
  events.push(new Date().toISOString().slice(11, 19) + " UTC | " + type + (name ? " | " + name : ""));
  if (events.length > 40) events.shift();
}
const pm2Active = () => /^\d+$/.test(process.env.pm_id || "");
const isOwner = i => i.user.id === i.guild.ownerId;
const isAdmin = (m, g) => m.id === g.ownerId || m.permissions.has("Administrator");
const duration = secs => {
  const s = Math.floor(secs);
  return (Math.floor(s / 86400) ? Math.floor(s / 86400) + "d " : "") +
    (Math.floor(s % 86400 / 3600) ? Math.floor(s % 86400 / 3600) + "h " : "") +
    Math.floor(s % 3600 / 60) + "m";
};
const mib = value => (value / (1024 * 1024)).toFixed(1);

const groups = [
  { id: "general", label: "General", entries: [
    ["/ping", "Gateway and API latency"], ["/serverstatus", "Minecraft Java and Bedrock status"], ["/help", "Command directory"],
    ["/about", "Bot version and uptime"], ["/rules", "Community rules"],
    ["/connect", "How to join RayCraft"], ["/openticket", "Open a private modmail ticket"]
  ]},
  { id: "helper", label: "Helpers", entries: [
    ["/rulereminder", "Friendly rule reminder"], ["Rules Reminder (message action)", "Target a message"],
    ["/ticket claim / unclaim / close / ping", "Support tickets"],
    ["/history", "View player case records"], ["/incident", "Private staff notes"],
    ["/status", "Bot status"], ["/modhelp", "Staff reference"]
  ]},
  { id: "moderator", label: "Moderators", entries: [
    ["/warn / timeout / kick / ban", "Moderation actions"], ["/purge", "Delete recent messages"],
    ["/ticket takeover / contact", "Manage escalations"],
    ["/ticket blacklist / unblacklist", "Control modmail submissions"]
  ]},
  { id: "admin", label: "Administrators", entries: [
    ["/reload", "Reload RayCraft rules and sync slash commands"],
    ["/botlogs", "View sanitized recent bot events"]
  ]},
  { id: "owner", label: "Server owner", entries: [
    ["/restart", "Restart RayBot through PM2"]
  ]}
];

function accessible(member, guild, config) {
  return groups.filter(group =>
    group.id === "general" ||
    (group.id === "helper" && authorized(member, guild, config)) ||
    (group.id === "moderator" && authorized(member, guild, config, "moderator")) ||
    (group.id === "admin" && isAdmin(member, guild)) ||
    (group.id === "owner" && member.id === guild.ownerId));
}
function helpPayload(i, list, group) {
  const text = group.entries.map(([cmd, description]) => "**" + cmd + "** — " + description).join("\n");
  return {
    embeds: [panel("RayBot Help · " + group.label, text + "\n\nBrowse another category below.")],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("rutil:help:" + i.user.id)
        .setPlaceholder("Choose a command category")
        .addOptions(list.map(x => ({ label: x.label, value: x.id })))
    )]
  };
}
async function help(i, config, selected = "general") {
  const member = await i.guild.members.fetch(i.user.id);
  const list = accessible(member, i.guild, config);
  const group = list.find(x => x.id === selected) || list[0];
  const payload = helpPayload(i, list, group);
  return i.isStringSelectMenu() ? i.update(payload) : replyPrivate(i, payload);
}
async function adminOnly(i) {
  const m = await i.guild.members.fetch(i.user.id);
  if (isAdmin(m, i.guild)) return true;
  await replyPrivate(i, "Administrator access required.");
  return false;
}

async function execute(i, client, config) {
  const name = i.commandName;
  if (name === "help") return help(i, config);
  if (name === "serverstatus") {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let data;
      try {
        const response = await fetch("https://raycraftmc.com/api/status", {
          signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "RayCraft-RayBot/0.5 serverstatus" }
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        data = await response.json();
      } finally {
        clearTimeout(timeout);
      }
      const format = (part) => {
        const state = part?.state === "online" ? "🟢 Online" : part?.state === "offline" ? "🔴 Offline" : "⚪ Unavailable";
        return state + (part?.state === "online" && Number.isSafeInteger(part.players) ? " · " + part.players + " players" : "");
      };
      const stamp = Number.isFinite(Date.parse(data.checkedAt)) ? "\n**Checked:** <t:" + Math.floor(Date.parse(data.checkedAt) / 1000) + ":R>" : "";
      return i.editReply({ embeds: [panel("RayCraft Minecraft Status",
        "**Java:** " + format(data.java) + "\n`play.raycraftmc.com`\n\n" +
        "**Bedrock:** " + format(data.bedrock) + "\n`bedrock.raycraftmc.com:19132`" +
        stamp + "\n\n[Website](https://raycraftmc.com) · [BlueMap](https://map.raycraftmc.com/)")] });
    } catch (_) {
      return i.editReply({ embeds: [panel("RayCraft Minecraft Status",
        "Live status is temporarily unavailable. This doesn't necessarily mean the server is offline.\n\n**Java:** `play.raycraftmc.com`\n**Bedrock:** `bedrock.raycraftmc.com:19132`")] });
    }
  }
  if (name === "ping") {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const began = Date.now();
    try {
      await client.rest.get(Routes.user("@me"));
      return i.editReply({ embeds: [panel("RayBot Ping",
        "**Discord gateway:** " + client.ws.ping + " ms\n**Discord REST API:** " +
        (Date.now() - began) + " ms")] });
    } catch {
      logEvent("error", "ping api");
      return i.editReply("Discord REST API check failed. Gateway: " + client.ws.ping + " ms.");
    }
  }
  if (name === "about") return replyPrivate(i, {
    embeds: [panel("About RayBot", "RayCraft's helper and moderation bot.\n\n" +
      "**Version:** " + pkg.version + "\n**Discord.js:** " + djsVersion +
      "\n**Uptime:** " + duration(process.uptime()) + "\n**Community:** RayCraft")]
  });
  if (name === "modhelp") {
    const member = await i.guild.members.fetch(i.user.id);
    const level = staffLevel(member, i.guild, config);
    if (level === "none") return replyPrivate(i, "Staff access required.");
    return help(i, config, level === "moderator" ? "moderator" : "helper");
  }
  if (name === "status") {
    const member = await i.guild.members.fetch(i.user.id);
    if (!authorized(member, i.guild, config)) return replyPrivate(i, "Staff access required.");
    const mem = process.memoryUsage();
    return replyPrivate(i, { embeds: [panel("RayBot Status",
      "**Discord:** " + (client.isReady() ? "Connected" : "Reconnecting") +
      "\n**Gateway latency:** " + client.ws.ping + " ms" +
      "\n**Uptime:** " + duration(process.uptime()) +
      "\n**Memory (RSS):** " + mib(mem.rss) + " MiB" +
      "\n**Heap used:** " + mib(mem.heapUsed) + " MiB" +
      "\n**Process manager:** " + (pm2Active() ? "PM2" : "Other"))] });
  }
  if (name === "botlogs") {
    if (!await adminOnly(i)) return;
    const lines = events.slice(-18).join("\n") || "No recent events.";
    return replyPrivate(i, { embeds: [panel("RayBot Events",
      "Sanitized in-memory events only; use PM2 on the host for full logs.\n\n" +
      "```text\n" + lines + "\n```")] });
  }
  if (name === "reload") {
    if (!await adminOnly(i)) return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const count = reloadRules();
      await i.guild.commands.set(commands.map(command => command.toJSON()));
      logEvent("reload", "rules and command registry");
      return i.editReply("Refreshed " + count + " RayCraft rules and re-registered slash commands. JavaScript and environment changes require a restart.");
    } catch (error) {
      logEvent("error", "reload");
      console.error("RayBot reload failed:", error);
      return i.editReply("Reload failed. Review the rules file and PM2 logs.");
    }
  }
  if (name === "restart") {
    if (!isOwner(i)) return replyPrivate(i, "Only the Discord server owner can restart RayBot.");
    if (!pm2Active()) return replyPrivate(i, "RayBot is not running under PM2; restart refused.");
    return replyPrivate(i, {
      content: "Restart **RayBot only** under PM2? PoliBot and Minecraft will not be touched.",
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("rutil:restart:" + i.user.id).setLabel("Restart RayBot").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("rutil:cancel:" + i.user.id).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      )]
    });
  }
}
async function component(i, client, config) {
  const [, action, ownerId] = i.customId.split(":");
  if (i.user.id !== ownerId) return i.reply({ content: "This control belongs to another user.", flags: MessageFlags.Ephemeral });
  if (action === "help" && i.isStringSelectMenu()) return help(i, config, i.values[0]);
  if (action === "cancel") {
    if (!isOwner(i)) return i.reply({ content: "Owner only.", flags: MessageFlags.Ephemeral });
    return i.update({ content: "Restart cancelled.", components: [] });
  }
  if (action === "restart") {
    if (!isOwner(i) || !pm2Active()) return i.reply({ content: "Owner-only PM2 restart unavailable.", flags: MessageFlags.Ephemeral });
    await i.update({ content: "RayBot is restarting under PM2.", components: [] });
    logEvent("restart", "owner confirmation");
    // Narrow bot-only lifecycle action. PM2 autorestart respawns this process.
    setTimeout(() => process.exit(0), 800).unref();
  }
}
module.exports = { execute, component, logEvent };
