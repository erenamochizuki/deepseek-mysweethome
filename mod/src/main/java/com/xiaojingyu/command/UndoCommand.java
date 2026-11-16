package com.xiaojingyu.command;

import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.xiaojingyu.build.BuildJob;
import com.xiaojingyu.build.BuildManager;
import com.xiaojingyu.build.CaptureRange;
import com.xiaojingyu.build.LastPlaceStore;
import com.xiaojingyu.build.PlaceRecord;
import com.xiaojingyu.build.UndoRecord;
import com.xiaojingyu.config.CaptureConfig;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

/** {@code /xjy undo} and {@code /xjy status} (COMMANDS.md §4, §4a). */
final class UndoCommand {
    private UndoCommand() {
    }

    /** Puts back what the player's last place replaced. Result = cells to restore. */
    static int undo(CommandSourceStack source) throws CommandSyntaxException {
        ServerPlayer player = source.getPlayerOrException();
        Checks.notBusy(player);
        UndoRecord record = BuildManager.peekUndo(player.getUUID());
        if (record == null) {
            throw Msg.fail("undo.nothing");
        }
        ServerLevel level = source.getServer().getLevel(record.placed().dimension());
        if (level == null) {
            throw Msg.fail("undo.no_level", record.placed().dimension().identifier().toString());
        }
        Checks.area(level, record.placed().box());
        int count = record.recorded();
        source.sendSuccess(() -> Msg.t("undo.started", count), false);
        BuildManager.startUndo(source.getServer(), player.getUUID(), level);
        return count;
    }

    /** Read only. Result = cells this player still has to place or restore, 0 when idle. */
    static int status(CommandSourceStack source) throws CommandSyntaxException {
        ServerPlayer player = source.getPlayerOrException();
        BuildJob job = BuildManager.job(player.getUUID());
        String last = BuildManager.lastCapture(player.getUUID());
        int undos = BuildManager.undoCount(player.getUUID());
        PlaceRecord placed = LastPlaceStore.latest(source.getServer(), player.getUUID());
        source.sendSuccess(() -> job == null ? Msg.t("status.idle") : BuildManager.progress(job), false);
        source.sendSuccess(() -> last == null ? Msg.t("status.no_capture") : Msg.t("status.last_capture", last), false);
        if (placed == null) {
            source.sendSuccess(() -> Msg.t("status.no_place"), false);
        } else {
            // COMMANDS.md §4a: file, where (standing point and box), how far it was turned — what capture 上次 reads.
            int[] b = placed.box();
            String where = CaptureCommand.where(placed.standing(), placed.dimension(), player.level().dimension());
            String from = b[0] + ", " + b[1] + ", " + b[2];
            String to = b[3] + ", " + b[4] + ", " + b[5];
            source.sendSuccess(() -> Msg.t("status.last_place", placed.file(), where, placed.degrees(), from, to), false);
        }
        source.sendSuccess(() -> Msg.t("status.undos", undos), false);
        // What the plain /xjy capture takes now (the mod config of this server / this game; COMMANDS.md §4a).
        CaptureRange range = CaptureConfig.current();
        source.sendSuccess(() -> Msg.t("status.capture_range", range.front(), range.back(), range.side(), range.up(),
            range.numbers()), false);
        return BuildManager.remaining(player.getUUID());
    }
}
