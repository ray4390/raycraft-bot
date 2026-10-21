"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { collectMedia, sendRelay, SAFE_ATTACHMENT_BYTES } = require("../src/ticketMedia");

function message(...attachments) {
  return { attachments: new Map(attachments.map((a,i) => [String(i), a])) };
}
function image(name = "screenshot.png", size = 1234) {
  return { url: "https://cdn.discordapp.com/attachments/123/456/" + encodeURIComponent(name), name, size };
}
test("text only relay preserves embed and no mentions", async () => {
  const sent = [];
  await sendRelay({ send: async p => sent.push(p) }, { description:"hi" }, message());
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.ok(!sent[0].files);
});
test("reuploads images in both directions using same relay helper", async () => {
  for (const direction of ["DM to staff forum","staff forum to DM"]) {
    const sent = [];
    const msg = message(image("build.png"), image("damage.jpg"));
    await sendRelay({ send: async p => sent.push(p) }, { description:direction }, msg);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].files.length, 2);
    assert.equal(sent[0].files[0].name, "build.png");
    assert.equal(sent[0].files[1].name, "damage.jpg");
    assert.ok(!sent[0].content);
  }
});
test("oversize evidence links while small images stay uploaded", async () => {
  const sent = [];
  await sendRelay({ send: async p => sent.push(p) }, {}, message(image("big.png", SAFE_ATTACHMENT_BYTES+1), image("small.png")));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].files.length, 1);
  assert.match(sent[1].content, /big.png/);
});
test("failed upload falls back to embed and links without discarding the message", async () => {
  const sent = [];
  let first = true;
  const target = { send: async p => {
    if (first) { first = false; throw new Error("Missing Attach Files"); }
    sent.push(p);
  }};
  await sendRelay(target, { description: "Report" }, message(image()));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].embeds, [{description: "Report"}]);
  assert.equal(sent[1].content, image().url);
});
test("mention stays scoped to claimant even after attachment fallback", async () => {
  const sent = [];
  await sendRelay({send: async p => sent.push(p)}, {}, message(image()), {
    content:"<@123456789012345678>",
    allowedMentions:{parse:[],users:["123456789012345678"]}
  });
  assert.equal(sent[0].allowedMentions.users.length,1);
  assert.equal(sent.length,1);
});
test("rejects unsafe attachment schemes and sanitizes filenames", () => {
  const found=collectMedia(message({url:"file:///etc/passwd",name:"bad",size:20},image("../proof.png")));
  assert.equal(found.length,1);
  assert.equal(found[0].name, ".._proof.png");
});
