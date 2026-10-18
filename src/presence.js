"use strict";

const { ActivityType } = require("discord.js");

// Custom activity only. No Playing, Watching, Listening, Streaming, or Competing.
const statuses = Object.freeze([
  "🌎 One world, endless possibilities",
  "📬 Here to help with RayCraft",
  "✨ Every build has a story",
  "🌱 Growing a friendly community",
  "🧭 Your adventure, your way",
  "🛠️ Helping keep the world running",
  "💬 Questions? I'm here to help!",
  "🏡 A place for every kind of builder",
  "🌤️ Making new memories, block by block"
]);

const EVERY_45_MINUTES = 45 * 60 * 1000;
let timer = null;

function startPresence(client) {
  let index = 0;
  const setCustom = () => {
    if (!client.user) return;
    client.user.setPresence({
      status: "online",
      activities: [
        {
          name: "Custom Status",
          type: ActivityType.Custom,
          state: statuses[index]
        }
      ]
    });
    index = (index + 1) % statuses.length;
  };
  if (timer) clearInterval(timer);
  setCustom();
  timer = setInterval(setCustom, EVERY_45_MINUTES);
  timer.unref();
}

module.exports = { startPresence, statuses };
