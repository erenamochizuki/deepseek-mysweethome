package com.xiaojingyu.command;

import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.xiaojingyu.build.BuildManager;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

/** Checks shared by capture, place and undo. Each throws the chat message on failure. */
final class Checks {
    private Checks() {
    }

    /** The whole box must be inside the world height and in loaded chunks (no loading here). */
    static void area(ServerLevel level, int[] box) throws CommandSyntaxException {
        if (box[1] < level.getMinY() || box[4] > level.getMaxY()) {
            throw Msg.fail("error.out_of_height", level.getMinY(), level.getMaxY());
        }
        if (!chunksLoaded(level, box)) {
            throw Msg.fail("error.not_loaded");
        }
    }

    /** Every chunk the box touches is loaded (nothing gets loaded here). */
    static boolean chunksLoaded(ServerLevel level, int[] box) {
        for (int cx = box[0] >> 4; cx <= box[3] >> 4; cx++) {
            for (int cz = box[2] >> 4; cz <= box[5] >> 4; cz++) {
                if (!level.hasChunk(cx, cz)) {
                    return false;
                }
            }
        }
        return true;
    }

    /** A player may run one place or undo at a time. */
    static void notBusy(ServerPlayer player) throws CommandSyntaxException {
        if (BuildManager.busy(player.getUUID())) {
            throw Msg.fail("error.busy");
        }
    }
}
