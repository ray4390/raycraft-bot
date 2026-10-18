# RayCraft Bot

Independent Discord moderation and community-support bot for **RayCraft**, adapted from ideas and workflows in [PoliBot](https://github.com/ray4390/politibot) but intentionally isolated from the Operation Politics server.

**Status:** Forum-modmail implementation, not deployed. Configure a separate Discord application and credentials privately on the host. This repository is public; **never commit secrets or the data file.**

## Features

- **Non-punitive rule reminders:** Staff can use `/rulereminder` or right-click a message → **Apps → Rules Reminder**. Choose a RayCraft rule or general reminder, preview it, and confirm it before posting. Replies address the selected author; the slash command posts to the current channel. Reminders are recorded as type `reminder`, never as official warnings or automatic sanctions. A short per-staff/channel cooldown discourages spam.
- **Formal moderation:** `/warn`, `/timeout`, `/kick`, `/ban`, `/purge`; each action is limited to moderators and respects hierarchy. `/history` lets staff view case records and `/incident` records a private, non-disciplinary observation.
- **PoliBot-style forum modmail:** `/openticket` or `/ticket open` DM a category menu; users choose a category, enter an explanation in a modal, then confirm. A post is created in the private staff forum and tagged by category/unclaimed. Players reply through DMs; staff respond in the forum thread. Messages and attachment links relay both ways with ✅/❌ delivery reactions. Forum claim/unclaim/takeover/close buttons, optional claimant ping preferences, 2-hour unclaimed reminders, 12-hour claimed reminders and automatic unclaim after two unanswered warnings. Ticket threads are archived on close, never automatically deleted. Staff-only notes can be prefixed `//`.
- **Player help:** `/rules` and `/connect` show RayCraft rules, Java/Bedrock connection details, and BlueMap.

## Role access

| Action | Member | Helper | Moderator |
|---|:---:|:---:|:---:|
| Read rules / connection info | Yes | Yes | Yes |
| Open a modmail ticket | Yes | Yes | Yes |
| View / claim standard tickets | — | Yes | Yes |
| Close tickets / send staff replies | — | Yes | Yes |
| Handle appeal tickets | — | Read-only* | Yes |
| Send rule reminders | — | Yes | Yes |
| Record private incidents / view history | — | Yes | Yes |
| Warn / timeout / kick / ban / purge | — | — | Yes |

*Helpers may still see appeals because all posts inherit the same forum's visibility; only Moderators can claim, relay, or close them. Use a separate appeal forum for stricter secrecy.*

Guild owner and members with Discord Administrator permission are considered moderators. This does not grant Helper accounts Administrator privileges. Staff role access is controlled by *Discord role IDs*, not user-supplied strings.

## Setup (not yet deployed)

For Debian, `scripts/install-user-service.sh` installs the bot as its own **non-root user systemd service**. It prompts for the private token with input hidden and runs tests before configuring the service. Pass the nonsecret Discord IDs through environment variables (see `.env.example`). The installer refuses to overwrite existing `.env` or service files.

1. Create a new **RayCraft** Discord application and bot, separate from the PoliBot application. Enable **Server Members Intent** and **Message Content Intent** in the Developer Portal. Both are used by the bot.
2. Invite it to the RayCraft Discord with the `bot` and `applications.commands` scopes. Grant only necessary bot permissions: View Channels, Send Messages, Read Message History, Embed Links, Manage Channels (tickets), Manage Messages (purge), Moderate Members (timeout), Kick Members and Ban Members. Do not grant Administrator. Put the bot role above members it must moderate and below owner/administrative roles.
3. Prepare a **private staff-only forum** (not a category). **Deny View Channel to @everyone** and give Helpers, Moderators, and the bot access to the forum. Individual forum posts inherit the parent forum's visibility; a public forum is unsafe for private player reports. The bot checks this setting at startup and before forwarding DMs. Optional forum tags: `claimed`, `unclaimed`, `help`, `report`, `appeal`, `technical`, `other`. Enable Message Content Intent in the Discord Developer Portal so staff forum messages and player DMs can be relayed.
4. Copy `.env.example` to `.env`. Fill `DISCORD_TOKEN`, `BOT_APPLICATION_ID`, `GUILD_ID`, `MODERATOR_ROLE_IDS`, `HELPER_ROLE_IDS`, `TICKET_FORUM_ID`, `MOD_LOG_CHANNEL_ID` and optional `RULES_CHANNEL_ID`. **Never reuse the PoliBot token, config.json or MongoDB database.**
5. Install Node.js 20+ and run:

    npm install
    npm test
    npm start

The bot registers commands **only** within `GUILD_ID`. The state database is a separate local JSON file under `data/` (or `DATA_FILE`), written by atomic rename. Back up that file; do not store it in Git. Only run one RayCraft Bot process against the same state file.

## Rules

`config/rules.json` contains starter summaries of known RayCraft gameplay principles. **Review and align every entry with the final published Discord/server rules before launch**. These summaries are not a substitute for the actual rulebook. Normal efficient survival gameplay is not automatically disallowed; large farms, AFK farming, lag devices and exploits are addressed separately.

## Production safety

- Zero automatic sanctions or account-age kicks. Automatic ticket unclaiming is administrative queue management, not a player penalty.
- No cross-guild operation; independent bot token and storage.
- No remote shell, Minecraft console, RCON, plugin changes, configuration writes, server restarts, or server/world access.
- No AI auto-enforcement, no hidden message surveillance and no bulk import of PoliBot's political commands. Modmail intentionally forwards DM and staff ticket messages for support; it does not scan regular community chat.
- Public source repository: review code and test with a non-production Discord guild before inviting it to RayCraft.

## Next phase

Add tested deployment, live server-status read-only integration, staff ticket improvements (appeal routing and transcript export), and explicit audit log durability checks. Do not enable Minecraft-side actions by default.

## Forum modmail privacy note

**Tickets are visible to all members who can view the configured forum.** The bot validates @everyone, other roles, and the specified staff roles before starting. Helpers are staff; they can see appeal tickets even though only Moderators can claim, relay, or close those appeals. For restricted appeals, use a second forum with stricter permissions in a future version. Bot access requires View Channel, Send Messages, Send Messages in Threads, Read Message History, Embed Links, Manage Threads/Manage Messages (archive, pin, and cleanup). It does not require Administrator. Messages beginning with `//` in the forum are staff-only notes and are not forwarded to the player.

No secret values or credentials are stored in this repository.
