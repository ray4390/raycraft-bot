# RayCraft Bot

Independent Discord moderation and community-support bot for **RayCraft**, adapted from ideas and workflows in [PoliBot](https://github.com/ray4390/politibot) but intentionally isolated from the Operation Politics server.

**Status:** Initial functional code, not deployed. No Discord application, production credentials, guild role IDs, or channel IDs have been configured. This repository is public; **never commit secrets or the data file.**

## Features

- **Non-punitive rule reminders:** Staff can use \`/rulereminder\` or right-click a message → **Apps → Rules Reminder**. Choose a RayCraft rule or general reminder, preview it, and confirm it before posting. Replies address the selected author; the slash command posts to the current channel. Reminders are recorded as type \`reminder\`, never as official warnings or automatic sanctions. A short per-staff/channel cooldown discourages spam.
- **Formal moderation:** \`/warn\`, \`/timeout\`, \`/kick\`, \`/ban\`, \`/purge\`; each action is limited to moderators and respects hierarchy. \`/history\` lets staff view case records and \`/incident\` records a private, non-disciplinary observation.
- **Private support tickets:** \`/ticket open\` creates a private text channel in a configured category with access for the opening user, Helpers, and Moderators. Helpers can \`/ticket claim\`; staff or the opener can \`/ticket close\`. Closure disables the opener's ability to send new messages but retains the channel/messages for review. No automatic deletion.
- **Player help:** \`/rules\` and \`/connect\` show RayCraft rules, Java/Bedrock connection details, and BlueMap.

## Role access

| Action | Member | Helper | Moderator |
|---|:---:|:---:|:---:|
| Read rules / connection info | Yes | Yes | Yes |
| Open / close own ticket | Yes | Yes | Yes |
| View / claim other tickets | — | Yes | Yes |
| Send rule reminders | — | Yes | Yes |
| Record private incidents / view history | — | Yes | Yes |
| Warn / timeout / kick / ban / purge | — | — | Yes |

Guild owner and members with Discord Administrator permission are considered moderators. This does not grant Helper accounts Administrator privileges. Staff role access is controlled by *Discord role IDs*, not user-supplied strings.

## Setup (not yet deployed)

1. Create a new **RayCraft** Discord application and bot, separate from the PoliBot application. Enable the **Server Members Intent** in the Developer Portal; Message Content Intent is not required for these commands.
2. Invite it to the RayCraft Discord with the \`bot\` and \`applications.commands\` scopes. Grant only necessary bot permissions: View Channels, Send Messages, Read Message History, Embed Links, Manage Channels (tickets), Manage Messages (purge), Moderate Members (timeout), Kick Members and Ban Members. Do not grant Administrator. Put the bot role above members it must moderate and below owner/administrative roles.
3. Prepare a private ticket category and an optional private staff-log channel. Give Helpers and Moderators roles appropriate for access.
4. Copy \`.env.example\` to \`.env\`. Fill \`DISCORD_TOKEN\`, \`GUILD_ID\`, \`MODERATOR_ROLE_IDS\`, and optional IDs. **Never reuse the PoliBot token, config.json or MongoDB database.**
5. Install Node.js 20+ and run:

    npm install
    npm test
    npm start

The bot registers commands **only** within \`GUILD_ID\`. The state database is a separate local JSON file under \`data/\` (or \`DATA_FILE\`), written by atomic rename. Back up that file; do not store it in Git. Only run one RayCraft Bot process against the same state file.

## Rules

\`config/rules.json\` contains starter summaries of known RayCraft gameplay principles. **Review and align every entry with the final published Discord/server rules before launch**. These summaries are not a substitute for the actual rulebook. Normal efficient survival gameplay is not automatically disallowed; large farms, AFK farming, lag devices and exploits are addressed separately.

## Production safety

- Zero automatic sanctions or account-age kicks.
- No cross-guild operation; independent bot token and storage.
- No remote shell, Minecraft console, RCON, plugin changes, configuration writes, server restarts, or server/world access.
- No AI auto-enforcement, no hidden message surveillance and no bulk import of PoliBot's political commands.
- Public source repository: review code and test with a non-production Discord guild before inviting it to RayCraft.

## Next phase

Add tested deployment, live server-status read-only integration, staff ticket improvements (appeal routing and transcript export), and explicit audit log durability checks. Do not enable Minecraft-side actions by default.
