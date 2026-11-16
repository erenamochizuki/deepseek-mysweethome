package com.xiaojingyu;

import com.mojang.logging.LogUtils;
import com.xiaojingyu.blacklist.BlacklistNet;
import com.xiaojingyu.build.BuildManager;
import com.xiaojingyu.build.BuildTickets;
import com.xiaojingyu.command.XjyCommands;
import com.xiaojingyu.config.CaptureConfig;
import com.xiaojingyu.furniture.ModFurniture;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import org.slf4j.Logger;

/**
 * Entry point of the "小鲸鱼之家" mod: the /xjy capture / place / undo / status / blacklist commands
 * (COMMANDS.md), the capture range setting ({@link CaptureConfig}, {@code config/xiaojingyu-common.toml}),
 * the packets of the blacklist screen ({@link BlacklistNet}) and the furniture blocks with
 * their creative tab (FURNITURE.md, {@link ModFurniture}). Loaded on clients and dedicated servers alike, so
 * nothing here touches client classes; the client-only part is {@code client/XiaojingyuClient}.
 */
@Mod(XiaojingyuMod.MOD_ID)
public final class XiaojingyuMod {
    public static final String MOD_ID = "xiaojingyu";
    public static final Logger LOGGER = LogUtils.getLogger();
    private static String version = "unknown";

    public XiaojingyuMod(IEventBus modEventBus, ModContainer modContainer) {
        version = modContainer.getModInfo().getVersion().toString();
        LOGGER.info("[xiaojingyu] mod loaded, version {}", version);
        CaptureConfig.register(modContainer);
        BuildTickets.register(modEventBus);
        ModFurniture.register(modEventBus);
        modEventBus.addListener(RegisterPayloadHandlersEvent.class, BlacklistNet::register);
        NeoForge.EVENT_BUS.addListener(RegisterCommandsEvent.class, e -> XjyCommands.register(e.getDispatcher()));
        NeoForge.EVENT_BUS.addListener(ServerTickEvent.Post.class, e -> BuildManager.tick(e.getServer()));
        NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> BuildManager.shutdown());
    }

    /** This mod's version, e.g. "0.1.0" (Source field of captured files). */
    public static String version() {
        return version;
    }
}
