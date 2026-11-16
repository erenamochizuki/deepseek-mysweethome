package com.xiaojingyu.build;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

import org.jspecify.annotations.Nullable;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.block.state.BlockState;

/**
 * What a placement replaced, cell by cell (COMMANDS.md §4). Filled in while the place job runs:
 * only cells the job actually reached are recorded, so a placement that stopped halfway undoes
 * just the part that was placed. Server thread only.
 */
public final class UndoRecord {
    private final BuildPlan placed;
    private final List<BlockState> palette = new ArrayList<>();
    private final Map<BlockState, Integer> ids = new IdentityHashMap<>();
    private final int[] cells;
    private final Map<Integer, CompoundTag> blockEntities = new HashMap<>();
    private int recorded;
    /** The id the finished placement got in {@link LastPlaces}, or −1 (did not finish, so it was not recorded). */
    private int placeId = -1;

    public UndoRecord(BuildPlan placed) {
        this.placed = placed;
        this.cells = new int[placed.cellCount()];
        java.util.Arrays.fill(cells, -1);
    }

    /** Remembers the state (and block entity data, if any) cell i had before it was replaced. */
    public void record(int i, BlockState old, @Nullable CompoundTag oldBlockEntity) {
        if (cells[i] < 0) {
            recorded++;
        }
        Integer id = ids.get(old);
        if (id == null) {
            id = palette.size();
            palette.add(old);
            ids.put(old, id);
        }
        cells[i] = id;
        if (oldBlockEntity != null) {
            blockEntities.put(i, oldBlockEntity);
        } else {
            blockEntities.remove(i);
        }
    }

    /** Number of cells that would be restored. */
    public int recorded() {
        return recorded;
    }

    public BuildPlan placed() {
        return placed;
    }

    public int placeId() {
        return placeId;
    }

    void setPlaceId(int id) {
        placeId = id;
    }

    /** A plan that puts every recorded cell back; same geometry as the placement. */
    public BuildPlan restorePlan() {
        return new BuildPlan(placed.dimension(), placed.width(), placed.height(), placed.length(),
            placed.turns(), placed.baseX(), placed.baseY(), placed.baseZ(),
            palette.toArray(new BlockState[0]), cells, blockEntities);
    }
}
