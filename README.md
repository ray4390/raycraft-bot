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
