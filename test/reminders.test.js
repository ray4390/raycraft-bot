"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reminderChoices, commands } = require("../src/commands");
const { rules } = require("../src/policy");
test("all RayCraft reminder choices fit Discord's select-menu constraints", () => {
  const choices = reminderChoices();
  assert.equal(choices.length, rules.length + 1);
  assert.ok(choices.length <= 25);
  assert.equal(new Set(choices.map((x) => x.value)).size, choices.length);
  assert.ok(choices.every((x) => x.label.length <= 100 && x.description.length <= 100));
});
test("slash commands and message context menu serialize", () => {
  const json = commands.map((x) => x.toJSON());
  assert.ok(json.find((x) => x.name === "rulereminder"));
  assert.ok(json.find((x) => x.name === "Rules Reminder" && x.type === 3));
  assert.ok(json.find((x) => x.name === "ticket"));
});
