package com.xiaojingyu.client;

import com.xiaojingyu.XiaojingyuMod;
import com.xiaojingyu.blacklist.BlacklistNet;
import com.xiaojingyu.photo.PhotoBlockEntities;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;
import net.neoforged.neoforge.client.event.RenderFrameEvent;
import net.neoforged.neoforge.client.gui.ConfigurationScreen;
import net.neoforged.neoforge.client.gui.IConfigScreenFactory;
import net.neoforged.neoforge.client.network.event.RegisterClientPayloadHandlersEvent;
import net.neoforged.neoforge.common.NeoForge;

/**
 * The client-only half of the mod: FML constructs it only on the client ({@code dist = Dist.CLIENT}), so a
 * dedicated server never loads this package. Everything that touches {@code net.minecraft.client} (the
 * blacklist screen, the config page, the photo renderer and its textures) lives in {@code com.xiaojingyu.client};
 * the common code never refers to it (cmdTest's ClientSplit check scans the compiled classes for that).
 */
@Mod(value = XiaojingyuMod.MOD_ID, dist = Dist.CLIENT)
public final class XiaojingyuClient {
    public XiaojingyuClient(IEventBus modEventBus, ModContainer container) {
        modEventBus.addListener(RegisterClientPayloadHandlersEvent.class,
            e -> e.register(BlacklistNet.Sync.TYPE, (sync, context) -> BlacklistScreen.onSync(sync)));
        // 模组 → 小鲸鱼之家 → 配置: NeoForge's config page for config/xiaojingyu-common.toml (only one file, so it
        // opens that file's page straight away), with our extra rows at the bottom (CaptureConfigScreen).
        container.registerExtensionPoint(IConfigScreenFactory.class,
            (mod, parent) -> new ConfigurationScreen(mod, parent, CaptureConfigScreen::new));
        // Photos on the photo frame and the picture frames (docs/PHOTOS.md §4).
        modEventBus.addListener(EntityRenderersEvent.RegisterRenderers.class, e -> {
            e.registerBlockEntityRenderer(PhotoBlockEntities.FRAME.get(), PhotoRenderer::new);
            e.registerBlockEntityRenderer(PhotoBlockEntities.PICTURE_FRAMES.get(), PhotoRenderer::new);
        });
        NeoForge.EVENT_BUS.addListener(RenderFrameEvent.Pre.class, e -> PhotoTextures.onFrame());
        NeoForge.EVENT_BUS.addListener(ClientTickEvent.Post.class, e -> PhotoTextures.onTick());
        NeoForge.EVENT_BUS.addListener(ClientPlayerNetworkEvent.LoggingOut.class, e -> PhotoTextures.clear());
    }
}
