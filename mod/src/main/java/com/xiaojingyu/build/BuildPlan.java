package com.xiaojingyu.build;

import java.util.Map;

import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

/**
 * What one place or undo job writes into the world.
 *
 * <p>Cells are numbered in file order, {@code i = x + z·W + y·W·L} for a w × h × l box, so y is
 * the outer loop and blocks go in bottom-up. Cell (x, y, z) lands at
 * {@code base + rot_k(x, y, z)} (COMMANDS.md §3: base = S' + rot_k(Offset)). An undo job uses
 * the same geometry as the place job it undoes, with the old states as palette.
 *
 * <p>{@code cells[i] = -1} means "leave this cell alone" (an undo of a placement that stopped
 * halfway). Not thread safe; server thread only.
 */
public final class BuildPlan {
    private final ResourceKey<Level> dimension;
    private final int w;
    private final int h;
    private final int l;
    private final int k;
    private final int baseX;
    private final int baseY;
    private final int baseZ;
    private final BlockState[] palette;
    private final int[] cells;
    private final Map<Integer, CompoundTag> blockEntities;
    private final int[] box;

    /**
     * @param blockEntities cell index → block entity data (without id/x/y/z), only for cells
     *                      whose state has a block entity
     */
    public BuildPlan(ResourceKey<Level> dimension, int w, int h, int l, int k,
                     int baseX, int baseY, int baseZ,
                     BlockState[] palette, int[] cells, Map<Integer, CompoundTag> blockEntities) {
        if (cells.length != w * h * l) {
            throw new IllegalArgumentException("cells.length " + cells.length + " != " + w + "x" + h + "x" + l);
        }
        this.dimension = dimension;
        this.w = w;
        this.h = h;
        this.l = l;
        this.k = k & 3;
        this.baseX = baseX;
        this.baseY = baseY;
        this.baseZ = baseZ;
        this.palette = palette;
        this.cells = cells;
        this.blockEntities = blockEntities;
        this.box = Frame.placeBox(baseX, baseY, baseZ, this.k, 0, 0, 0, w, h, l);
    }

    public ResourceKey<Level> dimension() {
        return dimension;
    }

    public int width() {
        return w;
    }

    public int height() {
        return h;
    }

    public int length() {
        return l;
    }

    public int turns() {
        return k;
    }

    public int baseX() {
        return baseX;
    }

    public int baseY() {
        return baseY;
    }

    public int baseZ() {
        return baseZ;
    }

    public int cellCount() {
        return cells.length;
    }

    /** Palette id of cell i, or −1 to skip it. */
    public int cell(int i) {
        return cells[i];
    }

    public BlockState state(int paletteId) {
        return palette[paletteId];
    }

    public CompoundTag blockEntity(int i) {
        return blockEntities.get(i);
    }

    /** World box {minX, minY, minZ, maxX, maxY, maxZ}, inclusive. Do not modify. */
    public int[] box() {
        return box;
    }

    /** Sets {@code out} to the world position of cell i and returns it. */
    public BlockPos.MutableBlockPos pos(int i, BlockPos.MutableBlockPos out) {
        int x = i % w;
        int z = (i / w) % l;
        int y = i / (w * l);
        return out.set(baseX + Frame.rotX(k, x, z), baseY + y, baseZ + Frame.rotZ(k, x, z));
    }

    public boolean inside(BlockPos p) {
        return p.getX() >= box[0] && p.getX() <= box[3]
            && p.getY() >= box[1] && p.getY() <= box[4]
            && p.getZ() >= box[2] && p.getZ() <= box[5];
    }

    /** True if world position p is on the surface of the box (has a face to the outside). */
    public boolean onSurface(BlockPos p) {
        return p.getX() == box[0] || p.getX() == box[3]
            || p.getY() == box[1] || p.getY() == box[4]
            || p.getZ() == box[2] || p.getZ() == box[5];
    }
}
