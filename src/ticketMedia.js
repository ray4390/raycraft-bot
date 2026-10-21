"use strict";

// Discord's signed attachment URLs expire. Reupload small attachments so images,
// video clips and other evidence remain attached to the destination conversation.
// If Discord refuses an upload, forward the original URL instead of losing the text.
const NO_MENTIONS = Object.freeze({ parse: [] });
const MAX_ATTACHMENTS = 10;
const SAFE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

function collectMedia(message) {
  const values = message.attachments ? [...message.attachments.values()] : [];
  return values.slice(0, MAX_ATTACHMENTS).map((a, index) => {
    const url = String(a.url || "");
    let uploadable = false;
    try {
      const parsed = new URL(url);
      uploadable = parsed.protocol === "https:" && CDN_HOSTS.has(parsed.hostname) &&
        Number.isFinite(a.size) && a.size > 0 && a.size <= SAFE_ATTACHMENT_BYTES;
    } catch { /* Invalid URLs are ignored instead of being forwarded. */ }
    const validUrl = /^https:\/\/[^\s]+$/.test(url) ? url : "";
    const name = String(a.name || "attachment-" + (index + 1))
      .replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 100);
    return { url: validUrl, name, uploadable: uploadable && !!validUrl };
  }).filter(a => a.url);
}

async function sendRelay(target, embed, message, options = {}) {
  const attachments = collectMedia(message);
  const uploads = attachments.filter(a => a.uploadable);
  const links = attachments.filter(a => !a.uploadable);
  const payload = { embeds: [embed], allowedMentions: options.allowedMentions || NO_MENTIONS };
  if (options.content) payload.content = options.content;

  try {
    await target.send({
      ...payload,
      ...(uploads.length ? { files: uploads.map(a => ({ attachment: a.url, name: a.name })) } : {})
    });
  } catch (error) {
    if (!uploads.length) throw error;
    console.warn("Modmail native attachment upload failed; falling back to links:", error.message);
    await target.send(payload);
    links.push(...uploads);
  }
  // Oversize media, or media Discord could not reupload, must still reach staff/player.
  for (const item of links) {
    await target.send({ content: item.url, allowedMentions: NO_MENTIONS });
  }
}

module.exports = { collectMedia, sendRelay, SAFE_ATTACHMENT_BYTES };
