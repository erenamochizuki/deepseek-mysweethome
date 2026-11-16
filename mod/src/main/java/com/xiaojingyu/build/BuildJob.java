package com.xiaojingyu.build;

import java.util.BitSet;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

import com.mojang.logging.LogUtils;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.TagValueInput;

/**
 * One running place or undo (COMMANDS.md §3, §4). Pass 1 writes every cell as is: no shape
 * updates, no drops, no block entity side effects, no {@code onPlace}. Pass 2 lets the blocks
 * outside the box that touch a changed surface cell react; cells inside get no updates.
 * Server thread only.
 */
public final class BuildJob {
    private static final Logger LOGGER = LogUtils.getLogger();

    public enum Kind { PLACE, UNDO }

    public enum State { RUNNING, DONE, STOPPED, FAILED }

    /** 2 send to clients, 16 known shape, 32 no drops, 256 no block entity side effects, 512 no onPlace. */
    static final int RAW = 2 | 16 | 32 | 256 | 512;
    /** Like RAW but not sent to clients: the barrier StructureTemplate puts down first. */
    static final int CLEAR = 4 | 16 | 32 | 256 | 512;
    /** For outside blocks: send to clients, do not pass the update on, no drops. */
    static final int OUTSIDE = 2 | 16 | 32;

    private final Kind kind;
    private final UUID owner;
    private final BuildPlan plan;
    private final ServerLevel level;
    private final @Nullable UndoRecord undo;
    /** A place job: what to remember for {@code /xjy capture 上次} once it has finished (null for undo). */
    private final @Nullable PlaceRecord placeRecord;
    private final BitSet changedSurface;
    private final BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
    private final BlockPos.MutableBlockPos outside = new BlockPos.MutableBlockPos();
    private final long startNanos = System.nanoTime();
    private final int total;
    private int next;
    private int pass2Next = -1;
    private int done;
    private State state = State.RUNNING;
    private boolean holdingChunks;
    long lastStepTick = Long.MIN_VALUE;
    long lastProgressTick;

    public BuildJob(Kind kind, UUID owner, BuildPlan plan, ServerLevel level, @Nullable UndoRecord undo,
                    @Nullable PlaceRecord placeRecord) {
        this.kind = kind;
        this.owner = owner;
        this.plan = plan;
        this.level = level;
        this.undo = undo;
        this.placeRecord = placeRecord;
        this.changedSurface = new BitSet(plan.cellCount());
        int n = 0;
        for (int i = 0; i < plan.cellCount(); i++) {
            if (plan.cell(i) >= 0) {
                n++;
            }
        }
        this.total = n;
    }

    /**
     * Does up to {@code budget} units of work (one cell in pass 1, one changed surface cell in
     * pass 2), stopping early at {@code deadlineNanos}. Returns the units used.
     */
    public int step(int budget, long deadlineNanos) {
        int used = 0;
        while (state == State.RUNNING && used < budget) {
            if ((used & 255) == 255 && System.nanoTime() > deadlineNanos) {
                break;
            }
            if (next < plan.cellCount()) {
                int id = plan.cell(next);
                if (id >= 0) {
                    if (!placeCell(next, plan.state(id))) {
                        state = State.STOPPED;
                        break;
                    }
                    done++;
                    used++;
                }
                next++;
                continue;
            }
            pass2Next = changedSurface.nextSetBit(pass2Next + 1);
            if (pass2Next < 0) {
                state = State.DONE;
                break;
            }
            notifyOutside(pass2Next);
            used++;
        }
        return used;
    }

    /** Pass 1 for one cell. Returns false if its chunk is not loaded (the job must stop). */
    private boolean placeCell(int i, BlockState target) {
        plan.pos(i, pos);
        if (!level.hasChunk(pos.getX() >> 4, pos.getZ() >> 4)) {
            return false;
        }
        BlockState old = level.getBlockState(pos);
        BlockEntity oldBe = old.hasBlockEntity() ? level.getBlockEntity(pos) : null;
        if (undo != null) {
            CompoundTag oldData = oldBe == null ? null : oldBe.saveWithoutMetadata(level.registryAccess());
            undo.record(i, old, oldData);
        }
        boolean changed;
        if (target.hasBlockEntity()) {
            // Always start from a fresh block entity so the result is exactly the file's data.
            level.setBlock(pos, Blocks.BARRIER.defaultBlockState(), CLEAR);
            level.setBlock(pos, target, RAW);
            CompoundTag data = plan.blockEntity(i);
            BlockEntity be = level.getBlockEntity(pos);
            if (data != null && be != null) {
                try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(be.problemPath(), LOGGER)) {
                    be.loadWithComponents(TagValueInput.create(reporter, level.registryAccess(), data));
                }
            }
            changed = true;
        } else {
            changed = level.setBlock(pos, target, RAW);
        }
        if (changed && plan.onSurface(pos)) {
            changedSurface.set(i);
        }
        return true;
    }

    /** Pass 2 for one changed surface cell: outside neighbours recompute their shape and hear the change. */
    private void notifyOutside(int i) {
        BlockPos inside = plan.pos(i, pos).immutable();
        BlockState insideState = level.getBlockState(inside);
        for (Direction d : Direction.values()) {
            outside.setWithOffset(inside, d);
            if (plan.inside(outside) || !level.isLoaded(outside)) {
                continue;
            }
            BlockPos out = outside.immutable();
            level.neighborShapeChanged(d.getOpposite(), out, inside, insideState, OUTSIDE, 512);
            level.neighborChanged(out, insideState.getBlock(), null);
        }
    }

    /** Adds (or removes) a load ticket on every chunk of the box, so it stays loaded while we work. */
    public void holdChunks(boolean hold) {
        if (hold == holdingChunks) {
            return;
        }
        holdingChunks = hold;
        int[] b = plan.box();
        for (int cx = b[0] >> 4; cx <= b[3] >> 4; cx++) {
            for (int cz = b[2] >> 4; cz <= b[5] >> 4; cz++) {
                if (hold) {
                    level.getChunkSource().addTicketWithRadius(BuildTickets.BUILD.get(), new ChunkPos(cx, cz), 0);
                } else {
                    level.getChunkSource().removeTicketWithRadius(BuildTickets.BUILD.get(), new ChunkPos(cx, cz), 0);
                }
            }
        }
    }

    public void fail() {
        state = State.FAILED;
    }

    public Kind kind() { return kind; }
    public UUID owner() { return owner; }
    public State state() { return state; }
    public int done() { return done; }
    public int total() { return total; }
    public @Nullable UndoRecord undo() { return undo; }
    public @Nullable PlaceRecord placeRecord() { return placeRecord; }
    public BuildPlan plan() { return plan; }
    public double seconds() { return (System.nanoTime() - startNanos) / 1e9; }

    /** Cells still to do; at least 1 while running, so callers can wait for 0. */
    public int remaining() {
        return state == State.RUNNING ? Math.max(1, total - done) : 0;
    }
}
