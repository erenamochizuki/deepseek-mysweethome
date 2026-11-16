package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

import com.sun.nio.file.ExtendedOpenOption;
import com.xiaojingyu.blacklist.Blacklist;
import com.xiaojingyu.blacklist.BlacklistFile;

/**
 * The capture blacklist file (COMMANDS.md §2a): reading what people write with Notepad (broken, empty,
 * repeated, not ids, ids this game does not have), the shape we write, and the file-backed list
 * (missing file, changes made outside the game, a broken file kept as .bak, a failed save changes nothing).
 */
final class BlacklistTests {
    private BlacklistTests() {
    }

    static void run() throws IOException {
        parse();
        format();
        store();
    }

    private static void parse() {
        BlacklistFile.Parsed p = BlacklistFile.parse("");
        check(p.problem() == null && p.ids().isEmpty(), "empty file = empty list, no problem");
        p = BlacklistFile.parse("  \r\n\t ");
        check(p.problem() == null && p.ids().isEmpty(), "blank file = empty list");
        p = BlacklistFile.parse("﻿{\"blocks\": [\"minecraft:stone\"]}");
        eq(List.of("minecraft:stone"), p.ids(), "UTF-8 BOM (Notepad) is fine");
        p = BlacklistFile.parse("{\"note\": \"随便写\", \"blocks\": [\"minecraft:stone\", \"xiaojingyu:dining_table\"]}");
        eq(List.of("minecraft:stone", "xiaojingyu:dining_table"), p.ids(), "object form, file order kept");
        eq(List.of("minecraft:glass", "minecraft:stone"), BlacklistFile.parse("[\"glass\", \"stone\"]").ids(), "bare list");

        // People write ids loosely.
        p = BlacklistFile.parse("[\"Stone\", \" minecraft:OAK_PLANKS \", \"minecraft:oak_stairs[facing=north]\", "
            + "\"minecraft:chest{Items:[]}\"]");
        eq(List.of("minecraft:stone", "minecraft:oak_planks", "minecraft:oak_stairs", "minecraft:chest"), p.ids(),
            "capitals, spaces, a state or NBT → the block id");
        eq(0, p.skipped().size(), "nothing skipped there");

        // Repeats count once.
        p = BlacklistFile.parse("[\"minecraft:stone\", \"stone\", \"STONE\", \"minecraft:glass\", \"glass\"]");
        eq(List.of("minecraft:stone", "minecraft:glass"), p.ids(), "repeats removed, first place kept");
        eq(3, p.duplicates(), "repeats counted");

        // Not ids: skipped, the rest still counts.
        p = BlacklistFile.parse("[\"minecraft:stone\", \"a b\", \"\", 5, {\"x\": 1}, \"minecraft:\", \"Bad Mod:x\", true]");
        eq(List.of("minecraft:stone"), p.ids(), "good entries kept next to bad ones");
        eq(7, p.skipped().size(), "bad entries skipped: " + p.skipped());
        check(p.problem() == null, "bad entries are not a file problem");

        // Ids this game may not have are kept (the mod may come back); the commands check the registry.
        eq(List.of("minecraft:no_such_block", "othermod:thing"),
            BlacklistFile.parse("[\"minecraft:no_such_block\", \"othermod:thing\"]").ids(), "unknown ids are kept");

        // Lenient JSON: comments and a trailing comma.
        p = BlacklistFile.parse("// 我的名单\n{\"blocks\": [\n  \"stone\", # 石头\n  \"glass\",\n]}\n");
        eq(List.of("minecraft:stone", "minecraft:glass"), p.ids(), "comments and trailing comma");
        eq(0, p.skipped().size(), "trailing comma is not a bad entry");

        // Broken files: the whole list counts as empty, and we say where.
        p = BlacklistFile.parse("{\"blocks\": [\"minecraft:stone\"\n  \"glass\" oops");
        check(p.problem() != null && p.problem().code().equals("syntax"), "broken JSON is a syntax problem");
        check(p.problem() != null && p.problem().line() == 2, "syntax problem has the line: " + p.problem());
        check(p.ids().isEmpty(), "broken file = empty list");
        p = BlacklistFile.parse("{\"blocks\": [\"minecraft:stone\"");
        check(p.problem() != null && p.problem().code().equals("syntax"), "cut-off file is a syntax problem");
        for (String shape : new String[] {"\"minecraft:stone\"", "{\"block\": [\"stone\"]}", "{\"blocks\": \"stone\"}",
            "123", "null", "{}"}) {
            p = BlacklistFile.parse(shape);
            check(p.problem() != null && p.problem().code().equals("shape") && p.ids().isEmpty(), "shape problem: " + shape);
        }

        // At most MAX_ENTRIES.
        StringBuilder sb = new StringBuilder("[");
        int n = BlacklistFile.MAX_ENTRIES + 10;
        for (int i = 0; i < n; i++) {
            sb.append(i == 0 ? "" : ",").append("\"mod:b").append(i).append('"');
        }
        p = BlacklistFile.parse(sb.append(']').toString());
        eq(BlacklistFile.MAX_ENTRIES, p.ids().size(), "list is capped");
        eq(10, p.skipped().size(), "entries past the cap are skipped");

        eq("minecraft:stone", BlacklistFile.normalize("stone"), "normalize adds minecraft:");
        eq(null, BlacklistFile.normalize("x".repeat(BlacklistFile.MAX_ID_LENGTH + 1)), "normalize: too long");
        eq(null, BlacklistFile.normalize("中文"), "normalize: not an id");
    }

    private static void format() {
        String text = BlacklistFile.format(List.of("minecraft:stone", "xiaojingyu:dining_table"));
        eq(List.of("minecraft:stone", "xiaojingyu:dining_table"), BlacklistFile.parse(text).ids(), "format reads back");
        check(text.contains("\"blocks\": [\n    \"minecraft:stone\",\n    \"xiaojingyu:dining_table\"\n  ]"),
            "one id per line:\n" + text);
        check(text.contains("小鲸鱼之家") && !text.contains("\\u"), "the note is plain Chinese, not \\u escapes");
        check(text.endsWith("}\n") && !text.startsWith("﻿"), "ends with a newline, no BOM");
        String empty = BlacklistFile.format(List.of());
        check(empty.contains("\"blocks\": []"), "empty list:\n" + empty);
        eq(List.of(), BlacklistFile.parse(empty).ids(), "empty list reads back");
    }

    private static void store() throws IOException {
        Path dir = Files.createTempDirectory("xjy-blacklist-");
        try {
            Path file = dir.resolve("config").resolve(Blacklist.FILE_NAME);
            Blacklist list = new Blacklist(file);
            Blacklist.Snapshot s = list.snapshot();
            check(s.ids().isEmpty() && s.problem() == null, "no file = empty list");
            check(!Files.exists(file), "reading does not create the file");

            Blacklist.Change c = list.add("minecraft:stone");
            check(c.changed() && c.size() == 1 && c.backup() == null, "add: " + c);
            check(Files.exists(file), "first change creates config/ and the file");
            eq(List.of("minecraft:stone"), BlacklistFile.parse(read(file)).ids(), "file after add");
            c = list.add("minecraft:stone");
            check(!c.changed() && c.size() == 1, "add again: no change");
            list.add("xiaojingyu:dining_table");
            list.add("minecraft:oak_planks");
            eq(List.of("minecraft:stone", "xiaojingyu:dining_table", "minecraft:oak_planks"), list.snapshot().ids(), "order");
            c = list.remove("minecraft:stone");
            check(c.changed() && c.size() == 2, "remove: " + c);
            check(!list.remove("minecraft:glass").changed(), "remove something not listed: no change");
            eq(List.of("xiaojingyu:dining_table", "minecraft:oak_planks"), BlacklistFile.parse(read(file)).ids(), "file after remove");

            // Someone edits the file with Notepad: the next use reads it again.
            write(file, "﻿[\"glass\", \"Glass\", \"minecraft:sand\"]", 1);
            s = list.snapshot();
            eq(List.of("minecraft:glass", "minecraft:sand"), s.ids(), "outside edit is picked up");
            check(s.problem() == null, "outside edit is fine");
            write(file, "[\"glass\", \"not an id\"]", 2);
            s = list.snapshot();
            eq(List.of("minecraft:glass"), s.ids(), "outside edit with a bad entry");
            eq(List.of("not an id"), s.skipped(), "the bad entry is reported");

            // A broken file: empty list with a problem; the file stays as it is until the next change.
            write(file, "{\"blocks\": [\"stone\",, oops", 3);
            s = list.snapshot();
            check(s.problem() != null && s.ids().isEmpty(), "broken file → empty list + problem: " + s.problem());
            eq("{\"blocks\": [\"stone\",, oops", read(file), "reading a broken file does not touch it");
            c = list.add("minecraft:stone");
            Path bak = file.resolveSibling(Blacklist.FILE_NAME + Blacklist.BACKUP_SUFFIX);
            check(c.changed() && bak.equals(c.backup()), "change after a broken file reports the backup: " + c);
            eq("{\"blocks\": [\"stone\",, oops", read(bak), "the broken file is kept as .bak");
            eq(List.of("minecraft:stone"), BlacklistFile.parse(read(file)).ids(), "then the new list is written");
            check(list.snapshot().problem() == null, "no problem after the rewrite");

            // clear: removes everything; on a broken file it also rewrites (and keeps a .bak).
            c = list.clear();
            check(c.changed() && c.removed() == 1 && c.size() == 0, "clear: " + c);
            check(!list.clear().changed(), "clear an empty list: no change");
            write(file, "oops", 4);
            c = list.clear();
            check(c.backup() != null && list.snapshot().problem() == null, "clear fixes a broken file: " + c);
            eq(List.of(), BlacklistFile.parse(read(file)).ids(), "cleared file reads as empty");

            // Empty file (0 bytes): fine, empty.
            write(file, "", 5);
            s = list.snapshot();
            check(s.ids().isEmpty() && s.problem() == null, "0-byte file = empty list, no problem");

            // Deleted from outside: empty again.
            Files.delete(file);
            check(list.snapshot().ids().isEmpty(), "deleted file = empty list");

            // A save that fails changes nothing (the list file's name is taken by a folder with something in it).
            Path blocked = dir.resolve("blocked").resolve(Blacklist.FILE_NAME);
            Files.createDirectories(blocked);
            Files.writeString(blocked.resolve("x.txt"), "x");
            Blacklist bad = new Blacklist(blocked);
            check(bad.snapshot().problem() != null, "a folder where the file should be is a problem");
            boolean threw = false;
            try {
                bad.add("minecraft:stone");
            } catch (IOException e) {
                threw = true;
            }
            check(threw, "add throws when the file cannot be written");
            check(bad.snapshot().ids().isEmpty(), "failed add is undone");
            try (Stream<Path> left = Files.list(blocked.getParent())) {
                eq(List.of(Blacklist.FILE_NAME), left.map(p -> p.getFileName().toString()).toList(), "no temp file left behind");
            }

            // A second list object on the same file (another world in the same game) sees the same list.
            Blacklist again = new Blacklist(file);
            list.add("minecraft:stone");
            eq(List.of("minecraft:stone"), again.snapshot().ids(), "same file, same list");

            // Windows: another program holds the file open (a virus scanner does this for a moment after a
            // write), so replacing it is refused; the save still goes through by writing in place.
            if (System.getProperty("os.name", "").startsWith("Windows")) {
                try (FileChannel held = FileChannel.open(file, StandardOpenOption.READ, ExtendedOpenOption.NOSHARE_DELETE)) {
                    Blacklist.Change c2 = list.add("minecraft:glass");
                    check(c2.changed(), "add while the file is held open");
                }
                eq(List.of("minecraft:stone", "minecraft:glass"), BlacklistFile.parse(read(file)).ids(),
                    "written in place while the file was held open");
                try (Stream<Path> left = Files.list(file.getParent())) {
                    check(left.noneMatch(p -> p.getFileName().toString().endsWith(".tmp")), "no temp file left behind");
                }
            }
        } finally {
            deleteTree(dir);
        }
    }

    private static String read(Path file) throws IOException {
        return Files.readString(file, StandardCharsets.UTF_8);
    }

    /** Writes like an editor would, and moves the time so the change is seen even within one clock tick. */
    private static void write(Path file, String text, int step) throws IOException {
        Files.writeString(file, text, StandardCharsets.UTF_8);
        Files.setLastModifiedTime(file, FileTime.fromMillis(1_700_000_000_000L + step * 10_000L));
    }

    private static void deleteTree(Path dir) throws IOException {
        List<Path> all = new ArrayList<>();
        try (Stream<Path> s = Files.walk(dir)) {
            s.forEach(all::add);
        }
        all.sort(Comparator.reverseOrder());
        for (Path p : all) {
            Files.deleteIfExists(p);
        }
    }
}
