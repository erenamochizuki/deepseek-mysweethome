package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;

import java.lang.reflect.Constructor;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.electronwill.nightconfig.core.CommentedConfig;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.xiaojingyu.config.CaptureConfig;

import net.neoforged.fml.config.IConfigSpec;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * The capture range (COMMANDS.md §2): {@link CaptureRange}'s defaults and limits, and the mod config
 * ({@link CaptureConfig}, {@code config/xiaojingyu-common.toml}) that holds the numbers of the plain
 * {@code /xjy capture}: keys and order, defaults, ranges (so the config page draws sliders), what NeoForge does with
 * missing and out-of-range values, reading a loaded config, and the names and help lines in both lang files.
 */
final class CaptureRangeTests {
    private static final String LANG_PREFIX = "xiaojingyu.configuration.";

    private CaptureRangeTests() {
    }

    static void run(Path langDir) throws Exception {
        range();
        config();
        loaded();
        lang(langDir);
    }

    private static void range() {
        CaptureRange d = CaptureRange.DEFAULT;
        eq(new CaptureRange(16, 0, 8, 12), d, "default range is front 16, back 0, side 8, up 12");
        check(d.valid(), "default range is valid");
        eq(16 * 17 * 12, d.volume(), "default volume");
        eq("16 0 8 12", d.numbers(), "numbers() in the order of /xjy capture 范围");
        eq(64, CaptureRange.MAX, "at most 64 in every direction");
        eq(1_056_768, CaptureRange.MAX_VOLUME, "biggest capture = 129 × 64 × 128");
        eq(CaptureRange.MAX_VOLUME, new CaptureRange(64, 64, 64, 64).volume(), "MAX_VOLUME is the volume of 64/64/64/64");
        check(new CaptureRange(64, 64, 64, 64).valid(), "64 everywhere is valid");
        check(new CaptureRange(1, 0, 0, 1).valid(), "1 / 0 / 0 / 1 is valid (back and side may be 0)");
        CaptureRange[] bad = {new CaptureRange(0, 0, 8, 12), new CaptureRange(65, 0, 8, 12), new CaptureRange(16, -1, 8, 12),
            new CaptureRange(16, 65, 8, 12), new CaptureRange(16, 0, -1, 12), new CaptureRange(16, 0, 65, 12),
            new CaptureRange(16, 0, 8, 0), new CaptureRange(16, 0, 8, 65)};
        for (CaptureRange r : bad) {
            check(!r.valid(), r + " is not valid");
        }
        eq(new CaptureRange(16, 7, 8, 12), d.withBack(7), "withBack keeps the other three");
        eq(23, d.withBack(7).length(), "length = front + back");
        eq(Frame.captureBox(5, 70, -3, 2, 16, 7, 8, 12), d.withBack(7).box(5, 70, -3, 2), "box() is Frame.captureBox");
    }

    private static void config() {
        eq(List.of("captureFront", "captureBack", "captureSide", "captureUp"), CaptureConfig.KEYS, "config keys and their order");
        ModConfigSpec spec = CaptureConfig.SPEC;
        eq(new ArrayList<>(CaptureConfig.KEYS), new ArrayList<>(spec.getValues().valueMap().keySet()),
            "the config page shows the values in this order (front, back, side, up)");
        int[] defaults = {16, 0, 8, 12};
        int[] mins = {CaptureRange.MIN_FRONT, CaptureRange.MIN_BACK, CaptureRange.MIN_SIDE, CaptureRange.MIN_UP};
        eq(new int[] {1, 0, 0, 1}, mins, "front and up at least 1, back and side may be 0");
        ModConfigSpec.IntValue[] values = {CaptureConfig.FRONT_VALUE, CaptureConfig.BACK_VALUE, CaptureConfig.SIDE_VALUE,
            CaptureConfig.UP_VALUE};
        for (int i = 0; i < 4; i++) {
            String key = CaptureConfig.KEYS.get(i);
            Object raw = spec.getSpec().get(key);
            check(raw instanceof ModConfigSpec.ValueSpec, key + " has a ValueSpec");
            if (!(raw instanceof ModConfigSpec.ValueSpec vs)) {
                continue;
            }
            eq(defaults[i], vs.getDefault(), key + " default");
            eq(defaults[i], values[i].getDefault(), key + " IntValue default");
            eq(List.of(key), values[i].getPath(), key + " path (top level, no section: the sliders are on the first page)");
            ModConfigSpec.Range<Integer> r = vs.getRange();
            check(r != null, key + " has a range");
            if (r != null) {
                eq(mins[i], r.getMin(), key + " min");
                eq(CaptureRange.MAX, r.getMax(), key + " max");
                // ConfigurationSectionScreen.createIntegerValue: a slider when max − min < 256 (MAX_SLIDER_SIZE).
                check(r.getMax() - r.getMin() < 256, key + " range is small enough for a slider");
            }
            eq(ModConfigSpec.RestartType.NONE, vs.restartType(), key + " needs no restart");
            String comment = vs.getComment();
            check(comment != null && !comment.isBlank() && comment.chars().anyMatch(c -> c >= 0x4E00 && c <= 0x9FFF),
                key + " has a comment with Chinese in it (what Notepad shows above the line)");
            check(comment != null && comment.contains("Range: " + mins[i] + " ~ 64"), key + " comment shows the range");
        }
        // What NeoForge does with the file: missing keys get the defaults, numbers out of range are clamped,
        // anything else becomes the default (ConfigTracker.loadConfig → isCorrect / correct).
        CommentedConfig empty = CommentedConfig.inMemory();
        check(!spec.isCorrect(empty), "an empty file is not correct");
        spec.correct(empty);
        check(spec.isCorrect(empty), "after correct() it is");
        for (int i = 0; i < 4; i++) {
            eq(defaults[i], empty.getInt(CaptureConfig.KEYS.get(i)), "missing " + CaptureConfig.KEYS.get(i) + " becomes the default");
        }
        CommentedConfig wild = CommentedConfig.inMemory();
        wild.set("captureFront", 0);
        wild.set("captureBack", 100);
        wild.set("captureSide", -3);
        wild.set("captureUp", "lots");
        wild.set("somethingElse", 5);
        spec.correct(wild);
        eq(1, wild.getInt("captureFront"), "front 0 is clamped to 1");
        eq(64, wild.getInt("captureBack"), "back 100 is clamped to 64");
        eq(0, wild.getInt("captureSide"), "side −3 is clamped to 0");
        eq(12, wild.getInt("captureUp"), "up \"lots\" becomes the default 12");
        check(!wild.contains("somethingElse"), "unknown keys are dropped");
        CommentedConfig fine = CommentedConfig.inMemory();
        spec.correct(fine);
        fine.set("captureBack", 7);
        check(spec.isCorrect(fine), "back 7 is a correct file (not rewritten)");
    }

    /** Through the real spec: not loaded → defaults; loaded → the file's numbers; the config page's set() → at once. */
    private static void loaded() throws Exception {
        check(!CaptureConfig.SPEC.isLoaded(), "nothing loads the config in this JVM");
        eq(CaptureRange.DEFAULT, CaptureConfig.current(), "not loaded yet: the defaults");
        CommentedConfig c = CommentedConfig.inMemory();
        CaptureConfig.SPEC.correct(c);
        c.set("captureFront", 3);
        c.set("captureBack", 7);
        c.set("captureSide", 2);
        c.set("captureUp", 3);
        // LoadedConfig is FML's package-private record (path null = not written anywhere); the config is correct,
        // so acceptConfig does not try to save it.
        Class<?> cls = Class.forName("net.neoforged.fml.config.LoadedConfig");
        Constructor<?> ctor = cls.getDeclaredConstructor(CommentedConfig.class, Path.class, ModConfig.class);
        ctor.setAccessible(true);
        IConfigSpec.ILoadedConfig loaded = (IConfigSpec.ILoadedConfig) ctor.newInstance(c, null, null);
        CaptureConfig.SPEC.acceptConfig(loaded);
        try {
            check(CaptureConfig.SPEC.isLoaded(), "loaded");
            eq(new CaptureRange(3, 7, 2, 3), CaptureConfig.current(), "current() reads the loaded file");
            CaptureConfig.BACK_VALUE.set(5);
            eq(new CaptureRange(3, 5, 2, 3), CaptureConfig.current(), "a slider (set) takes effect at once");
            c.set("captureBack", 9);
            CaptureConfig.SPEC.afterReload();
            eq(9, CaptureConfig.current().back(), "after a reload (the file changed) the new number counts");
        } finally {
            CaptureConfig.SPEC.acceptConfig(null);
        }
        eq(CaptureRange.DEFAULT, CaptureConfig.current(), "unloaded again: the defaults");
    }

    /** Each value has a name and a one-line help in both languages; the page title and the extra rows too. */
    private static void lang(Path langDir) throws Exception {
        Map<String, String> zh = load(langDir.resolve("zh_cn.json"));
        Map<String, String> en = load(langDir.resolve("en_us.json"));
        List<String> keys = new ArrayList<>();
        for (String k : CaptureConfig.KEYS) {
            keys.add(LANG_PREFIX + k);
            keys.add(LANG_PREFIX + k + ".tooltip");
        }
        // ConfigurationScreen: the title, the button and the title of the file's page (file name with dots).
        keys.add(LANG_PREFIX + "title");
        keys.add(LANG_PREFIX + "section.xiaojingyu.common.toml");
        keys.add(LANG_PREFIX + "section.xiaojingyu.common.toml.title");
        for (String k : List.of("blacklist", "blacklist.button", "blacklist.tooltip", "blacklist.not_in_world",
            "blacklist.no_mod", "blacklist.no_permission", "on_server.label", "on_server", "on_server.tooltip")) {
            keys.add(LANG_PREFIX + k);
        }
        for (String k : keys) {
            check(!zh.getOrDefault(k, "").isBlank(), "zh_cn has " + k);
            check(!en.getOrDefault(k, "").isBlank(), "en_us has " + k);
        }
        for (String k : zh.keySet()) {
            if (k.startsWith(LANG_PREFIX)) {
                check(keys.contains(k), k + " is one the config page uses");
            }
        }
        eq("往前几格", zh.get(LANG_PREFIX + "captureFront"), "zh name of front");
        eq("往后几格", zh.get(LANG_PREFIX + "captureBack"), "zh name of back");
        eq("左右各几格", zh.get(LANG_PREFIX + "captureSide"), "zh name of side");
        eq("往上几层", zh.get(LANG_PREFIX + "captureUp"), "zh name of up");
        // The /xjy status line ends with the same four numbers in both languages (card P2-006 waits for them).
        String zhStatus = zh.getOrDefault("xiaojingyu.command.status.capture_range", "");
        String enStatus = en.getOrDefault("xiaojingyu.command.status.capture_range", "");
        check(zhStatus.contains("范围 %5$s"), "zh status line shows /xjy capture 范围 <numbers>");
        check(enStatus.contains("range %5$s"), "en status line shows /xjy capture range <numbers>");
    }

    private static Map<String, String> load(Path file) throws Exception {
        return new Gson().fromJson(Files.readString(file, StandardCharsets.UTF_8),
            new TypeToken<LinkedHashMap<String, String>>() { }.getType());
    }
}
