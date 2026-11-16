package com.xiaojingyu.share;

import com.google.gson.JsonElement;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtIo;

/**
 * A very small test harness for ShareTestMain (no JUnit on purpose: the project adds no new
 * dependencies). Every check prints one PASS / FAIL / SKIP line; console output is ASCII only.
 */
final class TestKit {
    interface Body {
        void run() throws Exception;
    }

    private int passed;
    private int failed;
    private final List<String> failures = new ArrayList<>();
    private final List<String> skips = new ArrayList<>();

    void check(String name, Body body) {
        try {
            body.run();
            passed++;
            System.out.println("PASS " + ascii(name));
        } catch (Throwable e) {
            failed++;
            failures.add(name);
            String why = e instanceof AssertionError ? String.valueOf(e.getMessage()) : stackTrace(e);
            System.out.println("FAIL " + ascii(name) + "\n     " + ascii(why).replace("\n", "\n     "));
        }
    }

    void skip(String name, String why) {
        skips.add(name);
        System.out.println("SKIP " + ascii(name) + "  <<<<<<<<<< NOT TESTED: " + ascii(why));
    }

    void note(String text) {
        System.out.println("     " + ascii(text));
    }

    /** Prints the summary and returns the exit code (1 if anything failed). */
    int finish(long startNanos) {
        double seconds = (System.nanoTime() - startNanos) / 1e9;
        System.out.println();
        System.out.printf("==== share tests: %d passed, %d failed, %d skipped (%.1f s) ====%n",
            passed, failed, skips.size(), seconds);
        if (!skips.isEmpty()) {
            System.out.println("!!!! " + skips.size() + " SKIPPED -- these were NOT tested"
                + " (gradlew shareTest -Prequire-cross turns them into failures):");
            for (String s : skips) {
                System.out.println("!!!!   " + ascii(s));
            }
        }
        for (String f : failures) {
            System.out.println("FAILED: " + ascii(f));
        }
        return failed == 0 ? 0 : 1;
    }

    // ---------------------------------------------------------------- assertions

    static AssertionError fail(String message) {
        return new AssertionError(message);
    }

    static void ok(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    static void eq(Object expected, Object actual, String what) {
        if (!Objects.equals(expected, actual)) {
            throw new AssertionError(what + ": expected " + expected + ", got " + actual);
        }
    }

    /** Compares bytes as hex; spaces in the expected text are ignored. */
    static void eqHex(String expectedHex, byte[] actual, String what) {
        eq(expectedHex.replace(" ", ""), hex(actual), what);
    }

    static void sameBytes(byte[] expected, byte[] actual, String what) {
        if (!Arrays.equals(expected, actual)) {
            throw new AssertionError(what + ": bytes differ at index " + Arrays.mismatch(expected, actual)
                + " (lengths " + expected.length + " and " + actual.length + ")");
        }
    }

    static void sameJson(JsonElement expected, JsonElement actual, String what) {
        String d = ShareDump.firstDifference(expected, actual);
        if (d != null) {
            throw new AssertionError(what + ": " + d);
        }
    }

    static ShareException error(String code, Body body) {
        return error(code, body, "");
    }

    /** Runs body, which must throw a ShareException with this code; returns it. */
    static ShareException error(String code, Body body, String what) {
        String label = what.isEmpty() ? "" : what + ": ";
        try {
            body.run();
        } catch (ShareException e) {
            if (!e.code().equals(code)) {
                throw new AssertionError(label + "expected " + code + ", got " + e);
            }
            return e;
        } catch (Exception e) {
            throw new AssertionError(label + "expected " + code + ", got\n" + stackTrace(e));
        }
        throw new AssertionError(label + "expected " + code + ", but it worked");
    }

    static void thrown(Class<? extends Throwable> type, Body body, String what) {
        try {
            body.run();
        } catch (Throwable e) {
            if (type.isInstance(e)) {
                return;
            }
            throw new AssertionError(what + ": expected " + type.getSimpleName() + ", got\n" + stackTrace(e));
        }
        throw new AssertionError(what + ": expected " + type.getSimpleName() + ", but it worked");
    }

    // ---------------------------------------------------------------- bytes

    static String hex(byte[] b) {
        return HexFormat.of().formatHex(b);
    }

    /** Hex to bytes; spaces are ignored. */
    static byte[] unhex(String s) {
        return HexFormat.of().parseHex(s.replace(" ", ""));
    }

    static byte[] cat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) {
            out.writeBytes(p);
        }
        return out.toByteArray();
    }

    static byte[] u16(int v) {
        return new byte[] {(byte) (v >> 8), (byte) v};
    }

    static byte[] i32(int v) {
        return new byte[] {(byte) (v >> 24), (byte) (v >> 16), (byte) (v >> 8), (byte) v};
    }

    /** NBT bytes of an unnamed root compound holding these named entries. */
    static byte[] root(byte[]... entries) {
        return cat(unhex("0a0000"), cat(entries), unhex("00"));
    }

    /** NBT bytes of one named entry: type, name, payload. */
    static byte[] named(int type, String name, byte[] payload) {
        byte[] n = name.getBytes(StandardCharsets.UTF_8);
        return cat(new byte[] {(byte) type}, u16(n.length), n, payload);
    }

    /** What MC itself writes for this root (NbtIo.write). */
    static byte[] mcWrite(CompoundTag tag) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        NbtIo.write(tag, new DataOutputStream(out));
        return out.toByteArray();
    }

    // ---------------------------------------------------------------- text

    /** Console-safe text: every char outside printable ASCII (except newline) as a \\uXXXX escape. */
    static String ascii(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\n' || (c >= 0x20 && c < 0x7F)) {
                sb.append(c);
            } else {
                sb.append(String.format("\\u%04x", (int) c));
            }
        }
        return sb.toString();
    }

    static String stackTrace(Throwable e) {
        StringWriter w = new StringWriter();
        e.printStackTrace(new PrintWriter(w));
        String[] lines = w.toString().split("\r?\n");
        int keep = Math.min(lines.length, 20);
        return String.join("\n", Arrays.copyOf(lines, keep)) + (lines.length > keep ? "\n..." : "");
    }
}
