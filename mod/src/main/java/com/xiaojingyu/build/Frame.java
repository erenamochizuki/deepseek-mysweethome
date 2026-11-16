package com.xiaojingyu.build;

import java.util.Locale;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.Rotation;

/**
 * Facings and quarter turns for /xjy (docs/COMMANDS.md §1). Pure math, no world access.
 *
 * <p>Facings are numbered clockwise from north: 0 north, 1 east, 2 south, 3 west. A quarter turn
 * k = 1 is clockwise seen from above and maps (x, y, z) to (−z, y, x), the same as
 * {@code BlockPos.rotate(Rotation.CLOCKWISE_90)}.
 */
public final class Frame {
    private static final String[] NAMES = {"north", "east", "south", "west"};
    private static final int[] DX = {0, 1, 0, -1};
    private static final int[] DZ = {-1, 0, 1, 0};

    private Frame() {
    }

    /** north / east / south / west for 0..3. */
    public static String name(int facing) {
        return NAMES[facing & 3];
    }

    /** 0..3 for "north" / "east" / "south" / "west" (any case), −1 for anything else or null. */
    public static int facingIndex(String name) {
        if (name == null) {
            return -1;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        for (int i = 0; i < NAMES.length; i++) {
            if (NAMES[i].equals(lower)) {
                return i;
            }
        }
        return -1;
    }

    /** 0..3 for a horizontal direction, −1 for up and down. */
    public static int facingIndex(Direction direction) {
        return switch (direction) {
            case NORTH -> 0;
            case EAST -> 1;
            case SOUTH -> 2;
            case WEST -> 3;
            default -> -1;
        };
    }

    /** X step of one block forward when facing this way. */
    public static int dx(int facing) {
        return DX[facing & 3];
    }

    /** Z step of one block forward when facing this way. */
    public static int dz(int facing) {
        return DZ[facing & 3];
    }

    /** The facing to the right of this one (R in COMMANDS.md §1): north → east → south → west → north. */
    public static int right(int facing) {
        return (facing + 1) & 3;
    }

    /** X after turning (x, z) clockwise k quarter turns. */
    public static int rotX(int k, int x, int z) {
        return switch (k & 3) {
            case 0 -> x;
            case 1 -> -z;
            case 2 -> -x;
            default -> z;
        };
    }

    /** Z after turning (x, z) clockwise k quarter turns. */
    public static int rotZ(int k, int x, int z) {
        return switch (k & 3) {
            case 0 -> z;
            case 1 -> x;
            case 2 -> -z;
            default -> -x;
        };
    }

    /** The block rotation for k clockwise quarter turns. */
    public static Rotation rotation(int k) {
        return switch (k & 3) {
            case 0 -> Rotation.NONE;
            case 1 -> Rotation.CLOCKWISE_90;
            case 2 -> Rotation.CLOCKWISE_180;
            default -> Rotation.COUNTERCLOCKWISE_90;
        };
    }

    /** The quarter turns that undo k: k + back(k) is a whole turn (0 stays 0). */
    public static int back(int k) {
        return (4 - (k & 3)) & 3;
    }

    /** Quarter turns for "auto": the file's facing becomes the placer's. A file without a facing (−1) is not turned. */
    public static int autoTurns(int fileFacing, int playerFacing) {
        return fileFacing < 0 ? 0 : (playerFacing - fileFacing) & 3;
    }

    /** Quarter turns for 0 / 90 / 180 / 270 degrees, −1 for anything else. */
    public static int turnsFromDegrees(int degrees) {
        return switch (degrees) {
            case 0 -> 0;
            case 90 -> 1;
            case 180 -> 2;
            case 270 -> 3;
            default -> -1;
        };
    }

    /** {@link #captureBox(int, int, int, int, int, int, int, int)} with nothing behind (back = 0). */
    public static int[] captureBox(int sx, int sy, int sz, int facing, int front, int side, int height) {
        return captureBox(sx, sy, sz, facing, front, 0, side, height);
    }

    /**
     * The capture box (COMMANDS.md §2) for a player standing at (sx, sy, sz): local f = 1−back…front
     * (back = 0: from the block in front; back = N: also the player's own column and the N−1 behind it),
     * s = −side…side, u = −1…height−2, world = S + f·F + s·R + u·Y.
     *
     * @return {minX, minY, minZ, maxX, maxY, maxZ}, all inclusive
     */
    public static int[] captureBox(int sx, int sy, int sz, int facing, int front, int back, int side, int height) {
        int r = right(facing);
        int[] fs = {1 - back, front};
        int[] ss = {-side, side};
        int minX = Integer.MAX_VALUE, minZ = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE, maxZ = Integer.MIN_VALUE;
        for (int f : fs) {
            for (int s : ss) {
                int x = sx + f * dx(facing) + s * dx(r);
                int z = sz + f * dz(facing) + s * dz(r);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);
            }
        }
        return new int[] {minX, sy - 1, minZ, maxX, sy + height - 2, maxZ};
    }

    /**
     * Where a file of size w × h × l with offset (ox, oy, oz) lands when placed from (sx, sy, sz)
     * turned k quarter turns: cell (x, y, z) goes to S' + rot_k(Offset + (x, y, z)) (COMMANDS.md §3).
     *
     * @return {minX, minY, minZ, maxX, maxY, maxZ}, all inclusive
     */
    public static int[] placeBox(int sx, int sy, int sz, int k, int ox, int oy, int oz, int w, int h, int l) {
        int minX = Integer.MAX_VALUE, minZ = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE, maxZ = Integer.MIN_VALUE;
        for (int x : new int[] {ox, ox + w - 1}) {
            for (int z : new int[] {oz, oz + l - 1}) {
                minX = Math.min(minX, sx + rotX(k, x, z));
                maxX = Math.max(maxX, sx + rotX(k, x, z));
                minZ = Math.min(minZ, sz + rotZ(k, x, z));
                maxZ = Math.max(maxZ, sz + rotZ(k, x, z));
            }
        }
        return new int[] {minX, sy + oy, minZ, maxX, sy + oy + h - 1, maxZ};
    }
}
