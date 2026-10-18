"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rules, getRule, reminderText, authorized, readConfig, canModerate } = require("../src/policy");
const { Store } = require("../src/storage");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("rule catalog is unique and reminder messages are non-punitive", () => {
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  for (const rule of rules) {
    assert.equal(getRule(rule.id), rule);
    assert.match(reminderText(rule.id).description, /not a formal warning/i);
  }
  assert.match(reminderText("general").description, /not a formal warning/i);
  assert.throws(() => reminderText("R14"));
});

test("helper and moderator authority is separate", () => {
  const config = readConfig({ GUILD_ID: "123456789012345678", HELPER_ROLE_IDS: "123456789012345679", MODERATOR_ROLE_IDS: "123456789012345680" });
  const guild = { id: config.guildId, ownerId: "123456789012345686" };
  const member = (role, position = 3, id = "123456789012345687") => ({
    id, roles: { cache: new Map([[role, true]]), highest: { position } },
    permissions: { has: () => false }
  });
  const helper = member(config.helperRoles[0]);
  const mod = member(config.moderatorRoles[0], 5);
  const other = member("123456789012345689", 3);
  assert.ok(authorized(helper, guild, config, "helper"));
  assert.ok(!authorized(helper, guild, config, "moderator"));
  assert.ok(authorized(mod, guild, config, "moderator"));
  assert.ok(canModerate(mod, other, guild, config));
  assert.ok(!canModerate(mod, member("123456789012345689", 6), guild, config));
  assert.ok(!canModerate(mod, member("123456789012345689", 1, guild.ownerId), guild, config));
});

test("cases and tickets persist separately to disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raycraft-test-"));
  try {
    const file = path.join(dir, "state.json");
    const store = new Store(file);
    const a = store.addCase("guild1", { targetId: "player1", type: "warn", reason: "test" });
    assert.equal(a.id, 1);
    store.addTicket({ guildId: "guild1", openerId: "player1", channelId: "channel1" });
    assert.equal(store.openTicket("guild1", "player1").channelId, "channel1");
    const reloaded = new Store(file);
    assert.equal(reloaded.history("guild1", "player1")[0].reason, "test");
    reloaded.changeTicket("channel1", { status: "closed" });
    assert.equal(new Store(file).openTicket("guild1", "player1"), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
