package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;

import java.util.Set;

import com.xiaojingyu.build.CaptureFilter.Kind;

/**
 * What capture writes for a block (COMMANDS.md §2「黑名单和液体」): blacklisted blocks and liquids become air,
 * waterlogged blocks lose the water, seagrass and kelp stay. The states are written the way
 * {@code BlockStateParser.serialize} writes them in 26.1.2 (properties in alphabetical order).
 */
final class CaptureFilterTests {
    private static final Set<String> LIST = Set.of("minecraft:stone", "minecraft:oak_planks", "xiaojingyu:dining_table");
    private static final String STAIRS_WET = "minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=true]";
    private static final String STAIRS_DRY = "minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]";

    private CaptureFilterTests() {
    }

    static void run() {
        // On the list: every state of the block becomes air.
        same("minecraft:stone", Kind.BLACKLISTED, CaptureFilter.AIR);
        same("minecraft:oak_planks", Kind.BLACKLISTED, CaptureFilter.AIR);
        same("xiaojingyu:dining_table[facing=north]", Kind.BLACKLISTED, CaptureFilter.AIR);
        same("xiaojingyu:dining_table[facing=east]", Kind.BLACKLISTED, CaptureFilter.AIR);
        eq(Kind.KEEP, CaptureFilter.kind("minecraft:stone", false, Set.of()), "stone with an empty list is kept");
        eq(Kind.KEEP, CaptureFilter.kind("minecraft:stone_bricks", false, LIST), "stone_bricks is not stone");
        eq(Kind.KEEP, CaptureFilter.kind("minecraft:stone_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]",
            false, LIST), "stone_stairs is not stone");

        // Liquids: water and lava, source and flowing and falling, and bubble columns.
        for (String s : new String[] {"minecraft:water[level=0]", "minecraft:water[level=3]", "minecraft:water[level=8]",
            "minecraft:lava[level=0]", "minecraft:lava[level=4]", "minecraft:lava[level=15]",
            "minecraft:bubble_column[drag=true]", "minecraft:bubble_column[drag=false]"}) {
            same(s, Kind.LIQUID, CaptureFilter.AIR);
            eq(Kind.LIQUID, CaptureFilter.kind(s, true, Set.of()), s + " (game says liquid)");
        }
        // Another mod's LiquidBlock: the game passes liquid = true.
        eq(Kind.LIQUID, CaptureFilter.kind("othermod:oil[level=0]", true, Set.of()), "a modded LiquidBlock is air");
        eq(Kind.KEEP, CaptureFilter.kind("othermod:oil_lamp", false, Set.of()), "not a liquid when the game says so");

        // Waterlogged: the block stays, the water goes.
        same(STAIRS_WET, Kind.DRY, STAIRS_DRY);
        same(STAIRS_DRY, Kind.KEEP, STAIRS_DRY);
        same("minecraft:oak_slab[type=bottom,waterlogged=true]", Kind.DRY, "minecraft:oak_slab[type=bottom,waterlogged=false]");
        same("minecraft:lantern[hanging=false,waterlogged=true]", Kind.DRY, "minecraft:lantern[hanging=false,waterlogged=false]");
        same("minecraft:oak_fence[east=false,north=true,south=false,waterlogged=true,west=false]", Kind.DRY,
            "minecraft:oak_fence[east=false,north=true,south=false,waterlogged=false,west=false]");
        same("minecraft:oak_sign[rotation=4,waterlogged=true]", Kind.DRY, "minecraft:oak_sign[rotation=4,waterlogged=false]");
        same("minecraft:chest[facing=south,type=single,waterlogged=true]", Kind.DRY,
            "minecraft:chest[facing=south,type=single,waterlogged=false]");
        // A listed waterlogged block is air, not dry.
        eq(CaptureFilter.AIR, CaptureFilter.apply(STAIRS_WET, false, Set.of("minecraft:oak_stairs")), "listed wet stairs → air");
        // Only the exact property counts.
        same("othermod:pipe[notwaterlogged=true]", Kind.KEEP, "othermod:pipe[notwaterlogged=true]");
        same("othermod:pipe[waterlogged=truely]", Kind.KEEP, "othermod:pipe[waterlogged=truely]");

        // Plants that are blocks are written as they are (seagrass and kelp hold water but are not liquids).
        for (String s : new String[] {"minecraft:seagrass", "minecraft:tall_seagrass[half=lower]", "minecraft:kelp[age=5]",
            "minecraft:kelp_plant", "minecraft:short_grass", "minecraft:sea_pickle[pickles=2,waterlogged=false]"}) {
            same(s, Kind.KEEP, s);
        }
        // Air stays air (nothing to count), even if someone wrote it on the list.
        same("minecraft:air", Kind.KEEP, "minecraft:air");
        eq(Kind.KEEP, CaptureFilter.kind("minecraft:cave_air", false, Set.of("minecraft:cave_air")), "cave_air is kept");

        // Helpers.
        eq("minecraft:oak_stairs", CaptureFilter.blockId(STAIRS_WET), "blockId with properties");
        eq("minecraft:seagrass", CaptureFilter.blockId("minecraft:seagrass"), "blockId without properties");
        check(CaptureFilter.waterlogged(STAIRS_WET) && !CaptureFilter.waterlogged(STAIRS_DRY), "waterlogged()");
        eq("minecraft:stone", CaptureFilter.dry("minecraft:stone"), "dry() of a plain block");
        eq(STAIRS_DRY, CaptureFilter.dry(STAIRS_DRY), "dry() of a dry block");
    }

    private static void same(String state, Kind kind, String written) {
        eq(kind, CaptureFilter.kind(state, false, LIST), "kind of " + state);
        eq(written, CaptureFilter.apply(state, false, LIST), "written for " + state);
    }
}
