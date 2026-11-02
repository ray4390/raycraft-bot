"use strict";

const SNOWFLAKE = /^\d{15,22}$/;
const CATEGORIES = ["Gameplay", "Economy", "Plugins", "Building", "Community", "Quality of Life"];
const FORUM_STATUSES = ["Open", "Under Review", "Poll Open", "Planned", "Declined", "Implemented"];
const TERMINAL = new Set(["rejected", "declined", "implemented"]);
const STATUSES = new Set(["pending", "rejected", "open", "reviewing", "polling", "planned", "declined", "implemented"]);

function isSuggestionThread(thread, guildId, forumId) {
  return Boolean(thread && thread.guildId === guildId && thread.parentId === forumId &&
    SNOWFLAKE.test(String(thread.id || "")));
}
function isSuggestionId(value) {
  return SNOWFLAKE.test(String(value || ""));
}
function normalizeSuggestion(title, proposal, reason, category) {
  const fields = [title, proposal, reason].map((x) => String(x || "").trim());
  if (fields[0].length < 5 || fields[0].length > 100) throw new Error("Title must be 5–100 characters.");
  if (fields[1].length < 15 || fields[1].length > 1900) throw new Error("Suggestion must be 15–1900 characters.");
  if (fields[2].length < 10 || fields[2].length > 900) throw new Error("Reason must be 10–900 characters.");
  if (!CATEGORIES.includes(category)) throw new Error("Choose a valid suggestion category.");
  return { title: fields[0], proposal: fields[1], reason: fields[2], category };
}
function normalizePoll(question, yes, no) {
  const values = [question, yes, no].map((v) => String(v || "").trim());
  if (!values[0] || values[0].length > 300) throw new Error("Poll question must be between 1 and 300 characters.");
  if (values[1].length < 2 || values[1].length > 55 ||
      values[2].length < 2 || values[2].length > 55) throw new Error("Poll choices must be between 2 and 55 characters.");
  if (values[1].toLowerCase() === values[2].toLowerCase()) throw new Error("Poll choices must be different.");
  return { question: values[0], yes: values[1], no: values[2], duration: 168 };
}
function canChangeStatus(status, next) {
  return STATUSES.has(status) && STATUSES.has(next) && !TERMINAL.has(status) &&
    status !== next && ["reviewing", "planned", "declined", "implemented"].includes(next) &&
    !["pending", "rejected"].includes(status);
}
function safeText(text) {
  return String(text || "").replace(/@everyone|@here/gi, (x) => "@\u200b" + x.slice(1));
}
module.exports = {
  isSuggestionThread, isSuggestionId, normalizeSuggestion, normalizePoll,
  canChangeStatus, safeText, CATEGORIES, FORUM_STATUSES, STATUSES, TERMINAL
};
