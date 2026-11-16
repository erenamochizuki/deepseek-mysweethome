package com.xiaojingyu.build;

import java.util.Set;

/**
 * What {@code /xjy capture} writes for one block (COMMANDS.md §2「黑名单和液体」): blocks on the capture
 * blacklist and liquids (water, lava, flowing or source, and bubble columns) become air; a waterlogged
 * block keeps its block but loses the water ({@code waterlogged=false}). Everything else, seagrass and
 * kelp included, is written as it is.
 *
 * <p>Works on {@code BlockStateParser.serialize} strings ({@code id[prop=value,…]}), so it runs in a
 * plain JVM (cmdTest) without a game. The capture code turns the decision back into a BlockState.
 */
public final class CaptureFilter {
    public static final String AIR = "minecraft:air";
    /** Liquid blocks by id. In the game any {@code LiquidBlock} counts too (the {@code liquid} argument). */
    public static final Set<String> LIQUIDS = Set.of("minecraft:water", "minecraft:lava", "minecraft:bubble_column");
    private static final Set<String> AIRS = Set.of("minecraft:air", "minecraft:cave_air", "minecraft:void_air");
    private static final String WET = "waterlogged=true";
    private static final String DRY = "waterlogged=false";

    /** What happens to one block. */
    public enum Kind {
        /** Written as it is. */
        KEEP,
        /** On the blacklist: written as air. */
        BLACKLISTED,
        /** Water, lava or a bubble column: written as air. */
        LIQUID,
        /** A waterlogged block: written with waterlogged=false. */
        DRY
    }

    private CaptureFilter() {
    }

    /**
     * @param state     the serialized block state
     * @param liquid    true when the game says the block is a liquid ({@code LiquidBlock}) or a bubble column
     * @param blacklist block ids on the blacklist (every state of a listed block counts)
     */
    public static Kind kind(String state, boolean liquid, Set<String> blacklist) {
        String id = blockId(state);
        if (AIRS.contains(id)) {
            return Kind.KEEP;
        }
        if (blacklist.contains(id)) {
            return Kind.BLACKLISTED;
        }
        if (liquid || LIQUIDS.contains(id)) {
            return Kind.LIQUID;
        }
        return waterlogged(state) ? Kind.DRY : Kind.KEEP;
    }

    /** The state string that goes into the file. */
    public static String apply(String state, boolean liquid, Set<String> blacklist) {
        return switch (kind(state, liquid, blacklist)) {
            case KEEP -> state;
            case BLACKLISTED, LIQUID -> AIR;
            case DRY -> dry(state);
        };
    }

    /** "minecraft:oak_stairs[facing=north]" → "minecraft:oak_stairs". */
    public static String blockId(String state) {
        int i = state.indexOf('[');
        return i < 0 ? state : state.substring(0, i);
    }

    /** True when the state has the property waterlogged=true. */
    public static boolean waterlogged(String state) {
        int open = state.indexOf('[');
        if (open < 0 || !state.endsWith("]")) {
            return false;
        }
        for (String p : state.substring(open + 1, state.length() - 1).split(",")) {
            if (p.equals(WET)) {
                return true;
            }
        }
        return false;
    }

    /** The same state with waterlogged=false (unchanged if it is not waterlogged). */
    public static String dry(String state) {
        if (!waterlogged(state)) {
            return state;
        }
        int open = state.indexOf('[');
        String[] props = state.substring(open + 1, state.length() - 1).split(",");
        StringBuilder sb = new StringBuilder(state.length()).append(state, 0, open + 1);
        for (int i = 0; i < props.length; i++) {
            sb.append(i == 0 ? "" : ",").append(props[i].equals(WET) ? DRY : props[i]);
        }
        return sb.append(']').toString();
    }
}
