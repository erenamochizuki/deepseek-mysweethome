package com.xiaojingyu.config;

import java.util.List;

import com.xiaojingyu.build.CaptureRange;

import net.neoforged.fml.ModContainer;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * The mod's settings: how far the plain {@code /xjy capture} reaches (COMMANDS.md §2). One COMMON config for the
 * whole game, all worlds share it: {@code <game dir>/config/xiaojingyu-common.toml}. NeoForge reads it at start-up,
 * re-reads it when the file changes (FML's config watcher) and the config screen (模组 → 小鲸鱼之家 → 配置) shows each
 * value as a slider, because each has a range smaller than 256. Nothing here is synced: on a dedicated server the
 * server's own file counts, a client's screen only changes the client's file (its single-player games).
 *
 * <p>Names on the screen are the lang keys {@code xiaojingyu.configuration.<key>}, the one-line help is
 * {@code xiaojingyu.configuration.<key>.tooltip}; the comments below are what a text editor shows in the file.
 */
public final class CaptureConfig {
    public static final String FRONT = "captureFront";
    public static final String BACK = "captureBack";
    public static final String SIDE = "captureSide";
    public static final String UP = "captureUp";
    /** The keys in the order the screen and the file show them (front, back, sides, up). */
    public static final List<String> KEYS = List.of(FRONT, BACK, SIDE, UP);

    public static final ModConfigSpec SPEC;
    public static final ModConfigSpec.IntValue FRONT_VALUE;
    public static final ModConfigSpec.IntValue BACK_VALUE;
    public static final ModConfigSpec.IntValue SIDE_VALUE;
    public static final ModConfigSpec.IntValue UP_VALUE;

    static {
        CaptureRange d = CaptureRange.DEFAULT;
        int max = CaptureRange.MAX;
        ModConfigSpec.Builder b = new ModConfigSpec.Builder();
        FRONT_VALUE = b.comment(
                " 不写数字的 /xjy capture 往前抓几格：从面前那一格算起（自己站的这一列不算）。",
                " How many blocks the plain /xjy capture takes in front of you, starting with the one in front.")
            .defineInRange(FRONT, d.front(), CaptureRange.MIN_FRONT, max);
        BACK_VALUE = b.comment(
                " 往后抓几格：从自己站的这一格算起往身后数；0 = 身后不抓，1 = 只多抓自己站的这一列。",
                " 只写 3 个数字的 /xjy capture <前> <左右> <高> 也用这里的往后。",
                " How many blocks behind you, starting with the column you stand in; 0 = nothing behind.",
                " /xjy capture <front> <side> <up> (three numbers) uses this back too.")
            .defineInRange(BACK, d.back(), CaptureRange.MIN_BACK, max);
        SIDE_VALUE = b.comment(
                " 左右两边各抓几格（两边一样），宽 = 2 × 左右 + 1。",
                " How many blocks on each side (both sides the same); width = 2 × side + 1.")
            .defineInRange(SIDE, d.side(), CaptureRange.MIN_SIDE, max);
        UP_VALUE = b.comment(
                " 往上抓几层：从脚下踩的那一层算起。",
                " How many layers, starting with the floor under your feet.")
            .defineInRange(UP, d.up(), CaptureRange.MIN_UP, max);
        SPEC = b.build();
    }

    private CaptureConfig() {
    }

    /** Mod constructor: registers the COMMON config ({@code config/xiaojingyu-common.toml}). */
    public static void register(ModContainer container) {
        container.registerConfig(ModConfig.Type.COMMON, SPEC);
    }

    /**
     * The range the plain {@code /xjy capture} uses now (the file is re-read when it changes, the screen sets the
     * value at once). Before the config is loaded, or if a value is somehow out of range, the defaults.
     */
    public static CaptureRange current() {
        if (!SPEC.isLoaded()) {
            return CaptureRange.DEFAULT;
        }
        CaptureRange r;
        try {
            r = new CaptureRange(FRONT_VALUE.getAsInt(), BACK_VALUE.getAsInt(), SIDE_VALUE.getAsInt(), UP_VALUE.getAsInt());
        } catch (IllegalStateException e) {
            return CaptureRange.DEFAULT; // unloaded between the check and the read (the file watcher swaps configs)
        }
        return r.valid() ? r : CaptureRange.DEFAULT;
    }
}
