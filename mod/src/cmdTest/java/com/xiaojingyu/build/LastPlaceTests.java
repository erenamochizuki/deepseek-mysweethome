package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.mojang.serialization.DataResult;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.IntArrayTag;
import net.minecraft.nbt.IntTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.Tag;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;

/**
 * {@code /xjy capture 上次} (COMMANDS.md §2b) without a game: turning back, the box and cell positions of a
 * placement (the same numbers {@code PlaceCommand} and {@code Capture.read} use), the saved record and its NBT,
 * the default file name. How block states turn back (stairs, doors, beds, furniture) needs the game's blocks,
 * which a plain JVM cannot make (NEOFORGE-26.1-API.md §12.6): card P4-003 checks those in the game.
 */
final class LastPlaceTests {
    private static final Direction[] FACINGS = {Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST};
    private static final UUID ALICE = UUID.fromString("0f8fad5b-d9cb-469f-a165-70867728950e");
    private static final UUID BOB = UUID.fromString("7c9e6679-7425-40de-944b-e07fc1f90ae7");

    private LastPlaceTests() {
    }

    static void run() {
        turnBack();
        houseBoxes();
        for (int k = 0; k < 4; k++) {
            placeThenCaptureBack(k, new int[] {7, -60, -3}, new int[] {-2, -1, -4}, new int[] {3, 2, 5});
            placeThenCaptureBack(k, new int[] {0, 64, 0}, new int[] {0, 0, 0}, new int[] {1, 1, 1});
        }
        recordNbt();
        history();
        names();
    }

    /** k then back(k) is no turn at all: positions and every horizontal facing come back (state.rotate uses these). */
    private static void turnBack() {
        for (int k = 0; k < 4; k++) {
            int b = Frame.back(k);
            eq((4 - k) % 4, b, "back(" + k + ")");
            eq(Rotation.NONE, Frame.rotation(k).getRotated(Frame.rotation(b)), "rotation(" + k + ") then back is NONE");
            for (Direction d : FACINGS) {
                eq(d, Frame.rotation(b).rotate(Frame.rotation(k).rotate(d)), "facing " + d + " turned " + k + " and back");
            }
            int[][] samples = {{0, 0}, {3, -2}, {-5, 7}};
            for (int[] p : samples) {
                int x = Frame.rotX(k, p[0], p[1]);
                int z = Frame.rotZ(k, p[0], p[1]);
                eq(p[0], Frame.rotX(b, x, z), "x of " + Arrays.toString(p) + " turned " + k + " and back");
                eq(p[1], Frame.rotZ(b, x, z), "z of " + Arrays.toString(p) + " turned " + k + " and back");
            }
        }
    }

    /** The house (fixtures/house-v4, 20 × 12 × 23, Offset [−9, 0, −15]) as card P4-003 places it. */
    private static void houseBoxes() {
        int[] off = {-9, 0, -15};
        int[] size = {20, 12, 23};
        PlaceRecord north = record(new int[] {0, -60, 0}, 0, off, size);
        eq(new int[] {-9, -60, -15, 10, -49, 7}, north.box(), "house placed facing north, not turned");
        eq(new int[] {0, -59, -5}, north.worldOf(9, 1, 10), "house door, not turned");
        // Turned 90° at (40, −60, 40): x from 40 − (−15 + 22) to 40 + 15, z from 40 − 9 to 40 + 10.
        PlaceRecord turned = record(new int[] {40, -60, 40}, 1, off, size);
        eq(new int[] {33, -60, 31, 55, -49, 50}, turned.box(), "house turned 90°");
        eq(new int[] {45, -59, 40}, turned.worldOf(9, 1, 10), "house door, turned 90°");
        eq(new int[] {55, -60, 31}, turned.worldOf(0, 0, 0), "cell 0 turned 90° = standing + rot(Offset)");
        eq(5520, turned.volume(), "house volume");
    }

    /**
     * A "world" filled the way PlaceCommand fills it (BuildPlan with the record's base), then read back the way
     * capture 上次 reads it (record.worldOf, positions turned back): every cell comes back to where it was.
     */
    private static void placeThenCaptureBack(int k, int[] standing, int[] off, int[] size) {
        String what = "k=" + k + " at " + Arrays.toString(standing) + " offset " + Arrays.toString(off);
        PlaceRecord r = record(standing, k, off, size);
        int w = size[0];
        int h = size[1];
        int l = size[2];
        eq(Frame.placeBox(standing[0], standing[1], standing[2], k, off[0], off[1], off[2], w, h, l), r.box(), what + ": box");
        BuildPlan plan = new BuildPlan(null, w, h, l, k, r.baseX(), r.baseY(), r.baseZ(), new BlockState[0],
            new int[w * h * l], new HashMap<>());
        eq(plan.box(), r.box(), what + ": plan box = record box");
        Map<BlockPos, Integer> world = new HashMap<>();
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        for (int i = 0; i < w * h * l; i++) {
            world.put(plan.pos(i, p).immutable(), i);
        }
        eq(w * h * l, world.size(), what + ": cells land on different blocks");
        int bad = 0;
        int i = 0;
        for (int y = 0; y < h; y++) {
            for (int z = 0; z < l; z++) {
                for (int x = 0; x < w; x++, i++) {
                    int[] at = r.worldOf(x, y, z);
                    Integer got = world.get(new BlockPos(at[0], at[1], at[2]));
                    if (got == null || got != i) {
                        bad++;
                    }
                }
            }
        }
        eq(0, bad, what + ": cells read back where they were placed");
    }

    /** The record's NBT (NbtOps, as the world saves it) and back. */
    private static void recordNbt() {
        PlaceRecord r = new PlaceRecord(7, "house-v4-b.png", "minecraft:overworld", new int[] {40, -60, 40}, 0, 1, "90",
            new int[] {-9, 0, -15}, new int[] {20, 12, 23}, 0, 1_762_000_000_000L);
        Tag tag = PlaceRecord.CODEC.encodeStart(NbtOps.INSTANCE, r).getOrThrow();
        check(tag instanceof CompoundTag, "record NBT is a compound");
        CompoundTag c = (CompoundTag) tag;
        eq("house-v4-b.png", c.getStringOr("file", null), "record NBT file");
        eq(90, c.getIntOr("turn", -1), "record NBT turn is in degrees");
        eq("north", c.getStringOr("player_facing", null), "record NBT player_facing");
        eq("north", c.getStringOr("file_facing", null), "record NBT file_facing");
        check(c.get("standing") instanceof IntArrayTag, "standing is an int array");
        check(c.get("box") instanceof IntArrayTag box && Arrays.equals(box.getAsIntArray(), r.box()), "box written for people to read");
        eq(r, PlaceRecord.CODEC.parse(NbtOps.INSTANCE, c).getOrThrow(), "record NBT reads back");

        PlaceRecord noFacing = new PlaceRecord(1, "we.schem", "minecraft:the_nether", new int[] {0, 64, 0}, 3, 0, "auto",
            new int[] {0, 0, 0}, new int[] {1, 2, 3}, -1, 0L);
        CompoundTag nf = (CompoundTag) PlaceRecord.CODEC.encodeStart(NbtOps.INSTANCE, noFacing).getOrThrow();
        check(!nf.contains("file_facing"), "a file without Facing writes no file_facing");
        eq(noFacing, PlaceRecord.CODEC.parse(NbtOps.INSTANCE, nf).getOrThrow(), "record without file facing reads back");

        CompoundTag box = c.copy();
        box.put("box", new IntArrayTag(new int[] {0, 0, 0, 0, 0, 0}));
        eq(r, PlaceRecord.CODEC.parse(NbtOps.INSTANCE, box).getOrThrow(), "box is worked out again, not read");
        CompoundTag badTurn = c.copy();
        badTurn.put("turn", IntTag.valueOf(45));
        check(PlaceRecord.CODEC.parse(NbtOps.INSTANCE, badTurn).isError(), "turn 45 is refused");
        CompoundTag badSize = c.copy();
        badSize.put("size", new IntArrayTag(new int[] {20, 0, 23}));
        check(PlaceRecord.CODEC.parse(NbtOps.INSTANCE, badSize).isError(), "size 0 is refused");
        CompoundTag shortArray = c.copy();
        shortArray.put("offset", new IntArrayTag(new int[] {1, 2}));
        check(PlaceRecord.CODEC.parse(NbtOps.INSTANCE, shortArray).isError(), "offset with 2 numbers is refused");
        eq("auto", PlaceRecord.mode(-1), "mode(-1)");
        eq("270", PlaceRecord.mode(270), "mode(270)");
    }

    /** Newest first, at most KEEP per player, ids never reused, undo takes one out; survives a save. */
    private static void history() {
        LastPlaces d = new LastPlaces();
        check(d.latest(ALICE) == null, "nothing placed yet");
        check(!d.isDirty(), "a new record list is not dirty");
        int first = d.add(ALICE, record(new int[] {0, -60, 0}, 0, new int[] {0, 0, 0}, new int[] {1, 1, 1}));
        check(d.isDirty(), "add marks it to be saved");
        int second = d.add(ALICE, record(new int[] {5, -60, 0}, 1, new int[] {0, 0, 0}, new int[] {2, 1, 1}));
        d.add(BOB, record(new int[] {9, -60, 9}, 2, new int[] {0, 0, 0}, new int[] {1, 1, 1}));
        check(second > first, "ids go up");
        eq(second, d.latest(ALICE).id(), "latest is the newest");
        eq(5, d.latest(ALICE).standing()[0], "latest is Alice's second place");
        eq(9, d.latest(BOB).standing()[0], "players are kept apart");
        check(d.remove(ALICE, second), "undo of the second place takes it out");
        eq(first, d.latest(ALICE).id(), "after undo, the place before is the last one again");
        check(!d.remove(ALICE, second), "taking it out twice does nothing");
        check(d.remove(ALICE, first), "undo of the first place");
        check(d.latest(ALICE) == null, "after undoing every place, nothing is left");
        for (int n = 0; n < LastPlaces.KEEP + 3; n++) {
            d.add(ALICE, record(new int[] {n, -60, 0}, 0, new int[] {0, 0, 0}, new int[] {1, 1, 1}));
        }
        List<PlaceRecord> list = d.history(ALICE);
        eq(LastPlaces.KEEP, list.size(), "at most KEEP places per player");
        eq(LastPlaces.KEEP + 2, list.getFirst().standing()[0], "newest first");

        Tag saved = LastPlaces.CODEC.encodeStart(NbtOps.INSTANCE, d).getOrThrow();
        check(saved instanceof CompoundTag sc && sc.getCompoundOrEmpty("players").contains(ALICE.toString()),
            "players are saved under their UUID as text");
        LastPlaces back = LastPlaces.CODEC.parse(NbtOps.INSTANCE, saved).getOrThrow();
        eq(d.history(ALICE), back.history(ALICE), "Alice's places read back");
        eq(d.history(BOB), back.history(BOB), "Bob's places read back");
        int next = back.add(BOB, record(new int[] {1, 2, 3}, 0, new int[] {0, 0, 0}, new int[] {1, 1, 1}));
        check(next > d.latest(ALICE).id(), "ids after loading do not repeat old ones");
        DataResult<LastPlaces> empty = LastPlaces.CODEC.parse(NbtOps.INSTANCE, new CompoundTag());
        check(empty.isSuccess() && empty.getOrThrow().latest(ALICE) == null, "an empty compound is an empty list");
    }

    private static void names() {
        String t = "20261107-121530";
        eq("house-v4-b-" + t, FileNames.lastCaptureName("house-v4-b.png", t), "default name from a .png");
        eq("小屋-" + t, FileNames.lastCaptureName("小屋.schem", t), "default name from a .schem");
        eq("house-" + t, FileNames.lastCaptureName("house-20261106-080000.png", t), "an older time stamp is replaced");
        eq("house-" + t, FileNames.lastCaptureName("house-20261106-080000-2.PNG", t), "time stamp with -2");
        eq("a..b-" + t, FileNames.lastCaptureName("a..b.png", t), "dots in the name stay");
        eq(t, FileNames.lastCaptureName(".png", t), "nothing left: just the time");
    }

    private static PlaceRecord record(int[] standing, int k, int[] off, int[] size) {
        return new PlaceRecord(0, "t.png", "minecraft:overworld", standing, 0, k, PlaceRecord.mode(k * 90), off, size, 0, 0L);
    }
}
