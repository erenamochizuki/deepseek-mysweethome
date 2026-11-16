package com.xiaojingyu.client;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import org.jspecify.annotations.Nullable;

import com.xiaojingyu.blacklist.BlacklistNet;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.StringWidget;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.client.gui.ConfigurationScreen;

/**
 * The page of 模组 → 小鲸鱼之家 → 配置. It is NeoForge's own config page (each capture number has a range, so it is a
 * slider; name and one-line help come from {@code xiaojingyu.configuration.*} in the lang files; 取消 / 重置 / 完成,
 * and 完成 writes {@code config/xiaojingyu-common.toml}) with two extra rows at the bottom:
 * <ul>
 *   <li>抓取黑名单 [打开…]: asks the server to open the blacklist screen (the same as typing {@code /xjy blacklist});
 *       only in a world, with permission level 2, on a server that has this mod. Its 完成 comes back here.</li>
 *   <li>On a server that is not this game's own: a note that this page only changes this computer's file; the
 *       server uses its own {@code config/xiaojingyu-common.toml} ({@code /xjy status} shows what it uses).</li>
 * </ul>
 */
public final class CaptureConfigScreen extends ConfigurationScreen.ConfigurationSectionScreen {
    private static final String KEY = "xiaojingyu.configuration.";

    public CaptureConfigScreen(Screen parent, ModConfig.Type type, ModConfig modConfig, Component title) {
        super(parent, type, modConfig, title);
    }

    @Override
    protected Collection<? extends Element> createSyntheticValues() {
        List<Element> extra = new ArrayList<>();
        Minecraft mc = Minecraft.getInstance();
        Component why = blacklistUnavailable(mc);
        Button open = Button.builder(Component.translatable(KEY + "blacklist.button"), b -> openBlacklist())
            .width(Button.DEFAULT_WIDTH).build();
        open.active = why == null;
        Component tip = Component.translatable(KEY + "blacklist.tooltip");
        open.setTooltip(Tooltip.create(why == null ? tip : Component.empty().append(tip).append("\n\n").append(why)));
        extra.add(new Element(Component.translatable(KEY + "blacklist"), tip, open, false));
        ClientPacketListener connection = mc.getConnection();
        if (connection != null && !mc.isLocalServer()) {
            StringWidget note = new StringWidget(Button.DEFAULT_WIDTH, Button.DEFAULT_HEIGHT,
                Component.translatable(KEY + "on_server").withStyle(ChatFormatting.YELLOW), font);
            Component noteTip = Component.translatable(KEY + "on_server.tooltip");
            note.setTooltip(Tooltip.create(noteTip));
            extra.add(new Element(Component.translatable(KEY + "on_server.label"), noteTip, note, false));
        }
        return extra;
    }

    /** Why the blacklist button is greyed out, or null when it works. */
    private static @Nullable Component blacklistUnavailable(Minecraft mc) {
        LocalPlayer player = mc.player;
        ClientPacketListener connection = mc.getConnection();
        if (player == null || connection == null) {
            return Component.translatable(KEY + "blacklist.not_in_world").withStyle(ChatFormatting.RED);
        }
        if (!connection.hasChannel(BlacklistNet.Sync.TYPE)) {
            return Component.translatable(KEY + "blacklist.no_mod").withStyle(ChatFormatting.RED);
        }
        if (!Commands.LEVEL_GAMEMASTERS.check(player.permissions())) {
            return Component.translatable(KEY + "blacklist.no_permission").withStyle(ChatFormatting.RED);
        }
        return null;
    }

    /**
     * Keeps what was changed here (written now, like 完成 would), then sends {@code /xjy blacklist}; the server
     * answers with the list and the blacklist screen opens on top of this one ({@link BlacklistScreen#onSync}).
     * Works while single player is paused: the integrated server still runs the commands it gets.
     */
    private void openBlacklist() {
        if (changed) {
            context.modSpec().save();
            changed = false;
        }
        LocalPlayer player = minecraft.player;
        if (player != null) {
            player.connection.sendCommand("xjy blacklist");
        }
    }

    /** The blacklist screen goes back here when it was opened from this page. */
    static boolean isOpen(Screen screen) {
        return screen instanceof CaptureConfigScreen;
    }
}
