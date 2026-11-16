package com.xiaojingyu.probe;

import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.world.level.GameType;
import org.jspecify.annotations.Nullable;

/**
 * 客户端状态的快照。每个客户端 tick（ClientTickEvent.Post，Render thread）刷新一次，
 * HTTP 线程只读它，不碰游戏对象。GET /status 就是把它原样报出去。
 * 建世界、退世界时客户端不 tick，快照会停在旧值，snapshotAgeMs 会变大。
 */
public record ProbeSnapshot(
        boolean ready,
        @Nullable String screen,
        boolean inWorld,
        @Nullable Player player,
        @Nullable Boolean chunksRendered,
        int fps,
        boolean mouseGrabbed,
        boolean windowFocused,
        long takenAtNanos,
        @Nullable UUID playerId,
        @Nullable IntegratedServer server) {

    public record Player(double x, double y, double z, float yaw, float pitch, String dimension, @Nullable String gameMode) {
    }

    private static volatile ProbeSnapshot current =
            new ProbeSnapshot(false, null, false, null, null, 0, false, false, System.nanoTime(), null, null);

    /** 只在 Render thread 上读写。主菜单出现过一次以后一直是 true。 */
    private static boolean everReady;

    public static ProbeSnapshot current() {
        return current;
    }

    public long ageMs() {
        return Math.max(0, (System.nanoTime() - takenAtNanos) / 1_000_000L);
    }

    /** 在 Render thread 上调用。返回 true 表示这一次刚变成 ready。 */
    static boolean refresh(Minecraft mc) {
        Screen screen = mc.screen;
        boolean becameReady = false;
        if (!everReady && screen instanceof TitleScreen && mc.getOverlay() == null) {
            everReady = true;
            becameReady = true;
        }
        ClientLevel level = mc.level;
        LocalPlayer p = mc.player;
        boolean inWorld = level != null && p != null;
        Player player = null;
        Boolean chunksRendered = null;
        UUID playerId = null;
        if (inWorld) {
            MultiPlayerGameMode gm = mc.gameMode;
            GameType type = gm == null ? null : gm.getPlayerMode();
            player = new Player(p.getX(), p.getY(), p.getZ(), p.getYRot(), p.getXRot(),
                    level.dimension().identifier().toString(),
                    type == null ? null : type.getName());
            chunksRendered = mc.levelRenderer.hasRenderedAllSections();
            playerId = p.getUUID();
        }
        current = new ProbeSnapshot(everReady, screenName(screen), inWorld, player, chunksRendered,
                mc.getFps(), mc.mouseHandler.isMouseGrabbed(), mc.isWindowActive(),
                System.nanoTime(), playerId, mc.getSingleplayerServer());
        return becameReady;
    }

    /** 界面类的简单名；匿名类往上找第一个有名字的父类。 */
    static @Nullable String screenName(@Nullable Screen screen) {
        if (screen == null) {
            return null;
        }
        Class<?> c = screen.getClass();
        while (c.getSimpleName().isEmpty() && c.getSuperclass() != null) {
            c = c.getSuperclass();
        }
        return c.getSimpleName();
    }
}
