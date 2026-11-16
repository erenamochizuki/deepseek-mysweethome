package com.xiaojingyu.furniture;

/**
 * What the mod needs to know about one kind of furniture from round 2 (docs/FURNITURE.md §8.1):
 * its size in cells and, for every cell (by part number), the boxes, the collision kind and the light.
 *
 * <p>Cells: facing north the piece covers local cells cx = 0..w−1 (east), cz = 0..d−1 (back, +z),
 * cy = 0..h−1 (up); part = cx + w × (cz + d × cy); part 0 is the main cell (front, west, bottom).
 *
 * @param id    block path, e.g. "sofa" (the block is xiaojingyu:&lt;id&gt;)
 * @param w     cells across (x when facing north)
 * @param d     cells deep (z when facing north)
 * @param h     cells high
 * @param cells one entry per part, length w × d × h
 */
public record FurnitureSpec(String id, int w, int d, int h, Cell[] cells) {
    /** Collision kind of a cell (§8.1): the model boxes, a 1/16 high floor layer you can walk on, or nothing. */
    public enum Collide {
        BOX, THIN, NONE
    }

    /**
     * One cell.
     *
     * @param outlines outline boxes (pointing at it, breaking it) facing north, pixels 0..16, each {x0, y0, z0, x1, y1, z1}:
     *                 the model's bounding box of this cell, also for THIN and NONE cells
     * @param boxes    collision boxes, same units: the model box for BOX, {0, 0, 0, 16, 1, 16} for THIN, none for NONE
     * @param collide  collision kind
     * @param light    block light 0..15
     */
    public record Cell(double[][] outlines, double[][] boxes, Collide collide, int light) {
    }

    public FurnitureSpec {
        if (w < 1 || d < 1 || h < 1 || cells.length != w * d * h) {
            throw new IllegalArgumentException("furniture " + id + ": " + w + "×" + d + "×" + h + " but " + cells.length + " cells");
        }
    }

    /** Number of cells (= number of part values). */
    public int count() {
        return cells.length;
    }

    /** {cx, cy, cz} of a part. */
    public int[] local(int part) {
        return new int[] {part % w, part / (w * d), (part / w) % d};
    }

    /** Part of a local cell, or −1 outside the piece. */
    public int part(int cx, int cy, int cz) {
        if (cx < 0 || cx >= w || cy < 0 || cy >= h || cz < 0 || cz >= d) {
            return -1;
        }
        return cx + w * (cz + d * cy);
    }
}
