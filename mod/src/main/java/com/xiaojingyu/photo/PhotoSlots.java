package com.xiaojingyu.photo;

import com.xiaojingyu.furniture.FurnitureShapes;

/**
 * Where the photos go on a piece of furniture (docs/PHOTOS.md §3), without any Minecraft class (cmdTest checks
 * it): the rows {@code {part, x0, y0, x1, y1, z}} of {@code FurnitureShapes.Kind.photoSlots()}, in pixels of the
 * north-facing model relative to that part's cell; a rectangle across two cells belongs to the cell of its
 * centre and may reach past 0..16. Row number = slot number ({@code Slots} of the picture frames).
 *
 * <p>Model space used here: pixels relative to the min corner of the main cell (part 0) of the north-facing
 * model, X east, Y up, Z south (the front faces −Z). A part's cell {cx, cy, cz} adds {16·cx, 16·cy, 16·cz}.
 * Facing east / south / west turns the whole piece clockwise (seen from above) around the main cell's centre,
 * exactly like the cells and boxes (FurnitureShapes.rotateY, FURNITURE.md §8.1): one quarter turn maps
 * (X, Z) to (16 − Z, X).
 */
public final class PhotoSlots {
    private PhotoSlots() {
    }

    /**
     * The rows of a furniture id ("photo_frame" or "xiaojingyu:photo_frame"), from the generated
     * FurnitureShapes; empty if it has no photos. Read-only.
     */
    public static double[][] of(String id) {
        return FurnitureShapes.photoSlots(id);
    }

    /** Cell {cx, cy, cz} of a part of a kind (north-facing), or {0, 0, 0} for an unknown kind. */
    public static int[] cell(String id, int part) {
        FurnitureShapes.Kind kind = FurnitureShapes.kind(id);
        return kind == null ? new int[3] : kind.cell(part);
    }

    /**
     * World → model: a point given in blocks relative to the main cell's min corner (world axes) as model
     * pixels {X, Y, Z} (undoing {@code quarterTurns} clockwise quarter turns: north 0, east 1, south 2, west 3).
     */
    public static double[] toModel(int quarterTurns, double x, double y, double z) {
        double px = x * 16;
        double pz = z * 16;
        for (int t = Math.floorMod(quarterTurns, 4); t > 0; t--) {
            // inverse of (X, Z) → (16 − Z, X)
            double nx = pz;
            double nz = 16 - px;
            px = nx;
            pz = nz;
        }
        return new double[] {px, y * 16, pz};
    }

    /**
     * Model → world, the other way: model pixels {X, Y, Z} to blocks relative to the main cell's min corner.
     */
    public static double[] toWorld(int quarterTurns, double px, double py, double pz) {
        for (int t = Math.floorMod(quarterTurns, 4); t > 0; t--) {
            double nx = 16 - pz;
            double nz = px;
            px = nx;
            pz = nz;
        }
        return new double[] {px / 16, py / 16, pz / 16};
    }

    /**
     * The slot under a click. {@code x, y, z}: the hit point in blocks relative to the main cell's min corner
     * (world axes). The slot whose rectangle (seen from the front) holds the point; if none does (the click is
     * on a frame's wood or between frames), the nearest one. −1 if the kind has no slots.
     */
    public static int find(String id, int quarterTurns, double x, double y, double z) {
        double[][] rows = of(id);
        double[] p = toModel(quarterTurns, x, y, z);
        int best = -1;
        double bestDist = Double.MAX_VALUE;
        for (int i = 0; i < rows.length; i++) {
            double[] r = rows[i];
            int[] c = cell(id, (int) r[0]);
            double x0 = c[0] * 16 + Math.min(r[1], r[3]);
            double x1 = c[0] * 16 + Math.max(r[1], r[3]);
            double y0 = c[1] * 16 + Math.min(r[2], r[4]);
            double y1 = c[1] * 16 + Math.max(r[2], r[4]);
            double dx = Math.max(0, Math.max(x0 - p[0], p[0] - x1));
            double dy = Math.max(0, Math.max(y0 - p[1], p[1] - y1));
            double dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        return best;
    }

    /**
     * Texture coordinates {u0, v0, u1, v1} for a w × h rectangle so the square photo covers it without stretching
     * (cut evenly from both sides, like CSS object-fit: cover; PHOTOS.md §3 rule 3). u0, v0 is the photo's
     * top-left as seen from the front.
     */
    public static double[] cover(double w, double h) {
        if (w <= 0 || h <= 0 || w == h) {
            return new double[] {0, 0, 1, 1};
        }
        if (w > h) {
            double keep = h / w;
            return new double[] {0, (1 - keep) / 2, 1, (1 + keep) / 2};
        }
        double keep = w / h;
        return new double[] {(1 - keep) / 2, 0, (1 + keep) / 2, 1};
    }
}
