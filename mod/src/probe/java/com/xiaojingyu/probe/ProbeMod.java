package com.xiaojingyu.probe;

import com.mojang.logging.LogUtils;
import java.nio.file.Path;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModList;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderFrameEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.NeoForgeVersion;
import net.neoforged.neoforge.event.GameShuttingDownEvent;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

/**
 * 开发专用的探针模组：只在 gradlew runClient 里加载，不进发布 jar。
 * 在游戏里开一个本机 HTTP 服务（docs/PROBE.md），给 Node 脚本做自动验收用。
 *
 * <p>时机：客户端初始化（FMLClientSetupEvent）时起服务并写 run/xjyprobe.json；
 * 每个客户端 tick 刷新 /status 用的快照，主菜单第一次出现后 ready=true；
 * 正常退出（GameShuttingDownEvent）时关服务、删文件，JVM shutdown hook 兜底。
 */
@Mod(value = ProbeMod.MOD_ID, dist = Dist.CLIENT)
public final class ProbeMod {
    public static final String MOD_ID = "xjyprobe";
    public static final Logger LOGGER = LogUtils.getLogger();

    private static volatile @Nullable ProbeServer server;
    private static volatile String mcVersion = "unknown";
    private static volatile String neoForgeVersion = "unknown";
    private static boolean tickErrorLogged;

    public ProbeMod(IEventBus modEventBus) {
        // 锁输入（InputLock）：启动参数 -Dxjyprobe.lockInput=true 时一启动就锁上。
        boolean lockInput = Boolean.getBoolean("xjyprobe.lockInput");
        InputLock.lockFromStart(lockInput);
        modEventBus.addListener(FMLClientSetupEvent.class, ProbeMod::onClientSetup);
        NeoForge.EVENT_BUS.addListener(ClientTickEvent.Post.class, ProbeMod::onClientTick);
        NeoForge.EVENT_BUS.addListener(RenderFrameEvent.Pre.class, e -> InputLock.onFrame());
        // /screenshot 的 hideGui 要数完整画完的帧（HiddenGuiShot）。
        NeoForge.EVENT_BUS.addListener(RenderFrameEvent.Pre.class, e -> HiddenGuiShot.onFrameStart());
        NeoForge.EVENT_BUS.addListener(RenderFrameEvent.Post.class, e -> HiddenGuiShot.onFrameEnd());
        NeoForge.EVENT_BUS.addListener(GameShuttingDownEvent.class, e -> stopServer());
        LOGGER.info("[xjyprobe] dev probe loaded (input {})", lockInput ? "locked from start" : "not locked");
    }

    static String mcVersion() {
        return mcVersion;
    }

    static String neoForgeVersion() {
        return neoForgeVersion;
    }

    private static void onClientSetup(FMLClientSetupEvent event) {
        mcVersion = SharedConstants.getCurrentVersion().name();
        neoForgeVersion = ModList.get().getModContainerById("neoforge")
                .map(c -> c.getModInfo().getVersion().toString())
                .orElseGet(NeoForgeVersion::getVersion);

        int port = Integer.getInteger("xjyprobe.port", 0);
        if (port < 0 || port > 65535) {
            LOGGER.warn("[xjyprobe] xjyprobe.port={} is out of range, using a random port", port);
            port = 0;
        }
        Path info = FMLPaths.GAMEDIR.get().resolve("xjyprobe.json");
        try {
            ProbeServer s = ProbeServer.start(port, info);
            server = s;
            Runtime.getRuntime().addShutdownHook(new Thread(() -> s.stop(false), "xjyprobe-shutdown"));
            LOGGER.info("[xjyprobe] listening on http://127.0.0.1:{}/ (MC {}, NeoForge {}), info file {}",
                    s.port(), mcVersion, neoForgeVersion, s.infoFile());
            // 用来判断 build.gradle 里的 --add-modules=jdk.httpserver 是否真的需要。
            LOGGER.info("[xjyprobe] probe module: {}; jdk.httpserver in boot layer: {}; main module: {}",
                    ProbeMod.class.getModule(), ModuleLayer.boot().findModule("jdk.httpserver").isPresent(),
                    System.getProperty("jdk.module.main"));
        } catch (Exception | LinkageError e) {
            LOGGER.error("[xjyprobe] could not start the probe HTTP server", e);
        }
    }

    /** 每个客户端 tick（Render thread）刷新一次快照。 */
    private static void onClientTick(ClientTickEvent.Post event) {
        try {
            if (ProbeSnapshot.refresh(Minecraft.getInstance())) {
                LOGGER.info("[xjyprobe] ready: title screen is up");
            }
        } catch (RuntimeException e) {
            if (!tickErrorLogged) {
                tickErrorLogged = true;
                LOGGER.error("[xjyprobe] refreshing the status snapshot failed (logged once)", e);
            }
        }
    }

    private static void stopServer() {
        ProbeServer s = server;
        if (s != null) {
            s.stop(true);
        }
    }
}
