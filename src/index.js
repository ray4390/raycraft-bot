"use strict";
require("dotenv").config();

const { Client, Events, GatewayIntentBits, Partials, MessageFlags } = require("discord.js");
const { readConfig, validateConfig } = require("./policy");
const { Store } = require("./storage");
const { commands } = require("./commands");
const { handleInteraction } = require("./handlers");
const { handleMessage } = require("./ticketRelay");
const { sweep } = require("./ticketReminders");
const { forumFor, updateTicketPost } = require("./tickets");
const { logEvent } = require("./utilities");
const ticketPanel = require("./ticketPanel");
const { startPresence } = require("./presence");

const config = readConfig();
validateConfig(config);
const store = new Store(config.dataFile);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    if (config.expectedBotId && client.user.id !== config.expectedBotId) {
      throw new Error("Logged into wrong Discord bot application. Check BOT_APPLICATION_ID");
    }
    await forumFor(client, config);
    await guild.commands.set(commands.map((command) => command.toJSON()));
    console.log("RayCraft Bot online as " + client.user.tag + "; commands registered for " + guild.id);
    logEvent("ready", "connected to discord");
    startPresence(client);
    ticketPanel.ensure(client, config, store).catch((error) => {
      console.error("Could not refresh the Open a Ticket panel:", error);
    });
    // Retouch existing active forum starters with the new RayCraft modmail
    // embeds; do not create duplicate threads, send notices, or ping staff.
    (async () => {
      for (const ticket of store.activeTickets(config.guildId)) {
        try {
          await updateTicketPost(client, ticket);
        } catch (error) {
          console.warn("Couldn't refresh ticket #" + ticket.number + ":", error.message);
        }
      }
    })().catch((error) => console.warn("Ticket presentation refresh failed:", error));
    // PoliBot's reminder cadence: check every 15 minutes.
    const ticketTimer = setInterval(() => {
      sweep(client, config, store).catch((error) => console.error("Ticket reminder sweep failed:", error));
    }, 15 * 60 * 1000);
    ticketTimer.unref();
    sweep(client, config, store).catch((error) => console.error("Initial reminder sweep failed:", error));
  } catch (error) {
    logEvent("error", "startup");
    console.error("Could not register RayCraft guild commands:", error);
    console.error("Startup configuration failure. Bot is stopping without accepting ticket messages.");
    await client.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleMessage(message, client, config, store);
  } catch (error) {
    console.error("RayCraft modmail message relay failed:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleInteraction(interaction, client, config, store);
    if (interaction.isChatInputCommand() && /^[a-z]{1,32}$/.test(interaction.commandName)) {
      logEvent("command", interaction.commandName);
    }
  } catch (error) {
    logEvent("error", "discord interaction");
    console.error("RayCraft Bot interaction error:", error);
    if (interaction.isRepliable()) {
      try {
        const content = "The command failed. Contact an administrator; the details are in the bot's logs.";
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content, embeds: [], components: [] });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) {
        console.error("Could not send error response:", replyError);
      }
    }
  }
});

client.on(Events.Error, (error) => { logEvent("gateway", "error"); console.error("Discord gateway error:", error); });
client.login(config.token).catch((error) => {
  console.error("Discord login failed:", error);
  process.exitCode = 1;
});
