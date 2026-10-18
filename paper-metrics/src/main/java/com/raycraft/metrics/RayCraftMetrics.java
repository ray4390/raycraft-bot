package com.raycraft.metrics;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Locale;

public final class RayCraftMetrics extends JavaPlugin {
    @Override public void onEnable() {
        getDataFolder().mkdirs();
        // Reads Bukkit/Paper in the server tick thread. No commands, network access or listeners.
        Bukkit.getScheduler().runTaskTimer(this, this::sample, 20L, 600L);
    }
    private static Double numberMethod(Object object, String method) {
        try {
            Method m = object.getClass().getMethod(method);
            Object value = m.invoke(object);
            return value instanceof Number n && Double.isFinite(n.doubleValue()) ? n.doubleValue() : null;
        } catch (ReflectiveOperationException | SecurityException ignored) { return null; }
    }
    private static Double tps() {
        try {
            Method m = Bukkit.getServer().getClass().getMethod("getTPS");
            Object result = m.invoke(Bukkit.getServer());
            if (result instanceof double[] values && values.length > 0 &&
                 Double.isFinite(values[0])) return values[0];
        } catch (ReflectiveOperationException | SecurityException ignored) { }
        return null;
    }
    private static String numeric(Double n) { return n == null ? "null" : String.format(Locale.ROOT, "%.3f", n); }
    private void sample() {
        Collection<? extends Player> players = Bukkit.getOnlinePlayers();
        double totalPing = 0;
        int pings = 0;
        for (Player player : players) {
            Double ping = numberMethod(player, "getPing");
            if (ping != null && ping >= 0 && ping < 60000) { totalPing += ping; pings++; }
        }
        String payload = "{\"timestamp\":\"" + Instant.now() +
           "\",\"players\":" + players.size() +
           ",\"tps\":" + numeric(tps()) +
           ",\"mspt\":" + numeric(numberMethod(Bukkit.getServer(), "getAverageTickTime")) +
           ",\"avgPingMs\":" + numeric(pings == 0 ? null : totalPing / pings) + "}\n";
        Path destination = getDataFolder().toPath().resolve("status.json");
        Path temp = getDataFolder().toPath().resolve("status.json.tmp");
        try {
            Files.writeString(temp, payload, StandardCharsets.UTF_8);
            try { Files.move(temp, destination, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (java.nio.file.AtomicMoveNotSupportedException ex) {
                Files.move(temp, destination, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception ex) {
            getLogger().warning("Metrics write failed: " + ex.getClass().getSimpleName());
        }
    }
}