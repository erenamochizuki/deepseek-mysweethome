package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

import com.mojang.brigadier.StringReader;

/** File names for capture and place (COMMANDS.md §2 file name rules, §3 <文件>). */
final class FileNamesTests {
    private FileNamesTests() {
    }

    static void run() throws Exception {
        sanitize();
        reserved();
        firstFree();
        placeArgs();
        findIn();
        quoting();
    }

    private static void sanitize() {
        eq("我的小屋", FileNames.sanitize("  我的小屋  ", "fb"), "keeps Chinese, trims");
        eq("海边 小屋 2", FileNames.sanitize("海边 小屋 2", "fb"), "keeps inner spaces");
        eq("a_b_c_d_e_f_g_h_i_", FileNames.sanitize("a\\b/c:d*e?f\"g<h>i|", "fb"), "forbidden characters");
        eq("a_b_c", FileNames.sanitize("a\tb\u0000c", "fb"), "control characters");
        eq("x_y", FileNames.sanitize("x\u0085y", "fb"), "C1 control character");
        eq("a_b", FileNames.sanitize("a\uD800b", "fb"), "lone surrogate");
        eq("house", FileNames.sanitize("house. . ", "fb"), "no trailing dots or spaces");
        eq("fb", FileNames.sanitize("   ", "fb"), "blank uses the fallback");
        eq("fb", FileNames.sanitize("...", "fb"), "only dots uses the fallback");
        eq("fb", FileNames.sanitize(null, "fb"), "null uses the fallback");
        eq("a".repeat(64), FileNames.sanitize("a".repeat(65), "fb"), "at most 64 characters");
        eq("a".repeat(63), FileNames.sanitize("a".repeat(63) + " b", "fb"), "cut at 64, then no trailing space");
        eq("🐳".repeat(64), FileNames.sanitize("🐳".repeat(70), "fb"), "64 characters, not 64 UTF-16 units");
    }

    private static void reserved() {
        for (String name : List.of("CON", "prn", "Aux", "nul", "COM1", "com9", "LPT1", "lpt9", "nul.txt", "CON .png",
                "aux.tar.gz")) {
            check(FileNames.isReserved(name), name + " is a Windows device name");
        }
        for (String name : List.of("CONS", "com0", "COM10", "lpt", "con_", "我的", "x.CON")) {
            check(!FileNames.isReserved(name), name + " is not a device name");
        }
        eq("_CON", FileNames.sanitize("CON", "fb"), "device name gets a leading _");
        eq("_nul.txt", FileNames.sanitize("nul.txt", "fb"), "device name with an extension");
    }

    private static void firstFree() {
        Set<String> taken = Set.of("屋.png", "屋-2.png", "a.png");
        eq("屋-3.png", FileNames.firstFree("屋", ".png", taken::contains), "skips taken names");
        eq("a-2.png", FileNames.firstFree("a", ".png", taken::contains), "second copy");
        eq("b.png", FileNames.firstFree("b", ".png", taken::contains), "free name kept");
    }

    private static void placeArgs() {
        // Dots inside a name are fine (COMMANDS.md §3, 06:15); characters Windows does not allow are left to findIn,
        // which reports them as not found.
        for (String ok : List.of("house", "我的 小屋", "my.house.png", "a-b_c+d", "小屋.schem", "a..b", "x..y.png",
                "...", "a*b", "a?b")) {
            check(FileNames.isSafePlaceArg(ok), "allowed: " + ok);
        }
        for (String bad : List.of("", "  ", ".", "..", "../x", "..\\x", "a/b", "a\\b", "C:x", "C:house", "x:y",
                "both.png:evil", "a\u0001b", "a\nb", "a\u007Fb", "a\u0085b")) {
            check(!FileNames.isSafePlaceArg(bad), "refused: " + bad);
        }
        check(!FileNames.isSafePlaceArg(null), "refused: null");
        eq(List.of("house.png", "house.schem"), FileNames.placeCandidates("house"), "no extension: .png first");
        eq(List.of("a.PNG", "a.PNG.png", "a.PNG.schem"), FileNames.placeCandidates("a.PNG"), "typed extension first");
        check(FileNames.isBuildingFile("x.png") && FileNames.isBuildingFile("X.SCHEM"), "building files");
        check(!FileNames.isBuildingFile("x.txt") && !FileNames.isBuildingFile("png"), "not building files");
    }

    /** Looking a place argument up on disk (COMMANDS.md §3): dots inside names, folders, other folders, odd names. */
    private static void findIn() throws IOException {
        Path root = Files.createTempDirectory(Path.of("").toAbsolutePath(), "find-");
        try {
            Path dir = Files.createDirectory(root.resolve("xiaojingyu"));
            for (String f : List.of("a..b.png", "x..y.png", "house.png", "both.png", "both.schem", "only.schem")) {
                Files.write(dir.resolve(f), new byte[] {1});
            }
            Files.createDirectory(dir.resolve("dir.png"));
            Files.createDirectory(dir.resolve("sub"));
            Files.write(dir.resolve("sub").resolve("deep.png"), new byte[] {1});
            Files.write(root.resolve("up.png"), new byte[] {1});
            Path norm = dir.toAbsolutePath().normalize();

            eq(norm.resolve("a..b.png"), FileNames.findIn(dir, "a..b"), "a..b found");
            eq(norm.resolve("a..b.png"), FileNames.findIn(dir, "a..b.png"), "a..b.png found");
            eq(norm.resolve("x..y.png"), FileNames.findIn(dir, "x..y"), "x..y found");
            eq(norm.resolve("both.png"), FileNames.findIn(dir, "both"), ".png before .schem");
            eq(norm.resolve("both.schem"), FileNames.findIn(dir, "both.schem"), "typed extension wins");
            eq(norm.resolve("only.schem"), FileNames.findIn(dir, "only"), ".schem when there is no .png");
            eq(null, FileNames.findIn(dir, "dir"), "a folder is not a building file");
            eq(null, FileNames.findIn(dir, "dir.png"), "a folder is not a building file (typed extension)");
            eq(null, FileNames.findIn(dir, "nosuch"), "missing file");
            // Even without isSafePlaceArg in front, nothing above or below the folder is found.
            for (String escape : List.of("../up", "..", ".", "sub/deep", "sub\\deep", root.resolve("up").toString())) {
                eq(null, FileNames.findIn(dir, escape), "stays in the folder: " + escape);
            }
            // Names the file system does not accept are simply not found (InvalidPathException on Windows).
            for (String odd : List.of("a\u0000b", "a*b", "a?b", "a<b", "a|b", "a\"b", "both.png:evil", "x:y")) {
                eq(null, FileNames.findIn(dir, odd), "odd name not found: " + odd);
            }
        } finally {
            deleteTree(root);
        }
    }

    private static void deleteTree(Path root) throws IOException {
        List<Path> paths;
        try (Stream<Path> s = Files.walk(root)) {
            paths = s.sorted(Comparator.reverseOrder()).toList();
        }
        for (Path p : paths) {
            Files.deleteIfExists(p);
        }
    }

    private static void quoting() throws Exception {
        eq("house-2.png", FileNames.quoteIfNeeded("house-2.png"), "plain name unquoted");
        eq("\"我的 小屋.png\"", FileNames.quoteIfNeeded("我的 小屋.png"), "Chinese and spaces quoted");
        eq("\"a\\\"b\\\\c\"", FileNames.quoteIfNeeded("a\"b\\c"), "quote and backslash escaped");
        for (String name : List.of("house.png", "我的 小屋.png", "a\"b\\c", "it's.png", "")) {
            String typed = FileNames.quoteIfNeeded(name);
            eq(name, new StringReader(typed).readString(), "Brigadier reads back " + typed);
        }
        int differ = 0;
        for (char c = 0; c < 128; c++) {
            differ += StringReader.isAllowedInUnquotedString(c) == FileNames.isUnquotedChar(c) ? 0 : 1;
        }
        eq(0, differ, "same unquoted characters as Brigadier");
        check(FileNames.matchesTyped("我的小屋.png", "我的") && FileNames.matchesTyped("House.png", "\"ho"),
            "Tab matches what has been typed");
        check(!FileNames.matchesTyped("house.png", "x"), "Tab skips other files");
    }
}
