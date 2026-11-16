package com.xiaojingyu.build;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

import com.mojang.logging.LogUtils;
import com.xiaojingyu.command.Msg;

import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

/**
 * Running jobs, undo lists and last captures, per player, in memory only (COMMANDS.md §3–§4a). The last
 * placements for {@code /xjy capture 上次} are kept with the world instead ({@link LastPlaces}, §2b): a finished
 * place adds one, an undo takes its own out. Everything here runs on the server thread: commands and the server tick.
 */
public final class BuildManager {
    private static final Logger LOGGER = LogUtils.getLogger();
    public static final int MAX_UNDO = 5;
    /** Work units per server tick, shared by all jobs (COMMANDS.md §3 starts at 8192). */
    static final int TICK_BUDGET = 8192;
    /** A tick's batch also stops after this long, budget or not. */
    static final long TICK_TIME_NANOS = 40_000_000L;
    /** About 2 s between progress messages. */
    static final int PROGRESS_TICKS = 40;

    private static final Map<UUID, BuildJob> JOBS = new LinkedHashMap<>();
    private static final Map<UUID, Deque<UndoRecord>> UNDO = new HashMap<>();
    private static final Map<UUID, String> LAST_CAPTURE = new HashMap<>();

    private BuildManager() {
    }

    public static @Nullable BuildJob job(UUID player) {
        return JOBS.get(player);
    }

    public static boolean busy(UUID player) {
        return JOBS.containsKey(player);
    }

    /** Cells this player still has to place or restore; 0 when nothing is running. */
    public static int remaining(UUID player) {
        BuildJob job = JOBS.get(player);
        return job == null ? 0 : job.remaining();
    }

    public static int undoCount(UUID player) {
        Deque<UndoRecord> list = UNDO.get(player);
        return list == null ? 0 : list.size();
    }

    public static @Nullable UndoRecord peekUndo(UUID player) {
        Deque<UndoRecord> list = UNDO.get(player);
        return list == null ? null : list.peekFirst();
    }

    public static void setLastCapture(UUID player, String fileName) {
        LAST_CAPTURE.put(player, fileName);
    }

    public static @Nullable String lastCapture(UUID player) {
        return LAST_CAPTURE.get(player);
    }

    /**
     * Starts a placement and keeps its undo record right away; the first batch runs now. {@code placed} goes into
     * the world's {@link LastPlaces} when the job has finished (COMMANDS.md §2b), not before.
     */
    public static BuildJob startPlace(MinecraftServer server, UUID owner, ServerLevel level, BuildPlan plan,
                                      PlaceRecord placed) {
        UndoRecord undo = new UndoRecord(plan);
        Deque<UndoRecord> list = UNDO.computeIfAbsent(owner, k -> new ArrayDeque<>());
        list.addFirst(undo);
        while (list.size() > MAX_UNDO) {
            list.removeLast();
        }
        return start(server, new BuildJob(BuildJob.Kind.PLACE, owner, plan, level, undo, placed));
    }

    /**
     * Takes the newest undo record off the player's list and starts putting it back. The placement it undoes
     * leaves the world's {@link LastPlaces} now, so "上次" is the placement before it again.
     */
    public static BuildJob startUndo(MinecraftServer server, UUID owner, ServerLevel level) {
        UndoRecord record = UNDO.get(owner).removeFirst();
        if (record.placeId() >= 0 && LastPlaceStore.get(server).remove(owner, record.placeId())) {
            LOGGER.info("[xiaojingyu] undo of {}: last placement record {} removed", owner, record.placeId());
        }
        return start(server, new BuildJob(BuildJob.Kind.UNDO, owner, record.restorePlan(), level, null, null));
    }

    private static BuildJob start(MinecraftServer server, BuildJob job) {
        JOBS.put(job.owner(), job);
        job.holdChunks(true);
        job.lastProgressTick = server.getTickCount();
        run(server, job, TICK_BUDGET, System.nanoTime() + TICK_TIME_NANOS);
        return job;
    }

    /** Called after every server tick. */
    public static void tick(MinecraftServer server) {
        if (JOBS.isEmpty()) {
            return;
        }
        long tick = server.getTickCount();
        long deadline = System.nanoTime() + TICK_TIME_NANOS;
        int budget = Math.max(512, TICK_BUDGET / JOBS.size());
        for (BuildJob job : new ArrayList<>(JOBS.values())) {
            if (job.lastStepTick == tick) {
                continue;
            }
            run(server, job, budget, deadline);
            if (job.state() == BuildJob.State.RUNNING && tick - job.lastProgressTick >= PROGRESS_TICKS) {
                job.lastProgressTick = tick;
                tell(server, job.owner(), progress(job), true);
            }
        }
    }

    private static void run(MinecraftServer server, BuildJob job, int budget, long deadline) {
        job.lastStepTick = server.getTickCount();
        try {
            job.step(budget, deadline);
        } catch (RuntimeException e) {
            LOGGER.error("[xiaojingyu] {} job of {} failed after {}/{} cells", job.kind(), job.owner(),
                job.done(), job.total(), e);
            job.fail();
        }
        if (job.state() != BuildJob.State.RUNNING) {
            finish(server, job);
        }
    }

    private static void finish(MinecraftServer server, BuildJob job) {
        job.holdChunks(false);
        JOBS.remove(job.owner());
        UndoRecord undo = job.undo();
        if (undo != null && undo.recorded() == 0) {
            Deque<UndoRecord> list = UNDO.get(job.owner());
            if (list != null) {
                list.removeIf(r -> r == undo);
            }
        }
        PlaceRecord placed = job.placeRecord();
        if (placed != null && job.state() == BuildJob.State.DONE) {
            // Only a placement that went in completely is remembered for /xjy capture 上次 (COMMANDS.md §2b).
            int id = LastPlaceStore.get(server).add(job.owner(), placed);
            if (undo != null) {
                undo.setPlaceId(id);
            }
            LOGGER.info("[xiaojingyu] last placement of {} is now record {}: {}", job.owner(), id, placed);
        }
        String seconds = String.format(Locale.ROOT, "%.1f", job.seconds());
        Component message = switch (job.state()) {
            case DONE -> job.kind() == BuildJob.Kind.PLACE
                ? Msg.t("place.done", job.done(), seconds)
                : Msg.t("undo.done", job.done(), seconds);
            case STOPPED -> Msg.t("job.stopped", job.done(), job.total());
            default -> Msg.t("job.failed", job.done(), job.total());
        };
        LOGGER.info("[xiaojingyu] {} {} for {}: {}/{} cells in {} s", job.kind(), job.state(), job.owner(),
            job.done(), job.total(), seconds);
        tell(server, job.owner(), message, false);
    }

    /** The progress line: kind, done, total, percent. */
    public static Component progress(BuildJob job) {
        int percent = job.total() == 0 ? 100 : (int) (100L * job.done() / job.total());
        Component kind = Msg.t(job.kind() == BuildJob.Kind.PLACE ? "job.kind.place" : "job.kind.undo");
        return Msg.t("job.progress", kind, job.done(), job.total(), percent);
    }

    /** Only to the player who started the job, and only if online (not command output). */
    private static void tell(MinecraftServer server, UUID player, Component message, boolean actionBar) {
        ServerPlayer p = server.getPlayerList().getPlayer(player);
        if (p != null) {
            p.sendSystemMessage(message, actionBar);
        }
    }

    /** Server stopping: drop the tickets and forget everything (undo is memory only, COMMANDS.md §4). */
    public static void shutdown() {
        for (BuildJob job : JOBS.values()) {
            job.holdChunks(false);
            LOGGER.warn("[xiaojingyu] server stopping, {} job for {} left at {}/{} cells", job.kind(),
                job.owner(), job.done(), job.total());
        }
        JOBS.clear();
        UNDO.clear();
        LAST_CAPTURE.clear();
    }
}
