"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSuggestionThread, isSuggestionId, normalizeSuggestion, normalizePoll,
  canChangeStatus, safeText, CATEGORIES, FORUM_STATUSES
} = require("../src/suggestionPolicy");

const guild = "1548433735777652909";
const forum = "1566922019025588245";
const thread = "1566923333333333333";

test("only approved suggestion forum posts are recognized as published threads", () => {
  assert.equal(isSuggestionThread({ id: thread, guildId: guild, parentId: forum }, guild, forum), true);
  assert.equal(isSuggestionThread({ id: thread, guildId: guild, parentId: "1561440000000000000" }, guild, forum), false);
  assert.equal(isSuggestionThread({ id: thread, guildId: "1550000000000000000", parentId: forum }, guild, forum), false);
  assert.equal(isSuggestionThread({ id: "bad", guildId: guild, parentId: forum }, guild, forum), false);
  assert.equal(isSuggestionId(thread), true);
  assert.equal(isSuggestionId("123"), false);
});

test("submission form normalizes complete and valid suggestions", () => {
  assert.deepEqual(normalizeSuggestion("  New roads  ", "  Make more stone roads near spawn  ",
    "  Improve navigation and appearance  ", "Building"), {
    title: "New roads", proposal: "Make more stone roads near spawn",
    reason: "Improve navigation and appearance", category: "Building"
  });
  assert.throws(() => normalizeSuggestion("bad", "A good proposal for the world", "This is a good reason", "Gameplay"), /Title/);
  assert.throws(() => normalizeSuggestion("Good title", "too short", "This is a good reason", "Gameplay"), /Suggestion/);
  assert.throws(() => normalizeSuggestion("Good title", "A good proposal for the world", "bad", "Gameplay"), /Reason/);
  assert.throws(() => normalizeSuggestion("Good title", "A good proposal for the world", "This is a good reason", "Not a category"), /category/);
  assert.equal(CATEGORIES.length, 6);
  assert.equal(FORUM_STATUSES.length, 6);
});

test("native poll options are customized and validated", () => {
  assert.deepEqual(normalizePoll("Small farms?", "Allow", "Prohibit"),
    { question: "Small farms?", yes: "Allow", no: "Prohibit", duration: 168 });
  assert.throws(() => normalizePoll("Something", "Yes", "yes"), /different/);
  assert.throws(() => normalizePoll("", "Yes", "No"), /question/);
});

test("pending suggestions cannot be marked planned before moderator approval", () => {
  assert.equal(canChangeStatus("pending", "planned"), false);
  assert.equal(canChangeStatus("pending", "reviewing"), false);
  assert.equal(canChangeStatus("rejected", "reviewing"), false);
  assert.equal(canChangeStatus("open", "reviewing"), true);
  assert.equal(canChangeStatus("reviewing", "planned"), true);
  assert.equal(canChangeStatus("polling", "implemented"), true);
  assert.equal(canChangeStatus("planned", "declined"), true);
  assert.equal(canChangeStatus("declined", "reviewing"), false);
  assert.equal(canChangeStatus("implemented", "planned"), false);
  assert.equal(canChangeStatus("open", "polling"), false);
});
test("untrusted proposal text does not ping everyone", () => {
  assert.equal(safeText("@everyone everyone @here"), "@\u200beveryone everyone @\u200bhere");
});
