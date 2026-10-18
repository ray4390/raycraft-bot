# RayCraftMetrics (read-only Paper metrics)

A standalone Paper plugin built with `mvn -B -ntp -f paper-metrics/pom.xml package`. The JAR is written to `paper-metrics/target/raycraft-metrics-0.1.0.jar`.

The Maven dependency targets Paper API 1.21.11 for build compatibility. **Verify the actual production Paper version and API compatibility before deploying**. This source has not yet been compiled or tested against production.

The plugin collects Paper's 1-minute TPS, average tick time (MSPT), and average connected player ping by reflection, and Bukkit's online-player count every 30 seconds. It atomically writes `plugins/RayCraftMetrics/status.json`. Unavailable metrics are JSON `null`. With no players online, average ping is `null`. No listener, command, RCON, public port, extra Java dependency, or private server access is introduced.

RayBot reads this file read-only on its 2-minute refresh, ignores stale samples (>2 minutes), and combines it with public edition-availability checks. Make sure RayBot's host account can read the file without changing the production directory's global permissions.

**Install only after build+test approval**: back up the existing plugin if one exists; copy the reviewed JAR into production's `plugins/` directory and allow the **next scheduled Paper restart** to load it. Do not use runtime plugin reloaders. RayBot itself can be restarted separately after setting `SERVER_STATUS_CHANNEL_ID` to the numeric #server-info channel ID.

The live site does not yet publish TPS/MSPT/ping: metrics stay local to the host for RayBot's embed.
