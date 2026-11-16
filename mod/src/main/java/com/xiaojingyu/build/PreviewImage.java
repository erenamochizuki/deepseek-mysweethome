package com.xiaojingyu.build;

import net.minecraft.world.level.material.MapColor;

/**
 * The top-down picture of a capture (docs/COMMANDS.md §5): one s × s square per column, north up,
 * west left, shaded like a vanilla map against the column to the north. Pure: the caller finds each
 * column's top block.
 */
public final class PreviewImage {
    /** Longest side of the picture in pixels. */
    public static final int MAX_SIDE_PX = 512;
    /** Largest square per column in pixels. */
    public static final int MAX_SCALE = 16;

    private PreviewImage() {
    }

    /** Pixels per column for a box of width × length columns: 1…16, long side at most 512 px. */
    public static int scale(int width, int length) {
        int longest = Math.max(1, Math.max(width, length));
        return Math.max(1, Math.min(MAX_SCALE, MAX_SIDE_PX / longest));
    }

    /**
     * @param colors per column at index x + z × width, the map colour of its top block (null or
     *               {@link MapColor#NONE} for a column without one: transparent)
     * @param heights per column, the y of that block (any value when there is none)
     * @return argb pixels, (width × s) × (length × s), row by row from the north edge
     */
    public static int[] render(int width, int length, MapColor[] colors, int[] heights, int s) {
        int pw = width * s;
        int[] px = new int[pw * length * s];
        for (int z = 0; z < length; z++) {
            for (int x = 0; x < width; x++) {
                int i = x + z * width;
                MapColor color = colors[i];
                if (color == null || color == MapColor.NONE) {
                    continue;
                }
                MapColor.Brightness b = MapColor.Brightness.NORMAL;
                if (z > 0) {
                    MapColor north = colors[i - width];
                    if (north != null && north != MapColor.NONE) {
                        b = brightness(heights[i], heights[i - width], x, z);
                    }
                }
                int argb = color.calculateARGBColor(b);
                for (int dy = 0; dy < s; dy++) {
                    int row = (z * s + dy) * pw + x * s;
                    for (int dx = 0; dx < s; dx++) {
                        px[row + dx] = argb;
                    }
                }
            }
        }
        return px;
    }

    /** Vanilla map shading (MapItem, scale 1): higher than the north neighbour → brighter, lower → darker, a little checkerboard dither on ties. */
    static MapColor.Brightness brightness(int height, int northHeight, int x, int z) {
        double diff = (height - northHeight) * 4.0 / 5.0 + (((x + z) & 1) - 0.5) * 0.4;
        if (diff > 0.6) {
            return MapColor.Brightness.HIGH;
        }
        if (diff < -0.6) {
            return MapColor.Brightness.LOW;
        }
        return MapColor.Brightness.NORMAL;
    }
}
