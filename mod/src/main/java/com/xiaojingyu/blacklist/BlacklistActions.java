package com.xiaojingyu.blacklist;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

import com.mojang.logging.LogUtils;
import com.xiaojingyu.command.Msg;

import net.minecraft.ChatFormatting;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.LiquidBlock;

/**
 * Adding, removing and clearing, shared by the {@code /xjy blacklist} commands and the screen (via
 * {@link BlacklistNet}). Checks the id, changes {@link Blacklist}, writes the log line and builds the texts.
 * Server thread.
 */
public final class BlacklistActions {
    private static final Logger LOGGER = LogUtils.getLogger();

    /**
     * @param ok      the request did what was asked, or there was nothing to do (already listed); false =
     *                refused (the command fails)
     * @param changed the list changed
     * @param chat    the full sentence for chat
     * @param gui     a short line for the screen
     * @param result  the command result: entries on the list afterwards (clear: entries removed)
     */
    public record Outcome(boolean ok, boolean changed, Component chat, Component gui, int result) {
        static Outcome refused(Component text) {
            return new Outcome(false, false, text, text, 0);
        }
    }

    private BlacklistActions() {
    }

    /** {@code who} is only for the log; null = the server console or a command block. */
    public static Outcome add(@Nullable ServerPlayer who, String raw) {
        String id = BlacklistFile.normalize(raw);
        if (id == null) {
            return Outcome.refused(Msg.t("blacklist.bad_id", raw));
        }
        Optional<Block> block = block(id);
        if (block.isEmpty()) {
            return Outcome.refused(Msg.t("blacklist.unknown_block", id));
        }
        if (alwaysAir(block.get())) {
            return Outcome.refused(Msg.t("blacklist.always_air", block.get().getName(), id));
        }
        Component name = block.get().getName();
        Blacklist.Change c;
        try {
            c = Blacklist.get().add(id);
        } catch (IOException e) {
            return saveFailed(e);
        }
        if (!c.changed()) {
            return new Outcome(true, false, Msg.t("blacklist.already", name, id), Msg.t("blacklist.gui.already", name), c.size());
        }
        LOGGER.info("[xiaojingyu] capture blacklist: {} added {} ({} blocks now)", whoName(who), id, c.size());
        return new Outcome(true, true, withBackup(Msg.t("blacklist.added", name, id, c.size()), c.backup()),
            Msg.t("blacklist.gui.added", name), c.size());
    }

    public static Outcome remove(@Nullable ServerPlayer who, String raw) {
        String id = BlacklistFile.normalize(raw);
        if (id == null) {
            return Outcome.refused(Msg.t("blacklist.bad_id", raw));
        }
        Component name = name(id);
        Blacklist.Change c;
        try {
            c = Blacklist.get().remove(id);
        } catch (IOException e) {
            return saveFailed(e);
        }
        if (!c.changed()) {
            return Outcome.refused(Msg.t("blacklist.not_listed", id));
        }
        LOGGER.info("[xiaojingyu] capture blacklist: {} removed {} ({} blocks now)", whoName(who), id, c.size());
        return new Outcome(true, true, withBackup(Msg.t("blacklist.removed", name, id, c.size()), c.backup()),
            Msg.t("blacklist.gui.removed", name), c.size());
    }

    public static Outcome clear(@Nullable ServerPlayer who) {
        Blacklist.Change c;
        try {
            c = Blacklist.get().clear();
        } catch (IOException e) {
            return saveFailed(e);
        }
        if (!c.changed()) {
            Component text = withBackup(Msg.t("blacklist.cleared_empty"), c.backup());
            return new Outcome(true, c.backup() != null, text, Msg.t("blacklist.cleared_empty"), 0);
        }
        LOGGER.info("[xiaojingyu] capture blacklist: {} cleared it ({} blocks removed)", whoName(who), c.removed());
        return new Outcome(true, true, withBackup(Msg.t("blacklist.cleared", c.removed()), c.backup()),
            Msg.t("blacklist.gui.cleared", c.removed()), c.removed());
    }

    /** The block with this id in this game, if there is one. */
    public static Optional<Block> block(String id) {
        Identifier key = Identifier.tryParse(id);
        return key == null ? Optional.empty() : BuiltInRegistries.BLOCK.getOptional(key);
    }

    /** Blocks that capture always writes as air anyway: air, liquids, bubble columns. Adding them is refused. */
    public static boolean alwaysAir(Block block) {
        return block.defaultBlockState().isAir() || block instanceof LiquidBlock || block == Blocks.BUBBLE_COLUMN;
    }

    /** The block's name, or the id itself for an id this game does not have. */
    public static Component name(String id) {
        return block(id).<Component>map(Block::getName).orElse(Component.literal(id));
    }

    /** The chat warning for an unreadable list file, or null when the file is fine. */
    public static @Nullable Component problem(Blacklist.Snapshot s) {
        BlacklistFile.Problem p = s.problem();
        if (p == null) {
            return null;
        }
        Component why = switch (p.code()) {
            case "syntax" -> p.line() > 0 ? Msg.t("blacklist.problem.syntax", p.line(), p.column())
                : Msg.t("blacklist.problem.syntax_somewhere");
            case "shape" -> Msg.t("blacklist.problem.shape");
            default -> Msg.t("blacklist.problem.io", p.detail());
        };
        return Msg.t("blacklist.file_problem", why, fileLink(Blacklist.get().file())).withStyle(ChatFormatting.GOLD);
    }

    /** The chat note about entries that are not block ids, or null when there are none. */
    public static @Nullable Component skipped(Blacklist.Snapshot s) {
        List<String> k = s.skipped();
        if (k.isEmpty()) {
            return null;
        }
        String some = String.join("，", k.subList(0, Math.min(3, k.size())));
        return Msg.t("blacklist.skipped", k.size(), some).withStyle(ChatFormatting.GOLD);
    }

    /** The path, underlined; click copies the full path (like capture's file name). */
    public static MutableComponent fileLink(Path file) {
        String full = file.toAbsolutePath().normalize().toString();
        return Component.literal(full).withStyle(style -> style
            .withUnderlined(true)
            .withColor(ChatFormatting.AQUA)
            .withClickEvent(new ClickEvent.CopyToClipboard(full))
            .withHoverEvent(new HoverEvent.ShowText(Msg.t("capture.copy_path"))));
    }

    private static Component withBackup(MutableComponent text, @Nullable Path backup) {
        return backup == null ? text : text.append(" ").append(Msg.t("blacklist.backup", fileLink(backup)));
    }

    private static Outcome saveFailed(IOException e) {
        LOGGER.warn("[xiaojingyu] capture blacklist could not be saved to {}", Blacklist.get().file(), e);
        return Outcome.refused(Msg.t("blacklist.save_failed", e.toString()));
    }

    private static String whoName(@Nullable ServerPlayer who) {
        return who == null ? "the server" : who.getName().getString();
    }
}
