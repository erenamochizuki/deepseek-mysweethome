package com.xiaojingyu.command;

import java.util.concurrent.CompletableFuture;

import org.jspecify.annotations.Nullable;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.xiaojingyu.build.CaptureRange;
import com.xiaojingyu.build.FileNames;
import com.xiaojingyu.config.CaptureConfig;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.IdentifierArgument;

/** The {@code /xjy} command tree (COMMANDS.md). Needs permission level 2 (single player with cheats is). */
public final class XjyCommands {
    private static final String FRONT = "前";
    private static final String BACK = "后";
    private static final String SIDE = "左右";
    private static final String HEIGHT = "高";
    private static final String NAME = "名字";
    private static final String FILE = "文件";
    private static final String BLOCK = "方块";
    /** {@code /xjy capture 上次} (COMMANDS.md §2b); Brigadier matches a literal up to the next space, Chinese works. */
    static final String LAST = "上次";
    static final String LAST_EN = "last";
    /** {@code /xjy capture 范围 <前> <后> <左右> <高> [名字…]} (COMMANDS.md §2): all four numbers, nothing from the config. */
    static final String RANGE = "范围";
    static final String RANGE_EN = "range";

    private XjyCommands() {
    }

    /** {@code capture 上次|last [名字…]}: the box of the player's last finished place. */
    private static LiteralArgumentBuilder<CommandSourceStack> captureLast(String word) {
        return Commands.literal(word)
            .executes(c -> CaptureCommand.runLast(c.getSource(), null))
            .then(Commands.argument(NAME, StringArgumentType.greedyString())
                .executes(c -> CaptureCommand.runLast(c.getSource(), StringArgumentType.getString(c, NAME))));
    }

    /** {@code capture 范围|range <前> <后> <左右> <高> [名字…]}: starts with a word, so a name may start with a digit. */
    private static LiteralArgumentBuilder<CommandSourceStack> captureRange(String word) {
        return Commands.literal(word)
            .then(Commands.argument(FRONT, IntegerArgumentType.integer(CaptureRange.MIN_FRONT, CaptureRange.MAX))
                .then(Commands.argument(BACK, IntegerArgumentType.integer(CaptureRange.MIN_BACK, CaptureRange.MAX))
                    .then(Commands.argument(SIDE, IntegerArgumentType.integer(CaptureRange.MIN_SIDE, CaptureRange.MAX))
                        .then(Commands.argument(HEIGHT, IntegerArgumentType.integer(CaptureRange.MIN_UP, CaptureRange.MAX))
                            .executes(c -> captureRange(c, null))
                            .then(Commands.argument(NAME, StringArgumentType.greedyString())
                                .executes(c -> captureRange(c, StringArgumentType.getString(c, NAME))))))));
    }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        RequiredArgumentBuilder<CommandSourceStack, String> place = Commands.argument(FILE, StringArgumentType.string())
            .suggests(XjyCommands::suggestFiles)
            .executes(c -> PlaceCommand.run(c.getSource(), StringArgumentType.getString(c, FILE), -1));
        place.then(Commands.literal("auto")
            .executes(c -> PlaceCommand.run(c.getSource(), StringArgumentType.getString(c, FILE), -1)));
        for (int degrees : new int[] {0, 90, 180, 270}) {
            place.then(Commands.literal(Integer.toString(degrees))
                .executes(c -> PlaceCommand.run(c.getSource(), StringArgumentType.getString(c, FILE), degrees)));
        }
        dispatcher.register(Commands.literal("xjy")
            .requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))
            .then(Commands.literal("capture")
                .executes(c -> CaptureCommand.run(c.getSource(), CaptureConfig.current(), null))
                .then(Commands.argument(FRONT, IntegerArgumentType.integer(CaptureRange.MIN_FRONT, CaptureRange.MAX))
                    .then(Commands.argument(SIDE, IntegerArgumentType.integer(CaptureRange.MIN_SIDE, CaptureRange.MAX))
                        .then(Commands.argument(HEIGHT, IntegerArgumentType.integer(CaptureRange.MIN_UP, CaptureRange.MAX))
                            .executes(c -> capture(c, null))
                            .then(Commands.argument(NAME, StringArgumentType.greedyString())
                                .executes(c -> capture(c, StringArgumentType.getString(c, NAME)))))))
                .then(captureLast(LAST))
                .then(captureLast(LAST_EN))
                .then(captureRange(RANGE))
                .then(captureRange(RANGE_EN)))
            .then(Commands.literal("place").then(place))
            .then(Commands.literal("undo").executes(c -> UndoCommand.undo(c.getSource())))
            .then(Commands.literal("status").executes(c -> UndoCommand.status(c.getSource())))
            .then(Commands.literal("blacklist")
                .executes(c -> BlacklistCommand.open(c.getSource()))
                .then(Commands.literal("add")
                    .executes(c -> BlacklistCommand.addLooking(c.getSource()))
                    .then(Commands.argument(BLOCK, IdentifierArgument.id())
                        .suggests(BlacklistCommand::suggestBlocks)
                        .executes(c -> BlacklistCommand.add(c.getSource(), IdentifierArgument.getId(c, BLOCK).toString()))))
                .then(Commands.literal("remove")
                    .executes(c -> BlacklistCommand.removeLooking(c.getSource()))
                    .then(Commands.argument(BLOCK, IdentifierArgument.id())
                        .suggests(BlacklistCommand::suggestListed)
                        .executes(c -> BlacklistCommand.remove(c.getSource(), IdentifierArgument.getId(c, BLOCK).toString()))))
                .then(Commands.literal("list").executes(c -> BlacklistCommand.list(c.getSource())))
                .then(Commands.literal("clear").executes(c -> BlacklistCommand.clear(c.getSource())))));
    }

    /** {@code capture <前> <左右> <高> [名字…]}: these three numbers, back from the mod config (COMMANDS.md §2). */
    private static int capture(CommandContext<CommandSourceStack> c, @Nullable String name) throws CommandSyntaxException {
        CaptureRange range = new CaptureRange(IntegerArgumentType.getInteger(c, FRONT), CaptureConfig.current().back(),
            IntegerArgumentType.getInteger(c, SIDE), IntegerArgumentType.getInteger(c, HEIGHT));
        return CaptureCommand.run(c.getSource(), range, name);
    }

    /** {@code capture 范围 <前> <后> <左右> <高> [名字…]}: all four numbers given, nothing from the config. */
    private static int captureRange(CommandContext<CommandSourceStack> c, @Nullable String name) throws CommandSyntaxException {
        CaptureRange range = new CaptureRange(IntegerArgumentType.getInteger(c, FRONT), IntegerArgumentType.getInteger(c, BACK),
            IntegerArgumentType.getInteger(c, SIDE), IntegerArgumentType.getInteger(c, HEIGHT));
        return CaptureCommand.run(c.getSource(), range, name);
    }

    /** Tab lists the files in the buildings folder, quoted when they need it. */
    private static CompletableFuture<Suggestions> suggestFiles(CommandContext<CommandSourceStack> c,
                                                               SuggestionsBuilder builder) {
        String typed = builder.getRemaining();
        for (String name : BuildFiles.list()) {
            if (FileNames.matchesTyped(name, typed)) {
                builder.suggest(FileNames.quoteIfNeeded(name));
            }
        }
        return builder.buildFuture();
    }
}
