"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { forumFor } = require("../src/tickets");
const { userPing } = require("../src/ticketRelay");
const { Store } = require("../src/storage");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeForum({ publicAccess = false, otherRoleAccess = false } = {}) {
  const config = {
    guildId: "111111111111111111", ticketForumId: "222222222222222222",
    moderatorRoles: ["333333333333333333"], helperRoles: ["444444444444444444"]
  };
  const everyone = { id: config.guildId, name: "@everyone", permissions: { has: () => false } };
  const member = { id: "555555555555555555", name: "Member", permissions: { has: () => false } };
  const helper = { id: config.helperRoles[0], name: "Helper", permissions: { has: () => false } };
  const moderator = { id: config.moderatorRoles[0], name: "Moderator", permissions: { has: () => false } };
  const botRole = { id: "666666666666666666", name: "RayCraft Bot", permissions: { has: () => false } };
  const roleMap = new Map([everyone, member, helper, moderator, botRole].map((r) => [r.id, r]));
  const guild = {
    roles: {
      everyone, cache: roleMap, fetch: async () => roleMap
    },
    members: {
      fetchMe: async () => ({ roles: { cache: new Map([[botRole.id, botRole]]) } })
    }
  };
  const forum = {
    id: config.ticketForumId, type: ChannelType.GuildForum,
    permissionsFor(target) {
      const id = target.id;
      return {
        has(bit) {
          if (id === everyone.id && bit === PermissionFlagsBits.ViewChannel) return publicAccess;
          if (id === member.id && bit === PermissionFlagsBits.ViewChannel) return otherRoleAccess;
          return true;
        }
      };
    }
  };
  guild.channels = { fetch: async () => forum };
  const client = { guilds: { fetch: async () => guild } };
  return { client, config };
}

test("forum modmail requires a non-public channel", async () => {
  await assert.rejects(forumFor(...Object.values(makeForum({ publicAccess: true }))), /@everyone/);
  await assert.rejects(forumFor(...Object.values(makeForum({ otherRoleAccess: true }))), /non-staff role/);
  const { client, config } = makeForum();
  assert.equal((await forumFor(client, config)).type, ChannelType.GuildForum);
});

test("claimant pings match PoliBot's optional activity logic", () => {
  const now = Date.now();
  assert.equal(userPing({ pingOptIn: false, claimedBy: "X", lastSpeaker: "staff" }, now), false);
  assert.equal(userPing({ pingOptIn: true, claimedBy: "X", lastSpeaker: "staff" }, now), true);
  assert.equal(userPing({ pingOptIn: true, claimedBy: "X", lastSpeaker: "user", lastUserMessageAt: new Date(now - 10000).toISOString() }, now), false);
  assert.equal(userPing({ pingOptIn: true, claimedBy: "X", lastSpeaker: "user", lastUserMessageAt: new Date(now - 310000).toISOString() }, now), true);
});

test("forum ticket counter, blacklist, and case history persist separately", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raycraft-forum-test-"));
  try {
    const filename = path.join(dir, "modmail.json");
    const store = new Store(filename);
    assert.equal(store.nextTicketNumber("g"), 1);
    assert.equal(store.nextTicketNumber("g"), 2);
    store.addTicket({ guildId: "g", openerId: "u", channelId: "thread", number: 2 });
    store.setBlacklisted("g", "bad", true);
    const saved = new Store(filename);
    assert.equal(saved.nextTicketNumber("g"), 3);
    assert.ok(saved.isBlacklisted("g", "bad"));
    assert.equal(saved.openTicket("g", "u").channelId, "thread");
    saved.setBlacklisted("g", "bad", false);
    assert.equal(new Store(filename).isBlacklisted("g", "bad"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
