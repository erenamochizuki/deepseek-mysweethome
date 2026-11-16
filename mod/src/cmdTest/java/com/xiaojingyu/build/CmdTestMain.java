package com.xiaojingyu.build;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;

/**
 * Small checks for the /xjy commands that need no running game (docs/COMMANDS.md): coordinates and
 * turning (the capture box, behind too), file names, the preview picture, the translation files, the capture
 * filter and blacklist file, the capture range config (defaults, ranges, sliders), the photos (check, album
 * paging, which picture frame a click hits),
 * and that the common classes never name client-only classes. {@code gradlew cmdTest} runs them;
 * {@code check} (so {@code build}) runs them too. Not part of the mod and never in the jar.
 *
 * <pre>CmdTestMain --lang DIR --src DIR --format-doc FILE --classes DIR</pre>
 */
public final class CmdTestMain {
    private static final List<String> FAILURES = new ArrayList<>();
    private static int checks;

    private CmdTestMain() {
    }

    public static void main(String[] args) {
        Path lang = null;
        Path src = null;
        Path formatDoc = null;
        Path classes = null;
        for (int i = 0; i + 1 < args.length; i += 2) {
            switch (args[i]) {
                case "--lang" -> lang = Path.of(args[i + 1]);
                case "--src" -> src = Path.of(args[i + 1]);
                case "--format-doc" -> formatDoc = Path.of(args[i + 1]);
                case "--classes" -> classes = Path.of(args[i + 1]);
                default -> throw new IllegalArgumentException("unknown option " + args[i]);
            }
        }
        if (lang == null || src == null || formatDoc == null || classes == null) {
            System.err.println("usage: CmdTestMain --lang DIR --src DIR --format-doc FILE --classes DIR");
            System.exit(2);
        }
        Path langDir = lang;
        Path srcDir = src;
        Path doc = formatDoc;
        Path classesDir = classes;
        group("Frame", FrameTests::run);
        group("FileNames", FileNamesTests::run);
        group("Images", ImageTests::run);
        group("Lang", () -> LangTests.run(langDir, srcDir, doc));
        group("CaptureFilter", CaptureFilterTests::run);
        group("Blacklist", BlacklistTests::run);
        group("LastPlace", LastPlaceTests::run);
        group("CaptureRange", () -> CaptureRangeTests.run(langDir));
        group("Photos", PhotoTests::run);
        group("ClientSplit", () -> ClientSplitTests.run(classesDir));
        System.out.println("cmdTest: " + checks + " checks, " + FAILURES.size() + " failed");
        for (String f : FAILURES) {
            System.out.println("  FAIL " + f);
        }
        System.exit(FAILURES.isEmpty() ? 0 : 1);
    }

    interface Group {
        void run() throws Exception;
    }

    private static void group(String name, Group g) {
        int failuresBefore = FAILURES.size();
        int checksBefore = checks;
        try {
            g.run();
        } catch (Throwable t) {
            FAILURES.add(name + ": threw " + t);
            t.printStackTrace(System.out);
        }
        System.out.println(name + ": " + (checks - checksBefore) + " checks, "
            + (FAILURES.size() - failuresBefore) + " failed");
    }

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) {
            FAILURES.add(what);
        }
    }

    static void eq(Object expected, Object actual, String what) {
        check(Objects.equals(expected, actual), what + ": expected <" + expected + "> but was <" + actual + ">");
    }

    static void eq(int[] expected, int[] actual, String what) {
        check(Arrays.equals(expected, actual),
            what + ": expected " + Arrays.toString(expected) + " but was " + Arrays.toString(actual));
    }

    static void throwsIae(Runnable r, String what) {
        try {
            r.run();
            check(false, what + ": no IllegalArgumentException");
        } catch (IllegalArgumentException e) {
            check(true, what);
        }
    }
}
