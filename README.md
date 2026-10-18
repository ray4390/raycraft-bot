# RayCraft Bot

Independent Discord bot for the **RayCraft** Minecraft community. Production code is maintained on `main`; no CI or test-suite launch gates.

## Features

- Rule reminders via `/rulereminder` or a message's **Rules Reminder** context menu.
- Moderator warnings, timeouts, kicks, bans, message cleanup, case history and incidents.
- Player help via `/rules` and `/connect`.
- PoliBot-inspired **forum modmail**: `/openticket` / `/ticket open`; private DMs, staff forum threads, claim/unclaim, takeover, staff contact, blacklist, optional pings, and ticket reminders. Staff thread messages relay to the player by DM; prefix internal notes with `//`.

## Deployment with PM2 (Debian / ray-optiplex)

Working directory: `/home/ray/raycraft-bot`.

Use Node.js 20 or later and install dependencies with `npm install`. Set up credentials in an untracked `.env` file (mode `600`), based on `.env.example`. Do not commit or print the token.

**Switch an existing systemd installation to PM2:**

```bash
cd /home/ray/raycraft-bot
git pull --ff-only
systemctl --user disable --now raycraft-bot.service
systemctl --user reset-failed raycraft-bot.service
pm2 start src/index.js --name raycraft-bot --cwd /home/ray/raycraft-bot
pm2 save
pm2 logs raycraft-bot --nostream --lines 35
```

If `raycraft-bot` already exists under PM2, use `pm2 restart raycraft-bot` instead of creating a second process.

### Commands

```bash
pm2 status
pm2 logs raycraft-bot --lines 50
pm2 restart raycraft-bot
```

This bot runs separately from PoliBot. The PM2 startup service configured for the `ray` account manages saved processes across host restarts.

## Forum permissions

The configured `TICKET_FORUM_ID` **must not be visible to @everyone**. The bot refuses to open tickets when the forum is public to @everyone, but it allows additional explicitly permitted roles (such as the server owner's personal role). **Review every role that can view the forum** because they can see all player reports and appeals. Helpers can view appeals in this shared forum; only Moderators may process them. A separate appeals forum would be necessary for strict appeal confidentiality.

The bot requires permission to view and post in the forum and threads; it uses Discord DMs to communicate with ticket openers. Enable Server Members Intent and Message Content Intent in the Discord Developer Portal. Keep the bot's Discord role above players it must moderate, but do not grant Administrator.

No Minecraft server management, RCON, or shell execution is included. Runtime case/ticket data is saved outside Git under `data/`.

## Utilities (v0.2)

| Command | Access | Purpose |
|---|---|---|
| `/ping` | Everyone | Discord gateway and API latency |
| `/help` | Everyone | Interactive, permission-aware command menu |
| `/about` | Everyone | Version and uptime |
| `/status` | Helpers and Moderators | Health and memory |
| `/modhelp` | Helpers and Moderators | Staff command reference |
| `/reload` | Discord Administrators | Reload `config/rules.json` and sync guild commands; not executable code or .env |
| `/botlogs` | Discord Administrators | Safe in-memory events; no raw logs or secrets |
| `/restart` | Server owner only | Confirm a RayBot-only process restart through PM2 |

Updates to JavaScript and environment settings still require `git pull --ff-only && pm2 restart raycraft-bot`. There is no automated test workflow.

## Ticket opening panel

On startup, RayBot checks Discord channel `1561444742812794940` for its Open a Ticket message and posts or refreshes it without duplication. Use `/ticketpanel` as a Discord administrator to force a refresh. The button DMs the player a ticket category picker; resulting tickets are kept in the private staff forum. The bot needs View Channel, Read Message History, Send Messages, and Embed Links in the public panel channel. Set `TICKET_PANEL_CHANNEL_ID` in `.env` to override the default channel.

## Rules and custom presence

`config/rules.json` now contains the eight approved RayCraft rules verbatim; `/rules` and rule reminders use those texts. RayBot rotates **Custom** activities only, every 45 minutes, beginning at startup. Status messages are in `src/presence.js`; no Playing, Watching, or Listening activities are used.

## Modmail presentation and staff notifications

RayBot uses a PoliBot-style ticket experience adapted for RayCraft: **yellow category DM**, modal reason form, **yellow ticket confirmation**, **green opened-ticket confirmation and instructions**, **green forum starter card**, color-coded claim/unclaim/close notices, claimant ping preferences, and **blue two-way message embeds** with delivery reactions. New player tickets mention **Moderators** for appeals, and **Moderators + Helpers** for other categories, in the forum starter post and in unclaimed reminder posts.

**Ticket events are not copied into the staff logs channel.** The ticket forum thread and the player's DMs are the record of ticket activity. Ordinary non-ticket moderation audits remain unaffected.

For role notifications to reach staff, RayBot must be permitted to mention the configured roles in the ticket forum. If they are not mentionable, give RayBot the appropriate role-mention permission for that forum instead of making all roles publicly mentionable.

The **Open a Ticket** button acknowledges the interaction immediately before checking permissions or sending DMs, avoiding Discord's misleading "did not respond" failure. The existing ticket panel will be refreshed when RayBot starts; no additional setup command is required.

## PoliBot-style rule reminders

`/rulereminder` and right-click **Apps → Rules Reminder** now use Discord Components V2 white-accented panels, the same numbered rule-button selection layout as PoliBot (adapted to RayCraft's eight published rules), **General Reminder**, and **Cancel**. This replaces the old dropdown/preview workflow: clicking a numbered rule posts the reminder directly and shows **Reminder Sent**. Prompts expire after two minutes and only the initiating staff member can submit them.

Reminders are styled sectioned posts with numbered rule headings, the official rule wording, a clear **not an official warning** notice, and **Get More Info**. More Info explains each RayCraft rule and links into private modmail. Message-context reminders reply to the selected message, mention its author, and display **Flagged Message** linking to it. `/rulereminder` posts a channel-wide reminder. Nonpunitive reminder history remains separate from formal moderation sanctions. Unlike PoliBot's political-community rules, RayBot only shows RayCraft's eight actual rules—no Politics-only channel or language rules.

## Minecraft live status

RayBot provides a public `/serverstatus` command for Java and Bedrock health and online player count, using the same read-only `https://raycraftmc.com/api/status` endpoint as the website. This is separate from the staff-only `/status` command, which reports RayBot's process health.

The endpoint is a Cloudflare Pages Function in `ray4390/Raycraft-Website/functions/api/status.js`. It queries the public status API from mcstatus.io (no Minecraft console/RCON credentials), caches each response for about 60 seconds per Cloudflare edge, and reports `unknown` if the upstream provider fails instead of falsely asserting the server is down.

After website deployment, confirm `https://raycraftmc.com/api/status` returns JSON with `java`, `bedrock`, and `checkedAt`. Then update the bot from `main` with `cd /home/ray/raycraft-bot && git pull --ff-only && pm2 restart raycraft-bot`. Restarting RayBot registers the new slash command; this does not restart Minecraft or other PM2 processes.
