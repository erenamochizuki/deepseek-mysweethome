package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;

/** Facings, turning and boxes (COMMANDS.md §1–§3), checked against Minecraft's own Direction, Rotation and BlockPos. */
final class FrameTests {
    private static final Direction[] FACINGS = {Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST};
    private static final Rotation[] TURNS = {Rotation.NONE, Rotation.CLOCKWISE_90, Rotation.CLOCKWISE_180,
        Rotation.COUNTERCLOCKWISE_90};

    private FrameTests() {
    }

    static void run() {
        facings();
        turns();
        captureBoxes();
        backBoxes();
        int[][] spots = {{10, 64, 20}, {-3, -60, 7}};
        for (int[] a : spots) {
            for (int[] b : spots) {
                for (int capFacing = 0; capFacing < 4; capFacing++) {
                    for (int placeFacing = 0; placeFacing < 4; placeFacing++) {
                        placeMatchesCapture(a, capFacing, b, placeFacing, 3, 0, 2, 4);
                        placeMatchesCapture(a, capFacing, b, placeFacing, 3, 1, 2, 4);
                        placeMatchesCapture(a, capFacing, b, placeFacing, 2, 7, 1, 3);
                    }
                }
            }
        }
        planCells();
    }

    private static void facings() {
        String[] names = {"north", "east", "south", "west"};
        for (int f = 0; f < 4; f++) {
            Direction d = FACINGS[f];
            eq(names[f], Frame.name(f), "name(" + f + ")");
            eq(f, Frame.facingIndex(names[f]), "facingIndex(\"" + names[f] + "\")");
            eq(f, Frame.facingIndex(d), "facingIndex(" + d + ")");
            eq(d.getStepX(), Frame.dx(f), "dx(" + f + ")");
            eq(d.getStepZ(), Frame.dz(f), "dz(" + f + ")");
            eq(Frame.facingIndex(d.getClockWise()), Frame.right(f), "right(" + f + ") is a quarter turn clockwise");
        }
        eq(-1, Frame.facingIndex("up"), "facingIndex(\"up\")");
        eq(-1, Frame.facingIndex(""), "facingIndex(\"\")");
        eq(-1, Frame.facingIndex(Direction.UP), "facingIndex(UP)");
    }

    private static void turns() {
        int[][] samples = {{0, 0}, {1, 0}, {0, 1}, {3, -2}, {-5, 7}};
        for (int k = 0; k < 4; k++) {
            eq(TURNS[k], Frame.rotation(k), "rotation(" + k + ")");
            for (int[] p : samples) {
                BlockPos r = new BlockPos(p[0], 4, p[1]).rotate(TURNS[k]);
                eq(r.getX(), Frame.rotX(k, p[0], p[1]), "rotX(" + k + ", " + p[0] + ", " + p[1] + ")");
                eq(r.getZ(), Frame.rotZ(k, p[0], p[1]), "rotZ(" + k + ", " + p[0] + ", " + p[1] + ")");
            }
            for (Direction d : FACINGS) {
                // A block turned with state.rotate must face where its position offset turns to.
                Direction turned = TURNS[k].rotate(d);
                eq(turned.getStepX(), Frame.rotX(k, d.getStepX(), d.getStepZ()), "rotX(" + k + ") follows " + d);
                eq(turned.getStepZ(), Frame.rotZ(k, d.getStepX(), d.getStepZ()), "rotZ(" + k + ") follows " + d);
            }
        }
        for (int file = 0; file < 4; file++) {
            for (int player = 0; player < 4; player++) {
                eq(FACINGS[player], TURNS[Frame.autoTurns(file, player)].rotate(FACINGS[file]),
                    "auto turns " + Frame.name(file) + " to " + Frame.name(player));
            }
            eq(0, Frame.autoTurns(-1, file), "a file without Facing is not turned");
        }
        int[][] degrees = {{0, 0}, {90, 1}, {180, 2}, {270, 3}, {45, -1}, {360, -1}, {-90, -1}};
        for (int[] d : degrees) {
            eq(d[1], Frame.turnsFromDegrees(d[0]), "turnsFromDegrees(" + d[0] + ")");
        }
    }

    private static void captureBoxes() {
        // Standing at (10, 64, 20); 2 forward, 1 to each side, 3 high: y from 63 to 65.
        eq(new int[] {9, 63, 18, 11, 65, 19}, Frame.captureBox(10, 64, 20, 0, 2, 1, 3), "capture box facing north");
        eq(new int[] {11, 63, 19, 12, 65, 21}, Frame.captureBox(10, 64, 20, 1, 2, 1, 3), "capture box facing east");
        eq(new int[] {9, 63, 21, 11, 65, 22}, Frame.captureBox(10, 64, 20, 2, 2, 1, 3), "capture box facing south");
        eq(new int[] {8, 63, 19, 9, 65, 21}, Frame.captureBox(10, 64, 20, 3, 2, 1, 3), "capture box facing west");
        eq(new int[] {0, -1, -1, 0, -1, -1}, Frame.captureBox(0, 0, 0, 0, 1, 0, 1), "smallest capture box");
        eq(new int[] {-8, -1, -16, 8, 10, -1}, Frame.captureBox(0, 0, 0, 0, 16, 8, 12), "default box facing north");
    }

    /**
     * 往后 (back, COMMANDS.md §2): f runs 1−back…front. Standing at (10, 64, 20); 4 forward, 2 back (own column and
     * one behind it), 1 to each side, 3 high.
     */
    private static void backBoxes() {
        eq(new int[] {9, 63, 16, 11, 65, 21}, Frame.captureBox(10, 64, 20, 0, 4, 2, 1, 3), "back box facing north");
        eq(new int[] {9, 63, 19, 14, 65, 21}, Frame.captureBox(10, 64, 20, 1, 4, 2, 1, 3), "back box facing east");
        eq(new int[] {9, 63, 19, 11, 65, 24}, Frame.captureBox(10, 64, 20, 2, 4, 2, 1, 3), "back box facing south");
        eq(new int[] {6, 63, 19, 11, 65, 21}, Frame.captureBox(10, 64, 20, 3, 4, 2, 1, 3), "back box facing west");
        // back 1 = only the column the player stands in; the card P2-006's box: (0, -60, 0) north, 3 / 7 / 2 / 3.
        eq(new int[] {10, 63, 18, 10, 63, 20}, Frame.captureBox(10, 64, 20, 0, 2, 1, 0, 1), "back 1 adds the own column");
        eq(new int[] {-2, -61, -3, 2, -59, 6}, Frame.captureBox(0, -60, 0, 0, 3, 7, 2, 3), "P2-006 box (back 7)");
        for (int facing = 0; facing < 4; facing++) {
            String f = Frame.name(facing);
            for (int[] r : new int[][] {{16, 8, 12}, {1, 0, 1}, {5, 3, 2}}) {
                eq(Frame.captureBox(3, -60, -7, facing, r[0], r[1], r[2]),
                    Frame.captureBox(3, -60, -7, facing, r[0], 0, r[1], r[2]), "back 0 is the old box facing " + f);
            }
            for (int back : new int[] {0, 1, 2, 7, 64}) {
                backCells(new int[] {-5, 70, 12}, facing, 3, back, 2, 4);
            }
            backCells(new int[] {0, -60, 0}, facing, 64, 64, 64, 64);
        }
    }

    /**
     * Every local (f, s, u) with f = 1−back…front lands inside the box one to one (stepping with Minecraft's own
     * Direction), the box holds nothing else, and Offset = lowest corner − S puts f = 1−back at the right edge.
     */
    private static void backCells(int[] s, int facing, int front, int back, int side, int height) {
        String what = "back cells " + front + "/" + back + "/" + side + "/" + height + " facing " + Frame.name(facing);
        int[] box = Frame.captureBox(s[0], s[1], s[2], facing, front, back, side, height);
        int w = box[3] - box[0] + 1;
        int h = box[4] - box[1] + 1;
        int l = box[5] - box[2] + 1;
        eq((2 * side + 1) * height * (front + back), w * h * l, what + ": volume");
        eq(facing % 2 == 0 ? 2 * side + 1 : front + back, w, what + ": size along x");
        eq(facing % 2 == 0 ? front + back : 2 * side + 1, l, what + ": size along z");
        Direction d = FACINGS[facing];
        BlockPos stand = new BlockPos(s[0], s[1], s[2]);
        boolean[] seen = new boolean[w * h * l];
        int dup = 0;
        int outside = 0;
        for (int f = 1 - back; f <= front; f++) {
            for (int si = -side; si <= side; si++) {
                for (int u = -1; u <= height - 2; u++) {
                    BlockPos p = stand.relative(d, f).relative(d.getClockWise(), si).above(u);
                    int x = p.getX() - box[0];
                    int y = p.getY() - box[1];
                    int z = p.getZ() - box[2];
                    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= l) {
                        outside++;
                        continue;
                    }
                    int i = x + z * w + y * w * l;
                    dup += seen[i] ? 1 : 0;
                    seen[i] = true;
                }
            }
        }
        eq(0, outside, what + ": every cell inside the box");
        eq(0, dup, what + ": no two cells on one block");
        // Offset: the farthest-behind column lies on the box's back edge, S's column is in the box iff back > 0.
        BlockPos farBack = stand.relative(d, 1 - back);
        check(farBack.getX() == box[0] || farBack.getX() == box[3] || farBack.getZ() == box[2] || farBack.getZ() == box[5],
            what + ": farthest column behind is on the edge");
        boolean ownColumn = s[0] >= box[0] && s[0] <= box[3] && s[2] >= box[2] && s[2] <= box[5];
        eq(back > 0, ownColumn, what + ": own column captured iff back > 0");
        eq(-1, box[1] - s[1], what + ": Offset y is the floor under the feet");
    }

    /**
     * COMMANDS.md §3: with auto turning, facing where you face, every cell lands where a capture from the new
     * spot would have read it (same forward / sideways / up steps).
     */
    private static void placeMatchesCapture(int[] a, int capFacing, int[] b, int placeFacing, int front, int back, int side,
                                            int height) {
        String what = "capture " + front + "/" + back + "/" + side + "/" + height + " at " + Arrays.toString(a)
            + " facing " + Frame.name(capFacing) + ", place at " + Arrays.toString(b) + " facing " + Frame.name(placeFacing);
        int[] cap = Frame.captureBox(a[0], a[1], a[2], capFacing, front, back, side, height);
        int w = cap[3] - cap[0] + 1;
        int h = cap[4] - cap[1] + 1;
        int l = cap[5] - cap[2] + 1;
        int ox = cap[0] - a[0];
        int oy = cap[1] - a[1];
        int oz = cap[2] - a[2];
        int k = Frame.autoTurns(capFacing, placeFacing);
        int[] expected = Frame.captureBox(b[0], b[1], b[2], placeFacing, front, back, side, height);
        eq(expected, Frame.placeBox(b[0], b[1], b[2], k, ox, oy, oz, w, h, l), what + ": box");
        // The same base PlaceCommand uses: standing point + offset turned.
        BuildPlan plan = new BuildPlan(null, w, h, l, k, b[0] + Frame.rotX(k, ox, oz), b[1] + oy,
            b[2] + Frame.rotZ(k, ox, oz), new BlockState[0], new int[w * h * l], new HashMap<>());
        eq(expected, plan.box(), what + ": plan box");
        Direction cf = FACINGS[capFacing];
        Direction pf = FACINGS[placeFacing];
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        int[][] steps = back == 0
            ? new int[][] {{1, -side, -1}, {front, side, height - 2}, {2, 0, 0}, {1, 1, 1}}
            : new int[][] {{1, -side, -1}, {front, side, height - 2}, {2, 0, 0}, {1, 1, 1}, {0, 0, 0}, {1 - back, -side, 1},
                {1 - back, side, -1}};
        for (int[] c : steps) {
            BlockPos read = new BlockPos(a[0], a[1], a[2]).relative(cf, c[0]).relative(cf.getClockWise(), c[1]).above(c[2]);
            int i = (read.getX() - cap[0]) + (read.getZ() - cap[2]) * w + (read.getY() - cap[1]) * w * l;
            BlockPos want = new BlockPos(b[0], b[1], b[2]).relative(pf, c[0]).relative(pf.getClockWise(), c[1]).above(c[2]);
            eq(want, plan.pos(i, p).immutable(), what + ": cell " + Arrays.toString(c));
        }
    }

    /** BuildPlan.pos maps the cells one to one onto the plan's box; onSurface marks exactly the outer shell. */
    private static void planCells() {
        int w = 3;
        int h = 4;
        int l = 5;
        for (int k = 0; k < 4; k++) {
            BuildPlan plan = new BuildPlan(null, w, h, l, k, 7, -60, -2, new BlockState[0], new int[w * h * l], new HashMap<>());
            int[] box = plan.box();
            Set<BlockPos> seen = new HashSet<>();
            int surface = 0;
            int outside = 0;
            BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
            for (int i = 0; i < w * h * l; i++) {
                BlockPos pos = plan.pos(i, p).immutable();
                outside += plan.inside(pos) ? 0 : 1;
                surface += plan.onSurface(pos) ? 1 : 0;
                seen.add(pos);
            }
            eq(0, outside, "k=" + k + ": every cell inside the box");
            eq(w * h * l, seen.size(), "k=" + k + ": cells land on different blocks");
            eq(k % 2 == 0 ? w : l, box[3] - box[0] + 1, "k=" + k + ": box size along x");
            eq(h, box[4] - box[1] + 1, "k=" + k + ": box height");
            eq(k % 2 == 0 ? l : w, box[5] - box[2] + 1, "k=" + k + ": box size along z");
            eq(w * h * l - (w - 2) * (h - 2) * (l - 2), surface, "k=" + k + ": cells on the surface");
            eq(new BlockPos(7, -60, -2), plan.pos(0, p).immutable(), "k=" + k + ": cell 0 is the base");
            check(!plan.inside(new BlockPos(box[3] + 1, box[1], box[2])), "k=" + k + ": block east of the box is outside");
        }
    }
}
