"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSuggestionThread, isSuggestionId, normalizePoll, canChangeStatus
} = require("../src/suggestionPolicy");

const guild = "1548433735777652909";
const forum = "1566922019025588245";
const thread = "1566923333333333333";

test("only RayCraft suggestion forum threads are tracked", () => {
  assert.equal(isSuggestionThread({ id: thread, guildId: guild, parentId: forum }, guild, forum), true);
  assert.equal(isSuggestionThread({ id: thread, guildId: guild, parentId: "1561440000000000000" }, guild, forum), false);
  assert.equal(isSuggestionThread({ id: thread, guildId: "1550000000000000000", parentId: forum }, guild, forum), false);
  assert.equal(isSuggestionThread({ id: "bad-id", guildId: guild, parentId: forum }, guild, forum), false);
  assert.equal(isSuggestionThread(null, guild, forum), false);
});

test("suggestion IDs must be valid Discord snowflakes", () => {
  assert.equal(isSuggestionId(thread), true);
  assert.equal(isSuggestionId("https://discord.com/channels/" + guild + "/" + thread), false);
  assert.equal(isSuggestionId("123"), false);
  assert.equal(isSuggestionId(""), false);
});

test("moderators can customize a seven-day, single-choice poll", () => {
  assert.deepEqual(normalizePoll("  Better farms?  ", "  Yes  ", "  No  "), {
    question: "Better farms?", yes: "Yes", no: "No", duration: 168
  });
  assert.throws(() => normalizePoll("Something", "Yes", "yes"), /different/);
  assert.throws(() => normalizePoll("", "Yes", "No"), /question/);
  assert.throws(() => normalizePoll("Something", "Y", "No"), /choices/);
  assert.throws(() => normalizePoll("Something", "x".repeat(56), "No"), /choices/);
});

test("closed suggestions cannot be changed and polls require a dedicated action", () => {
  assert.equal(canChangeStatus("submitted", "reviewing"), true);
  assert.equal(canChangeStatus("submitted", "planned"), true);
  assert.equal(canChangeStatus("reviewing", "declined"), true);
  assert.equal(canChangeStatus("polling", "implemented"), true);
  assert.equal(canChangeStatus("planned", "implemented"), true);
  assert.equal(canChangeStatus("declined", "reviewing"), false);
  assert.equal(canChangeStatus("implemented", "planned"), false);
  assert.equal(canChangeStatus("submitted", "polling"), false);
  assert.equal(canChangeStatus("submitted", "submitted"), false);
  assert.equal(canChangeStatus("planned", "submitted"), false);
});
