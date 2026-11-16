package com.xiaojingyu.command;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import org.jspecify.annotations.Nullable;

import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.xiaojingyu.blacklist.Blacklist;
import com.xiaojingyu.blacklist.BlacklistActions;
import com.xiaojingyu.blacklist.BlacklistNet;

import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

/**
 * {@code /xjy blacklist [add [方块] | remove [方块] | list | clear]} (COMMANDS.md §2a). Without a sub-command
 * a player gets the screen; the console gets the list.
 */
final class BlacklistCommand {
    /** list prints at most this many lines; the screen shows all. */
    private static final int LIST_LINES = 30;

    private BlacklistCommand() {
    }

    /** {@code /xjy blacklist}: open the screen (result = entries). Not a player (console) → same as list. */
    static int open(CommandSourceStack source) {
        ServerPlayer player = source.getPlayer();
        if (player == null || !BlacklistNet.canOpen(player)) {
            return list(source);
        }
        Blacklist.Snapshot s = Blacklist.get().snapshot();
        Component problem = BlacklistActions.problem(s);
        BlacklistNet.open(player, s, problem == null ? null : Msg.t("blacklist.gui.problem"));
        tell(source, problem);
        tell(source, BlacklistActions.skipped(s));
        return s.ids().size();
    }

    static int add(CommandSourceStack source, String id) throws CommandSyntaxException {
        return finish(source, BlacklistActions.add(source.getPlayer(), id));
    }

    /** {@code add} without a block: the block the crosshair is on (the outlined one). */
    static int addLooking(CommandSourceStack source) throws CommandSyntaxException {
        return add(source, looking(source));
    }

    static int remove(CommandSourceStack source, String id) throws CommandSyntaxException {
        return finish(source, BlacklistActions.remove(source.getPlayer(), id));
    }

    static int removeLooking(CommandSourceStack source) throws CommandSyntaxException {
        return remove(source, looking(source));
    }

    static int clear(CommandSourceStack source) throws CommandSyntaxException {
        return finish(source, BlacklistActions.clear(source.getPlayer()));
    }

    /** Result = entries on the list. */
    static int list(CommandSourceStack source) {
        Blacklist.Snapshot s = Blacklist.get().snapshot();
        tell(source, BlacklistActions.problem(s));
        List<String> ids = s.ids();
        if (ids.isEmpty()) {
            source.sendSuccess(() -> Msg.t("blacklist.list_empty"), false);
        } else {
            source.sendSuccess(() -> Msg.t("blacklist.list_header", ids.size()), false);
            for (String id : ids.subList(0, Math.min(LIST_LINES, ids.size()))) {
                source.sendSuccess(() -> entry(id), false);
            }
            if (ids.size() > LIST_LINES) {
                int more = ids.size() - LIST_LINES;
                source.sendSuccess(() -> Msg.t("blacklist.list_more", more), false);
            }
        }
        tell(source, BlacklistActions.skipped(s));
        MutableComponent link = BlacklistActions.fileLink(Blacklist.get().file());
        source.sendSuccess(() -> Msg.t("blacklist.list_file", link).withStyle(ChatFormatting.GRAY), false);
        return ids.size();
    }

    /** " - 石头 minecraft:stone"; click puts the remove command into the chat box. */
    private static Component entry(String id) {
        Component name = BlacklistActions.block(id).isPresent()
            ? BlacklistActions.name(id) : Msg.t("blacklist.list_unknown");
        String command = "/xjy blacklist remove " + id;
        return Msg.t("blacklist.list_entry", name, id).withStyle(style -> style
            .withClickEvent(new ClickEvent.SuggestCommand(command))
            .withHoverEvent(new HoverEvent.ShowText(Msg.t("blacklist.click_remove"))));
    }

    private static int finish(CommandSourceStack source, BlacklistActions.Outcome o) throws CommandSyntaxException {
        if (!o.ok()) {
            throw Msg.fail(o.chat());
        }
        // A change is announced to other operators too (like /gamerule); "already listed" only to the sender.
        source.sendSuccess(o::chat, o.changed());
        BlacklistNet.afterAction(source.getServer(), source.getPlayer(), o);
        return o.result();
    }

    private static String looking(CommandSourceStack source) throws CommandSyntaxException {
        ServerPlayer player = source.getPlayerOrException();
        double range = player.blockInteractionRange();
        HitResult hit = player.pick(range, 1.0F, false);
        if (!(hit instanceof BlockHitResult b) || hit.getType() != HitResult.Type.BLOCK) {
            throw Msg.fail("blacklist.no_target", (int) Math.floor(range));
        }
        Identifier key = BuiltInRegistries.BLOCK.getKey(player.level().getBlockState(b.getBlockPos()).getBlock());
        return key.toString();
    }

    private static void tell(CommandSourceStack source, @Nullable Component text) {
        if (text != null) {
            source.sendSuccess(() -> text, false);
        }
    }

    /** Tab for add: every block id except the ones that are air anyway. */
    static CompletableFuture<Suggestions> suggestBlocks(CommandContext<CommandSourceStack> c, SuggestionsBuilder builder) {
        return SharedSuggestionProvider.suggestResource(BuiltInRegistries.BLOCK.entrySet().stream()
            .filter(e -> !BlacklistActions.alwaysAir(e.getValue()))
            .map(e -> e.getKey().identifier()), builder, "");
    }

    /** Tab for remove: the ids on the list. */
    static CompletableFuture<Suggestions> suggestListed(CommandContext<CommandSourceStack> c, SuggestionsBuilder builder) {
        return SharedSuggestionProvider.suggestResource(Blacklist.get().snapshot().ids().stream()
            .map(Identifier::tryParse).filter(java.util.Objects::nonNull), builder, "");
    }
}
