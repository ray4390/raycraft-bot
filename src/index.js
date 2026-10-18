"use strict";
require("dotenv").config();

const { Client, Events, GatewayIntentBits, MessageFlags } = require("discord.js");
const { readConfig, validateConfig } = require("./policy");
const { Store } = require("./storage");
const { commands } = require("./commands");
const { handleInteraction } = require("./handlers");

const config = readConfig();
validateConfig(config);
const store = new Store(config.dataFile);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
});

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    await guild.commands.set(commands.map((command) => command.toJSON()));
    console.log("RayCraft Bot online as " + client.user.tag + "; commands registered for " + guild.id);
  } catch (error) {
    console.error("Could not register RayCraft guild commands:", error);
    process.exitCode = 1;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleInteraction(interaction, client, config, store);
  } catch (error) {
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

client.on(Events.Error, (error) => console.error("Discord gateway error:", error));
client.login(config.token).catch((error) => {
  console.error("Discord login failed:", error);
  process.exitCode = 1;
});
