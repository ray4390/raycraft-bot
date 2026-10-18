"use strict";
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

// Branded, PoliBot-style modmail presentation adapted to RayCraft.
const categories = Object.freeze({
  appeal: { name: "Appeals", emoji: "⚖️", summary: "Appeal a moderation action. Moderators review these requests.", color: ButtonStyle.Primary },
  report: { name: "Moderation", emoji: "🔨", summary: "Report griefing, theft, cheating, harassment, or ask about rules.", color: ButtonStyle.Danger },
  technical: { name: "Technical Support", emoji: "🛠️", summary: "Get help with Minecraft connections, Java/Bedrock, or server issues.", color: ButtonStyle.Success },
  help: { name: "Player Help", emoji: "🧭", summary: "Ask about gameplay, the community, or general assistance.", color: ButtonStyle.Primary },
  other: { name: "Other", emoji: "❔", summary: "Anything that does not belong in the categories above.", color: ButtonStyle.Secondary }
});
const colors = Object.freeze({ blue: 0x3498db, yellow: 0xf1c40f, green: 0x2ecc71, red: 0xe74c3c, gray: 0x95a5a6 });
function categoryName(key) { return categories[key]?.name || "General Support"; }
function notice(description, kind = "green", title = "") {
  const e = new EmbedBuilder().setColor(colors[kind] || colors.green).setDescription(description).setTimestamp();
  if (title) e.setTitle(title);
  return e;
}
function categoryMenu() {
  return {
    embeds: [new EmbedBuilder().setColor(colors.yellow)
      .setTitle("📨  RayCraft Modmail System")
      .setDescription([
        "-# Choose the category that best fits your request. Selecting the right category helps our staff respond more quickly.",
        ...Object.values(categories).map(c => "‣ **" + c.emoji + " " + c.name + "** — " + c.summary),
        "**-# Please do not abuse modmail. Repeated misuse may result in losing ticket access.**"
      ].join("\n\n"))
      .setFooter({ text: "Your conversation is relayed privately to RayCraft staff." })],
    components: [new ActionRowBuilder().addComponents(
      Object.entries(categories).map(([key, c]) =>
        new ButtonBuilder().setCustomId("rct:category:" + key).setLabel(c.name).setEmoji(c.emoji).setStyle(c.color))
    )],
    allowedMentions: { parse: [] }
  };
}
function openingEmbed(ticket) {
  return new EmbedBuilder()
    .setColor(ticket.status === "closed" ? colors.red : colors.green)
    .setTitle(ticket.status === "closed" ? "Ticket Closed" : "New Ticket Opened")
    .setAuthor({ name: ticket.playerName || "RayCraft Player", ...(ticket.avatarURL ? { iconURL: ticket.avatarURL } : {}) })
    .setDescription("A new ticket has been opened by <@" + ticket.openerId + ">.")
    .addFields(
      { name: "Category", value: categoryName(ticket.category) },
      { name: "Reason:", value: String(ticket.details || "No reason provided").slice(0, 1024), inline: true },
      { name: "Claimed by:", value: ticket.claimedBy ? "<@" + ticket.claimedBy + ">" : "N/A", inline: true }
    )
    .setFooter({ text: ticket.status === "closed" ? "This conversation has been archived." :
      ticket.claimedBy ? "This ticket has been claimed." : "Please claim this ticket before proceeding. • Player ID: " + ticket.openerId })
    .setTimestamp();
}
function confirmation(category, details) {
  return new EmbedBuilder().setColor(colors.yellow)
    .setTitle("📨  RayCraft Modmail System")
    .setDescription("Please review your ticket before submitting it to **" + categoryName(category) + "**.")
    .addFields(
      { name: "Category", value: categoryName(category) },
      { name: "Reason", value: details.slice(0, 1024) }
    );
}
function openedEmbeds(ticket) {
  return [
    new EmbedBuilder().setColor(colors.green).setTitle("New Ticket Opened")
      .setDescription("Your **" + categoryName(ticket.category) + "** ticket **#" + ticket.number +
        "** has been submitted to RayCraft staff.")
      .addFields({ name: "Reason:", value: ticket.details.slice(0, 1024) })
      .setFooter({ text: "Please be patient while our staff review your request." }),
    new EmbedBuilder().setColor(colors.yellow).setTitle("How modmail works")
      .setDescription(
        "Your ticket is open! You can add information or speak with staff simply by replying to this DM.\n\n" +
        "A **✅** reaction means your message was delivered to staff; **❌** means delivery failed, and you should try again.\n\n" +
        "We prefer **message links** over screenshots whenever possible, but attachments and screenshots are supported.\n\n" +
        "A staff member will let you know when your ticket has been claimed."
      )
  ];
}
function pingRoles(ticket, config) {
  const ids = ticket.category === "appeal" ? config.moderatorRoles :
    [...config.moderatorRoles, ...config.helperRoles];
  return [...new Set(ids)].filter(id => /^\d{15,22}$/.test(id));
}
function incomingEmbed(message) {
  return new EmbedBuilder().setColor(colors.blue)
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setDescription(String(message.content || "").trim().slice(0, 4000) || "(attachment only)")
    .setFooter({ text: "User ID: " + message.author.id + " • " + message.id.slice(-8) })
    .setTimestamp();
}
function outgoingEmbed(message, ticket) {
  const e = new EmbedBuilder().setColor(colors.blue)
    .setAuthor({ name: "RayCraft Staff Team", iconURL: message.guild.iconURL() || undefined })
    .setDescription(String(message.content || "").trim().slice(0, 4000) || "(attachment only)")
    .setFooter({ text: "Ticket #" + ticket.number + " • Staff ID: " + message.author.id.slice(-5) + " • " + message.id.slice(-8) })
    .setTimestamp();
  return e;
}
module.exports = { categories, colors, categoryName, notice, categoryMenu, openingEmbed, confirmation, openedEmbeds, pingRoles, incomingEmbed, outgoingEmbed };
