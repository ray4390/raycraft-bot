"use strict";

const fs = require("node:fs");
const path = require("node:path");

class Store {
  constructor(filename) {
    this.filename = path.resolve(filename);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.filename)) {
      this.state = JSON.parse(fs.readFileSync(this.filename, "utf8"));
    } else {
      this.state = { cases: [], tickets: [], counters: {}, blacklist: [] };
      this.save();
    }
    if (!Array.isArray(this.state.cases) || !Array.isArray(this.state.tickets) || !this.state.counters) {
      throw new Error("Invalid RayCraft state file; refusing to overwrite.");
    }
  }
  save() {
    const temp = this.filename + "." + process.pid + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temp, this.filename);
  }
  isBlacklisted(guildId, userId) {
    return (this.state.blacklist || []).some((item) => item.guildId === guildId && item.userId === userId);
  }
  setBlacklisted(guildId, userId, enabled) {
    const list = this.state.blacklist || [];
    this.state.blacklist = list.filter((item) => !(item.guildId === guildId && item.userId === userId));
    if (enabled) this.state.blacklist.push({ guildId, userId, at: new Date().toISOString() });
    this.save();
  }
  panelMessageId(channelId) {
    return this.state.panelMessages?.[channelId] || null;
  }
  setPanelMessage(channelId, messageId) {
    this.state.panelMessages ||= {};
    this.state.panelMessages[channelId] = messageId;
    this.save();
  }
  addCase(guildId, data) {
    const id = (this.state.counters[guildId] || 0) + 1;
    this.state.counters[guildId] = id;
    const record = { id, guildId, timestamp: new Date().toISOString(), ...data };
    this.state.cases.push(record);
    this.save();
    return record;
  }
  history(guildId, userId) {
    return this.state.cases.filter((item) => item.guildId === guildId && item.targetId === userId).slice(-15).reverse();
  }
  nextTicketNumber(guildId) {
    const key = "ticket:" + guildId;
    const number = (this.state.counters[key] || 0) + 1;
    this.state.counters[key] = number;
    this.save();
    return number;
  }
  activeTickets(guildId) {
    return this.state.tickets.filter((ticket) => ticket.guildId === guildId && ticket.status === "open");
  }
  openTicket(guildId, userId) {
    return this.state.tickets.find((ticket) => ticket.guildId === guildId && ticket.openerId === userId && ticket.status === "open");
  }
  ticketByChannel(channelId) {
    return this.state.tickets.find((ticket) => ticket.channelId === channelId && ticket.status === "open");
  }
  addTicket(ticket) {
    this.state.tickets.push({ ...ticket, status: "open", createdAt: new Date().toISOString(), claimedBy: null });
    this.save();
  }
  changeTicket(channelId, patch) {
    const ticket = this.ticketByChannel(channelId);
    if (!ticket) return null;
    Object.assign(ticket, patch);
    this.save();
    return ticket;
  }
}

module.exports = { Store };
