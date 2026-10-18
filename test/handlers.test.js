"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("all production handlers load without needing Discord credentials", () => {
  const { handleInteraction } = require("../src/handlers");
  assert.equal(typeof handleInteraction, "function");
  assert.equal(typeof require("../src/moderation").execute, "function");
  assert.equal(typeof require("../src/tickets").open, "function");
  assert.equal(typeof require("../src/reminders").component, "function");
});
