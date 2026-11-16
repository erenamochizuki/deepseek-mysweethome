package com.xiaojingyu.share;

import static com.xiaojingyu.share.TestKit.eq;
import static com.xiaojingyu.share.TestKit.fail;
import static com.xiaojingyu.share.TestKit.ok;
import static com.xiaojingyu.share.TestKit.sameBytes;
import static com.xiaojingyu.share.TestKit.sameJson;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.TreeMap;
import java.util.stream.Stream;
import net.minecraft.nbt.CompoundTag;

/**
 * Tests on the shared fixture tree (docs/FORMAT.md §6): cases/*.json (dumps), js/*.png (written by
 * the web page), java/*.png (written here), odd/ (strange files + .expect.json). Also writes java/.
 */
final class ShareFixtureTests {
    private ShareFixtureTests() {
    }

    static void run(TestKit t, Path root, boolean requireCross) {
        TreeMap<String, JsonElement> cases = loadCases(t, root.resolve("cases"));
        for (var c : cases.entrySet()) {
            roundTrip(t, c.getKey(), c.getValue());
        }
        crossRead(t, root.resolve("js"), cases, requireCross);
        ownFixtures(t, root.resolve("java"), cases);
        odd(t, root.resolve("odd"));
        speed(t, cases.get("big-air"));
    }

    // ---------------------------------------------------------------- cases

    /** Every cases/*.json parsed; a file that does not parse is one FAIL and is left out. */
    static TreeMap<String, JsonElement> loadCases(TestKit t, Path dir) {
        TreeMap<String, JsonElement> cases = new TreeMap<>();
        List<Path> files = list(dir, ".json");
        t.check("cases/ has dumps to test with (" + dir + ")", () ->
            ok(!files.isEmpty(), "no cases/*.json in " + dir));
        for (Path f : files) {
            String name = base(f, ".json");
            t.check("cases/" + name + ".json is a valid dump", () -> {
                JsonElement json = ShareDump.parse(Files.readString(f, StandardCharsets.UTF_8));
                ShareDump.toModel(json);
                cases.put(name, json);
            });
        }
        return cases;
    }

    private static void roundTrip(TestKit t, String name, JsonElement dump) {
        t.check("case " + name + ": dump -> model -> dump is the same", () ->
            sameJson(dump, ShareDump.dump(ShareDump.toModel(dump)), "dump"));
        t.check("case " + name + ": model -> PNG -> read gives the case; written twice, same bytes", () -> {
            byte[] png = ShareFiles.writePng(ShareDump.toModel(dump));
            sameBytes(png, ShareFiles.writePng(ShareDump.toModel(dump)), "second PNG");
            sameJson(dump, ShareDump.dump(ShareFiles.read(png)), "dump of the PNG");
        });
        t.check("case " + name + ": model -> .schem -> read gives the case; written twice, same bytes", () -> {
            byte[] schem = ShareFiles.writeSchem(ShareDump.toModel(dump));
            sameBytes(schem, ShareFiles.writeSchem(ShareDump.toModel(dump)), "second .schem");
            sameJson(dump, ShareDump.dump(ShareFiles.read(schem)), "dump of the .schem");
        });
    }

    // ---------------------------------------------------------------- js/ and java/

    /** js/NAME.png (written by the web page) must read as cases/NAME.json. */
    private static void crossRead(TestKit t, Path dir, TreeMap<String, JsonElement> cases, boolean requireCross) {
        String why = "the web page's pictures (" + dir + ")";
        if (!Files.isDirectory(dir)) {
            if (requireCross) {
                t.check("js/ exists", () -> fail("missing: " + why));
            } else {
                t.skip("cross-read js/*.png", "missing: " + why);
            }
            return;
        }
        for (var c : cases.entrySet()) {
            Path png = dir.resolve(c.getKey() + ".png");
            if (!Files.isRegularFile(png)) {
                if (requireCross) {
                    t.check("js/" + c.getKey() + ".png exists", () -> fail("missing " + png));
                } else {
                    t.skip("cross-read js/" + c.getKey() + ".png", "missing " + png);
                }
                continue;
            }
            t.check("js/" + c.getKey() + ".png (written by the web page) reads as the case", () ->
                sameJson(c.getValue(), ShareDump.dump(ShareFiles.read(Files.readAllBytes(png))), "dump"));
        }
        strays(t, "js", dir, cases);
    }

    /** java/NAME.png must be exactly what this writer writes now (gradlew shareFixtures rewrites them). */
    private static void ownFixtures(TestKit t, Path dir, TreeMap<String, JsonElement> cases) {
        for (var c : cases.entrySet()) {
            Path png = dir.resolve(c.getKey() + ".png");
            t.check("java/" + c.getKey() + ".png is what this writer writes now", () -> {
                ok(Files.isRegularFile(png), "missing " + png + " (run gradlew shareFixtures)");
                byte[] now = ShareFiles.writePng(ShareDump.toModel(c.getValue()));
                sameBytes(now, Files.readAllBytes(png), png + " (run gradlew shareFixtures if the change is intended)");
            });
        }
        strays(t, "java", dir, cases);
    }

    /** A picture without a case is a mistake (renamed or deleted case). */
    private static void strays(TestKit t, String label, Path dir, TreeMap<String, JsonElement> cases) {
        t.check(label + "/ has no picture without a case", () -> {
            List<String> stray = new ArrayList<>();
            for (Path f : list(dir, ".png")) {
                if (!cases.containsKey(base(f, ".png"))) {
                    stray.add(f.getFileName().toString());
                }
            }
            ok(stray.isEmpty(), "pictures without cases/*.json: " + stray);
        });
    }

    // ---------------------------------------------------------------- odd/

    /** Every odd/NAME.png or .schem must give what odd/NAME.expect.json says: {"error": code} or {"dump": …}. */
    private static void odd(TestKit t, Path dir) {
        List<Path> files = list(dir, "");
        t.check("odd/ has files to test with (" + dir + ")", () -> ok(!files.isEmpty(), "no files in " + dir));
        for (Path f : files) {
            String file = f.getFileName().toString();
            if (file.endsWith(".expect.json")) {
                String name = file.substring(0, file.length() - ".expect.json".length());
                t.check("odd/" + file + " belongs to a .png or .schem", () -> ok(
                    Files.isRegularFile(dir.resolve(name + ".png")) || Files.isRegularFile(dir.resolve(name + ".schem")),
                    "no odd/" + name + ".png or .schem"));
                continue;
            }
            int dot = file.lastIndexOf('.');
            String name = dot < 0 ? file : file.substring(0, dot);
            t.check("odd/" + file + " gives what odd/" + name + ".expect.json says", () -> {
                ok(file.endsWith(".png") || file.endsWith(".schem"), "odd/ files are .png or .schem");
                Path expectFile = dir.resolve(name + ".expect.json");
                ok(Files.isRegularFile(expectFile), "missing " + expectFile);
                JsonObject expect = ShareDump.parse(Files.readString(expectFile, StandardCharsets.UTF_8)).getAsJsonObject();
                ok(expect.size() == 1 && (expect.has("error") || expect.has("dump")),
                    expectFile + " must be {\"error\": code} or {\"dump\": ...}");
                byte[] bytes = Files.readAllBytes(f);
                if (expect.has("error")) {
                    String code = expect.get("error").getAsString();
                    try {
                        ShareModel m = ShareFiles.read(bytes);
                        fail("expected error " + code + ", but it reads fine: "
                            + brief(ShareDump.print(ShareDump.dump(m), true)));
                    } catch (ShareException e) {
                        eq(code, e.code(), "error code (detail: " + e.detail() + ")");
                    }
                } else {
                    ShareModel m;
                    try {
                        m = ShareFiles.read(bytes);
                    } catch (ShareException e) {
                        throw new AssertionError("expected a dump, got " + e);
                    }
                    sameJson(expect.get("dump"), ShareDump.dump(m), "dump");
                }
            });
        }
    }

    private static String brief(String s) {
        return s.length() <= 300 ? s : s.substring(0, 300) + "...";
    }

    // ---------------------------------------------------------------- speed

    private static void speed(TestKit t, JsonElement bigAir) {
        t.check("big-air (256x64x256): reading the PNG takes < 3 s", () -> {
            ShareModel m = bigAir != null ? ShareDump.toModel(bigAir) : new ShareModel(256, 64, 256);
            ok(m.width() == 256 && m.height() == 64 && m.length() == 256,
                "big-air is " + m.width() + "x" + m.height() + "x" + m.length());
            byte[] png = ShareFiles.writePng(m);
            long start = System.nanoTime();
            ShareModel back = ShareFiles.read(png);
            long ms = (System.nanoTime() - start) / 1_000_000;
            t.note("big-air: PNG " + png.length + " bytes, read in " + ms + " ms");
            ok(ms < 3000, "reading took " + ms + " ms");
            eq(m.volume(), back.volume(), "cells");
        });
        t.check("random 1024x4x1024, 300 states, 1000 block entities: write + read < 10 s, same content", () -> {
            Random r = new Random(20261106);
            ShareModel m = new ShareModel(1024, 4, 1024);
            int[] ids = new int[300];
            for (int i = 0; i < ids.length; i++) {
                ids[i] = m.paletteId("test:block_" + i + "[n=" + i % 7 + "]");
            }
            int[] cells = m.cells();
            for (int i = 0; i < cells.length; i++) {
                cells[i] = ids[r.nextInt(ids.length)];
            }
            for (int i = 0; i < 1000; i++) {
                CompoundTag data = new CompoundTag();
                data.putInt("n", i);
                m.putBlockEntity(r.nextInt(1024), r.nextInt(4), r.nextInt(1024), "test:thing", data);
            }
            long start = System.nanoTime();
            byte[] png = ShareFiles.writePng(m);
            long written = System.nanoTime();
            ShareModel back = ShareFiles.read(png);
            long end = System.nanoTime();
            t.note("random 1024x4x1024: PNG " + png.length + " bytes, write " + (written - start) / 1_000_000
                + " ms, read " + (end - written) / 1_000_000 + " ms");
            ok(end - start < 10_000_000_000L, "took " + (end - start) / 1_000_000 + " ms");
            for (int i = 0; i < cells.length; i++) {
                if (!m.palette().get(cells[i]).equals(back.palette().get(back.cells()[i]))) {
                    fail("cell " + i + " differs");
                }
            }
            eq(new ArrayList<>(m.blockEntities()), new ArrayList<>(back.blockEntities()), "block entities");
        });
    }

    // ---------------------------------------------------------------- gradlew shareFixtures

    /**
     * Rewrites java/NAME.png for every cases/NAME.json (only files whose bytes change are written)
     * and deletes java/*.png whose case is gone. A case that does not read back as itself is not
     * written. Returns the exit code.
     */
    static int writeFixtures(Path root) throws IOException {
        Path casesDir = root.resolve("cases");
        Path outDir = root.resolve("java");
        List<Path> files = list(casesDir, ".json");
        if (files.isEmpty()) {
            System.out.println("FAIL no cases/*.json in " + casesDir);
            return 1;
        }
        Files.createDirectories(outDir);
        int failed = 0;
        List<String> names = new ArrayList<>();
        for (Path f : files) {
            String name = base(f, ".json");
            names.add(name);
            try {
                JsonElement dump = ShareDump.parse(Files.readString(f, StandardCharsets.UTF_8));
                byte[] png = ShareFiles.writePng(ShareDump.toModel(dump));
                String diff = ShareDump.firstDifference(dump, ShareDump.dump(ShareFiles.read(png)));
                if (diff != null) {
                    throw new AssertionError("does not read back as the case: " + diff);
                }
                Path out = outDir.resolve(name + ".png");
                boolean same = Files.isRegularFile(out) && java.util.Arrays.equals(png, Files.readAllBytes(out));
                if (!same) {
                    Files.write(out, png);
                }
                System.out.println((same ? "same  " : "wrote ") + "java/" + name + ".png (" + png.length + " bytes)");
            } catch (Exception | AssertionError e) {
                failed++;
                System.out.println("FAIL  " + name + ": " + TestKit.ascii(String.valueOf(e)));
            }
        }
        for (Path f : list(outDir, ".png")) {
            if (!names.contains(base(f, ".png"))) {
                Files.delete(f);
                System.out.println("deleted java/" + f.getFileName() + " (its case is gone)");
            }
        }
        System.out.println(failed == 0 ? "fixtures: done" : "fixtures: " + failed + " case(s) FAILED");
        return failed == 0 ? 0 : 1;
    }

    // ---------------------------------------------------------------- files

    /** Regular files in dir whose names end with suffix, sorted by name; empty if dir is missing. */
    static List<Path> list(Path dir, String suffix) {
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(Files::isRegularFile)
                .filter(p -> p.getFileName().toString().endsWith(suffix))
                .sorted()
                .toList();
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    static String base(Path file, String suffix) {
        String name = file.getFileName().toString();
        return name.substring(0, name.length() - suffix.length());
    }
}
