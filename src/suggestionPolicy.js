"use strict";

const SNOWFLAKE = /^\d{15,22}$/;
const TERMINAL = new Set(["declined", "implemented"]);
const STATUSES = new Set(["submitted", "reviewing", "polling", "planned", "declined", "implemented"]);

function isSuggestionThread(thread, guildId, forumId) {
  return Boolean(thread && thread.guildId === guildId && thread.parentId === forumId &&
    SNOWFLAKE.test(String(thread.id || "")));
}

function isSuggestionId(value) {
  return SNOWFLAKE.test(String(value || ""));
}

function normalizePoll(question, yes, no) {
  const values = [question, yes, no].map((v) => String(v || "").trim());
  if (!values[0] || values[0].length > 300) throw new Error("Poll question must be between 1 and 300 characters.");
  if (values[1].length < 2 || values[1].length > 55 ||
      values[2].length < 2 || values[2].length > 55) {
    throw new Error("Poll choices must be between 2 and 55 characters.");
  }
  if (values[1].toLowerCase() === values[2].toLowerCase()) {
    throw new Error("Poll choices must be different.");
  }
  return { question: values[0], yes: values[1], no: values[2], duration: 168 };
}

function canChangeStatus(status, next) {
  return STATUSES.has(status) && STATUSES.has(next) && !TERMINAL.has(status) &&
    status !== next && next !== "submitted" && next !== "polling";
}

module.exports = { isSuggestionThread, isSuggestionId, normalizePoll, canChangeStatus, STATUSES, TERMINAL };
