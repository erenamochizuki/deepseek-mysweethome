package com.xiaojingyu.share;

import static com.xiaojingyu.share.TestKit.eq;
import static com.xiaojingyu.share.TestKit.error;
import static com.xiaojingyu.share.TestKit.fail;
import static com.xiaojingyu.share.TestKit.ok;
import static com.xiaojingyu.share.TestKit.sameBytes;
import static com.xiaojingyu.share.TestKit.sameJson;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.minecraft.nbt.ByteArrayTag;
import net.minecraft.nbt.ByteTag;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.IntArrayTag;
import net.minecraft.nbt.IntTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.LongTag;
import net.minecraft.nbt.ShortTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;

/** Unit tests: the Sponge v3 codec rule by rule, the writer, ShareModel, dump JSON, §5 messages (docs/FORMAT.md §3–§5). */
final class ShareCodecTests {
    private ShareCodecTests() {
    }

    private static final String BAD = ShareException.BAD_SCHEMATIC;
    static final String CHEST = "minecraft:chest[facing=north,type=single,waterlogged=false]";

    static void run(TestKit t, Path formatDoc) {
        readStructure(t);
        readBlocks(t);
        readOrder(t);
        warnings(t);
        writer(t);
        model(t);
        dumpJson(t, formatDoc);
        messages(t, formatDoc);
    }

    // ---------------------------------------------------------------- sample file

    /** Changes a copy of the sample: r = root, s = its Schematic compound, b = Schematic.Blocks. */
    interface Edit {
        void apply(CompoundTag r, CompoundTag s, CompoundTag b);
    }

    /** A 2×1×1 file built by hand (not by our writer): stone, chest. Palette numbers 5 and 2 on purpose. */
    static CompoundTag sample() {
        CompoundTag palette = new CompoundTag();
        palette.putInt("minecraft:stone", 5);
        palette.putInt(CHEST, 2);
        CompoundTag apple = new CompoundTag();
        apple.putByte("Slot", (byte) 0);
        apple.putString("id", "minecraft:apple");
        apple.putInt("count", 3);
        ListTag items = new ListTag();
        items.add(apple);
        CompoundTag beData = new CompoundTag();
        beData.putString("CustomName", "箱子");
        beData.put("Items", items);
        CompoundTag be = new CompoundTag();
        be.putIntArray("Pos", new int[] {1, 0, 0});
        be.putString("Id", "minecraft:chest");
        be.put("Data", beData);
        ListTag bes = new ListTag();
        bes.add(be);
        CompoundTag blocks = new CompoundTag();
        blocks.put("Palette", palette);
        blocks.putByteArray("Data", new byte[] {5, 2});
        blocks.put("BlockEntities", bes);
        CompoundTag meta = new CompoundTag();
        meta.putString("Name", "小屋");
        CompoundTag s = new CompoundTag();
        s.putInt("Version", 3);
        s.putInt("DataVersion", 4790);
        s.put("Metadata", meta);
        size(s, 2, 1, 1);
        s.putIntArray("Offset", new int[] {-1, 0, 1});
        s.put("Blocks", blocks);
        CompoundTag root = new CompoundTag();
        root.put("Schematic", s);
        return root;
    }

    static final String SAMPLE_DUMP = """
        {"dump": 1, "size": [2, 1, 1], "offset": [-1, 0, 1], "dataVersion": 4790,
         "meta": {"compound": {"Name": {"string": "小屋"}}},
         "palette": ["minecraft:stone", "%s"],
         "cells": [[1, 0], [1, 1]],
         "blockEntities": [{"pos": [1, 0, 0], "id": "minecraft:chest", "data": {"compound": {
           "CustomName": {"string": "箱子"},
           "Items": {"list": [{"compound": {"Slot": {"byte": 0}, "id": {"string": "minecraft:apple"},
                                           "count": {"int": 3}}}]}}}}],
         "warnings": []}
        """.formatted(CHEST);

    static void size(CompoundTag s, int w, int h, int l) {
        s.putShort("Width", (short) w);
        s.putShort("Height", (short) h);
        s.putShort("Length", (short) l);
    }

    static ShareModel read(Edit edit) throws ShareException {
        CompoundTag root = sample();
        CompoundTag s = (CompoundTag) root.get("Schematic");
        edit.apply(root, s, (CompoundTag) s.get("Blocks"));
        return SchemCodec.decode(root);
    }

    static JsonElement dumpOf(Edit edit) throws ShareException {
        return ShareDump.dump(read(edit));
    }

    static ShareException readError(String code, Edit edit) {
        return error(code, () -> read(edit));
    }

    /** Like readError(code, edit); the English detail must mention {@code check}, i.e. that check fired. */
    static void readError(String code, String check, Edit edit) {
        ShareException e = readError(code, edit);
        ok(e.detail().contains(check), "expected the \"" + check + "\" check, got: " + e.detail());
    }

    static ListTag intList(int... values) {
        ListTag list = new ListTag();
        for (int v : values) {
            list.add(IntTag.valueOf(v));
        }
        return list;
    }

    // ---------------------------------------------------------------- read: keys of Schematic (FORMAT §3)

    private static void readStructure(TestKit t) {
        JsonElement sampleDump = ShareDump.parse(SAMPLE_DUMP);
        t.check("codec: the hand-built sample reads as expected", () ->
            sameJson(sampleDump, dumpOf((r, s, b) -> { }), "dump"));
        t.check("codec: a root without Schematic but with Version is the Schematic itself", () ->
            sameJson(sampleDump, ShareDump.dump(SchemCodec.decode((CompoundTag) sample().get("Schematic"))), "dump"));
        t.check("codec: Schematic not a compound -> bad_schematic (no fallback to the root)", () ->
            readError(BAD, "Schematic is not a compound", (r, s, b) -> {
                r.putInt("Version", 3);
                r.putString("Schematic", "x");
            }));
        t.check("codec: no Schematic and no Version -> bad_schematic", () ->
            readError(BAD, "no Schematic compound", (r, s, b) -> r.remove("Schematic")));
        t.check("codec: unknown keys are ignored (also a stray v2-style Palette)", () ->
            sameJson(sampleDump, dumpOf((r, s, b) -> {
                r.putString("Other", "x");
                s.putString("Author", "x");
                s.put("Palette", new CompoundTag());
                s.putInt("PaletteMax", 9);
                b.putString("Note", "x");
            }), "dump"));
        t.check("codec: Version missing / short / long / byte / string -> bad_schematic", () -> {
            readError(BAD, "Version", (r, s, b) -> s.remove("Version"));
            readError(BAD, "Version", (r, s, b) -> s.putShort("Version", (short) 3));
            readError(BAD, "Version", (r, s, b) -> s.putLong("Version", 3));
            readError(BAD, "Version", (r, s, b) -> s.putByte("Version", (byte) 3));
            readError(BAD, "Version", (r, s, b) -> s.putString("Version", "3"));
        });
        t.check("codec: Version 2 / 4 / 0 / -1 -> unsupported_version, number in the message", () -> {
            for (int v : new int[] {2, 4, 0, -1}) {
                ShareException e = readError(ShareException.UNSUPPORTED_VERSION, (r, s, b) -> s.putInt("Version", v));
                eq("这个文件是 Sponge 第 " + v + " 版格式，现在只支持第 3 版。", e.getMessage(), "message");
            }
        });
        t.check("codec: DataVersion missing / short / long -> bad_schematic", () -> {
            readError(BAD, "DataVersion", (r, s, b) -> s.remove("DataVersion"));
            readError(BAD, "DataVersion", (r, s, b) -> s.putShort("DataVersion", (short) 4790));
            readError(BAD, "DataVersion", (r, s, b) -> s.putLong("DataVersion", 4790));
        });
        t.check("codec: DataVersion 1343 reads, stays 1343, warns data_version", () -> {
            ShareModel m = read((r, s, b) -> s.putInt("DataVersion", 1343));
            eq(1343, m.dataVersion(), "dataVersion");
            eq(List.of(ShareModel.WARN_DATA_VERSION), m.warnings(), "warnings");
        });
        t.check("codec: Metadata string / list -> bad_schematic", () -> {
            readError(BAD, "Metadata", (r, s, b) -> s.putString("Metadata", "x"));
            readError(BAD, "Metadata", (r, s, b) -> s.put("Metadata", intList(1)));
        });
        t.check("codec: no Metadata -> meta null", () ->
            ok(read((r, s, b) -> s.remove("Metadata")).meta() == null, "meta should be null"));
        t.check("codec: Metadata is kept verbatim (unknown keys, a wrong RequiredMods)", () -> {
            CompoundTag[] written = new CompoundTag[1];
            ShareModel m = read((r, s, b) -> {
                CompoundTag md = (CompoundTag) s.get("Metadata");
                md.putString("Whatever", "x");
                md.put("RequiredMods", intList(7));
                written[0] = md.copy();
            });
            sameJson(ShareDump.tagToJson(written[0]), ShareDump.tagToJson(m.meta()), "meta");
        });
        t.check("codec: Width/Height/Length missing / int / byte / 0 -> bad_schematic", () -> {
            for (String k : new String[] {"Width", "Height", "Length"}) {
                readError(BAD, k, (r, s, b) -> s.remove(k));
                readError(BAD, k, (r, s, b) -> s.putInt(k, 1));
                readError(BAD, k, (r, s, b) -> s.putByte(k, (byte) 1));
                readError(BAD, k + " is 0", (r, s, b) -> s.putShort(k, (short) 0));
            }
        });
        t.check("codec: a side of 1025 / 2048 / short -1 (= 65535) -> too_large", () -> {
            for (int v : new int[] {1025, 2048, -1}) {
                readError(ShareException.TOO_LARGE, "size", (r, s, b) -> s.putShort("Length", (short) v));
            }
        });
        t.check("codec: 1024x5x1024 (over 4,194,304 cells) -> too_large before Blocks is looked at", () ->
            readError(ShareException.TOO_LARGE, "size", (r, s, b) -> {
                size(s, 1024, 5, 1024);
                s.remove("Blocks");
            }));
        t.check("codec: 1024x4x1024 passes the size check (then Data is too short -> bad_schematic)", () ->
            readError(BAD, "Data", (r, s, b) -> size(s, 1024, 4, 1024)));
        t.check("codec: width 1024 reads (short read unsigned); unused chest -> unused_palette", () -> {
            ShareModel m = read((r, s, b) -> {
                size(s, 1024, 1, 1);
                byte[] data = new byte[1024];
                Arrays.fill(data, (byte) 5);
                b.putByteArray("Data", data);
                b.remove("BlockEntities");
            });
            eq(1024, m.width(), "width");
            eq(List.of("minecraft:stone"), m.palette(), "palette");
            eq(List.of(ShareModel.WARN_UNUSED_PALETTE), m.warnings(), "warnings");
        });
        t.check("codec: no Offset -> [0, 0, 0]", () ->
            eq("[0, 0, 0]", Arrays.toString(read((r, s, b) -> s.remove("Offset")).offset()), "offset"));
        t.check("codec: Offset int[2] / int[4] / list / long array -> bad_schematic", () -> {
            readError(BAD, "Offset", (r, s, b) -> s.putIntArray("Offset", new int[] {1, 2}));
            readError(BAD, "Offset", (r, s, b) -> s.putIntArray("Offset", new int[] {1, 2, 3, 4}));
            readError(BAD, "Offset", (r, s, b) -> s.put("Offset", intList(1, 2, 3)));
            readError(BAD, "Offset", (r, s, b) -> s.putLongArray("Offset", new long[] {1, 2, 3}));
        });
        t.check("codec: Blocks missing / not a compound -> bad_schematic", () -> {
            readError(BAD, "Blocks missing", (r, s, b) -> s.remove("Blocks"));
            readError(BAD, "Blocks missing", (r, s, b) -> s.putString("Blocks", "x"));
        });
    }

    // ---------------------------------------------------------------- read: Blocks (FORMAT §3)

    static CompoundTag firstBe(CompoundTag b) {
        return (CompoundTag) ((ListTag) b.get("BlockEntities")).get(0);
    }

    private static void readBlocks(TestKit t) {
        JsonElement sampleDump = ShareDump.parse(SAMPLE_DUMP);
        t.check("codec: Palette missing / not a compound -> bad_schematic", () -> {
            readError(BAD, "Blocks.Palette missing", (r, s, b) -> b.remove("Palette"));
            readError(BAD, "Blocks.Palette missing", (r, s, b) -> b.put("Palette", intList(1)));
        });
        t.check("codec: a Palette number that is short / string / negative -> bad_schematic", () -> {
            readError(BAD, "palette entry", (r, s, b) -> ((CompoundTag) b.get("Palette")).putShort(CHEST, (short) 2));
            readError(BAD, "palette entry", (r, s, b) -> ((CompoundTag) b.get("Palette")).putString(CHEST, "2"));
            readError(BAD, "palette entry", (r, s, b) -> ((CompoundTag) b.get("Palette")).putInt("minecraft:dirt", -1));
        });
        t.check("codec: two Palette keys with one number -> bad_schematic", () ->
            readError(BAD, "palette id 5 used twice", (r, s, b) -> ((CompoundTag) b.get("Palette")).putInt("minecraft:dirt", 5)));
        t.check("codec: Palette of 65,536 entries reads (unused ones dropped, unused_palette)", () -> {
            ShareModel m = read((r, s, b) -> bigPalette((CompoundTag) b.get("Palette"), 65_536));
            eq(List.of("minecraft:stone", CHEST), m.palette(), "palette");
            eq(List.of(ShareModel.WARN_UNUSED_PALETTE), m.warnings(), "warnings");
        });
        t.check("codec: Palette of 65,537 entries -> too_large", () ->
            readError(ShareException.TOO_LARGE, "palette has 65537 entries",
                (r, s, b) -> bigPalette((CompoundTag) b.get("Palette"), 65_537)));
        t.check("codec: Palette number 2^31-1 works (varint ff ff ff ff 07)", () ->
            sameJson(sampleDump, dumpOf((r, s, b) -> {
                ((CompoundTag) b.get("Palette")).putInt("minecraft:stone", Integer.MAX_VALUE);
                b.putByteArray("Data", TestKit.unhex("ffffffff07 02"));
            }), "dump"));
        t.check("codec: Data missing / int array -> bad_schematic", () -> {
            readError(BAD, "Blocks.Data missing", (r, s, b) -> b.remove("Data"));
            readError(BAD, "Blocks.Data missing", (r, s, b) -> b.putIntArray("Data", new int[] {5, 2}));
        });
        t.check("codec: Data too short / empty / with a byte left over -> bad_schematic", () -> {
            readError(BAD, "Data has 1 varints, needs 2", (r, s, b) -> b.putByteArray("Data", new byte[] {5}));
            readError(BAD, "Data has 0 varints, needs 2", (r, s, b) -> b.putByteArray("Data", new byte[0]));
            readError(BAD, "bytes after 2 varints", (r, s, b) -> b.putByteArray("Data", new byte[] {5, 2, 2}));
        });
        t.check("codec: Data with an id not in Palette / too big / cut -> bad_schematic", () -> {
            readError(BAD, "cell 1 has id 3, not in the palette", (r, s, b) -> b.putByteArray("Data", new byte[] {5, 3}));
            readError(BAD, "longer than 5 bytes", (r, s, b) -> b.putByteArray("Data", TestKit.unhex("ffffffff08 02")));
            readError(BAD, "ends inside varint", (r, s, b) -> b.putByteArray("Data", TestKit.unhex("05 82")));
        });
        t.check("codec: no BlockEntities -> none", () ->
            ok(read((r, s, b) -> b.remove("BlockEntities")).blockEntities().isEmpty(), "expected no block entities"));
        t.check("codec: BlockEntities not a list / element not a compound -> bad_schematic", () -> {
            readError(BAD, "is not a list", (r, s, b) -> b.put("BlockEntities", new CompoundTag()));
            readError(BAD, "block entity 0 is not a compound", (r, s, b) -> b.put("BlockEntities", intList(1)));
            readError(BAD, "block entity 1 is not a compound", (r, s, b) ->
                ((ListTag) b.get("BlockEntities")).add(IntTag.valueOf(1)));
        });
        t.check("codec: block entity Pos missing / int[2] / list -> bad_schematic", () -> {
            readError(BAD, "Pos is not an int array of 3", (r, s, b) -> firstBe(b).remove("Pos"));
            readError(BAD, "Pos is not an int array of 3", (r, s, b) -> firstBe(b).putIntArray("Pos", new int[] {1, 0}));
            readError(BAD, "Pos is not an int array of 3", (r, s, b) -> firstBe(b).put("Pos", intList(1, 0, 0)));
        });
        t.check("codec: block entity Pos outside the size -> bad_schematic (Offset is not added)", () -> {
            for (int[] p : new int[][] {{2, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, 0, 1}, {0, -1, 0}}) {
                readError(BAD, "outside the size", (r, s, b) -> firstBe(b).putIntArray("Pos", p));
            }
        });
        t.check("codec: block entity Id missing / not a string, Data not a compound -> bad_schematic", () -> {
            readError(BAD, "Id missing", (r, s, b) -> firstBe(b).remove("Id"));
            readError(BAD, "Id missing", (r, s, b) -> firstBe(b).putInt("Id", 1));
            readError(BAD, "Data is not a compound", (r, s, b) -> firstBe(b).putString("Data", "x"));
        });
        t.check("codec: block entity without Data -> data null", () -> {
            ShareModel m = read((r, s, b) -> firstBe(b).remove("Data"));
            ShareModel.BlockEntityEntry e = m.blockEntity(1, 0, 0);
            ok(e != null && e.data() == null && e.id().equals("minecraft:chest"), "got " + e);
        });
        t.check("codec: two block entities in one cell -> bad_schematic", () ->
            readError(BAD, "Pos [1, 0, 0] used twice", (r, s, b) ->
                ((ListTag) b.get("BlockEntities")).add(firstBe(b).copy())));
    }

    /** Adds entries test:filler_i (numbers 100, 101, …) until the Palette has {@code size} entries. */
    static void bigPalette(CompoundTag palette, int size) {
        for (int i = 0; palette.size() < size; i++) {
            palette.putInt("test:filler_" + i, 100 + i);
        }
    }

    // ---------------------------------------------------------------- read: which problem wins (FORMAT §3 order)

    private static void readOrder(TestKit t) {
        t.check("order: Version 2 without DataVersion -> unsupported_version", () ->
            readError(ShareException.UNSUPPORTED_VERSION, (r, s, b) -> {
                s.putInt("Version", 2);
                s.remove("DataVersion");
            }));
        t.check("order: DataVersion before Metadata before sizes", () -> {
            readError(BAD, "DataVersion", (r, s, b) -> {
                s.remove("DataVersion");
                s.putString("Metadata", "x");
            });
            readError(BAD, "Metadata", (r, s, b) -> {
                s.putString("Metadata", "x");
                s.putShort("Width", (short) 0);
            });
        });
        t.check("order: all three sizes are checked for presence/0 before too_large", () ->
            readError(BAD, "Width is 0", (r, s, b) -> {
                s.putShort("Width", (short) 0);
                s.putShort("Height", (short) 2000);
            }));
        t.check("order: too_large before Offset, Offset before Blocks", () -> {
            readError(ShareException.TOO_LARGE, "size", (r, s, b) -> {
                s.putShort("Width", (short) 2000);
                s.putString("Offset", "x");
            });
            readError(BAD, "Offset", (r, s, b) -> {
                s.putString("Offset", "x");
                s.remove("Blocks");
            });
        });
        t.check("order: Palette (entries, numbers, count) before Data before BlockEntities", () -> {
            readError(ShareException.TOO_LARGE, "palette has", (r, s, b) -> {
                bigPalette((CompoundTag) b.get("Palette"), 65_537);
                b.remove("Data");
            });
            readError(BAD, "palette entry", (r, s, b) -> {
                bigPalette((CompoundTag) b.get("Palette"), 65_537);
                ((CompoundTag) b.get("Palette")).putInt("minecraft:dirt", -1);
            });
            readError(BAD, "used twice", (r, s, b) -> {
                ((CompoundTag) b.get("Palette")).putInt("minecraft:dirt", 5);
                b.remove("Data");
            });
            readError(BAD, "bytes after", (r, s, b) -> {
                b.putByteArray("Data", new byte[] {5, 2, 2});
                b.put("BlockEntities", new CompoundTag());
            });
            readError(BAD, "not in the palette", (r, s, b) -> {
                b.putByteArray("Data", new byte[] {5, 9});
                b.put("BlockEntities", new CompoundTag());
            });
        });
    }

    // ---------------------------------------------------------------- warnings (FORMAT §3, §3.1)

    private static void warnings(TestKit t) {
        t.check("warnings: Biomes present (any type) -> ignored_biomes", () -> {
            eq(List.of(ShareModel.WARN_IGNORED_BIOMES), read((r, s, b) -> s.put("Biomes", new CompoundTag())).warnings(), "compound");
            eq(List.of(ShareModel.WARN_IGNORED_BIOMES), read((r, s, b) -> s.putInt("Biomes", 0)).warnings(), "int");
        });
        t.check("warnings: Entities list with >= 1 element -> ignored_entities; empty list / not a list -> none", () -> {
            eq(List.of(ShareModel.WARN_IGNORED_ENTITIES), read((r, s, b) -> s.put("Entities", intList(1))).warnings(), "1 element");
            eq(List.of(), read((r, s, b) -> s.put("Entities", new ListTag())).warnings(), "empty list");
            eq(List.of(), read((r, s, b) -> s.put("Entities", new CompoundTag())).warnings(), "compound");
        });
        t.check("warnings: Xiaojingyu.FormatVersion 2 -> newer_format; 1 / missing / string / not a compound -> none", () -> {
            eq(List.of(ShareModel.WARN_NEWER_FORMAT), read(formatVersion(IntTag.valueOf(2))).warnings(), "2");
            eq(List.of(), read(formatVersion(IntTag.valueOf(1))).warnings(), "1");
            eq(List.of(), read(formatVersion(null)).warnings(), "missing");
            eq(List.of(), read(formatVersion(StringTag.valueOf("2"))).warnings(), "string");
            eq(List.of(), read((r, s, b) -> ((CompoundTag) s.get("Metadata")).putString("Xiaojingyu", "x")).warnings(),
                "Xiaojingyu not a compound");
        });
        t.check("warnings: all at once, sorted, each once", () ->
            eq(List.of("data_version", "ignored_biomes", "ignored_entities", "newer_format", "unused_palette"),
                read((r, s, b) -> {
                    s.putInt("DataVersion", 1);
                    s.putInt("Biomes", 0);
                    s.put("Entities", intList(1, 2));
                    ((CompoundTag) b.get("Palette")).putInt("minecraft:dirt", 7);
                    formatVersion(IntTag.valueOf(5)).apply(r, s, b);
                }).warnings(), "warnings"));
    }

    static Edit formatVersion(Tag value) {
        return (r, s, b) -> {
            CompoundTag xjy = new CompoundTag();
            if (value != null) {
                xjy.put("FormatVersion", value);
            }
            ((CompoundTag) s.get("Metadata")).put("Xiaojingyu", xjy);
        };
    }

    // ---------------------------------------------------------------- writer (FORMAT §3 "写的时候")

    /** stone at (0,0,0), chest with a block entity at (1,0,0), offset (-1,0,1), no meta. */
    static ShareModel stoneChest() {
        ShareModel m = new ShareModel(2, 1, 1);
        m.set(0, 0, 0, "minecraft:stone");
        m.set(1, 0, 0, CHEST);
        CompoundTag data = new CompoundTag();
        data.putString("CustomName", "箱子");
        m.putBlockEntity(1, 0, 0, "minecraft:chest", data);
        m.setOffset(-1, 0, 1);
        return m;
    }

    static List<String> sorted(java.util.Set<String> keys) {
        return keys.stream().sorted().toList();
    }

    static CompoundTag schematicOf(ShareModel m) throws ShareException {
        return (CompoundTag) SchemCodec.encode(m).get("Schematic");
    }

    private static void writer(TestKit t) {
        t.check("writer: keys and types of a written file", () -> {
            CompoundTag root = SchemCodec.encode(stoneChest());
            eq(List.of("Schematic"), sorted(root.keySet()), "root keys");
            CompoundTag s = (CompoundTag) root.get("Schematic");
            eq(List.of("Blocks", "DataVersion", "Height", "Length", "Offset", "Version", "Width"), sorted(s.keySet()),
                "Schematic keys (meta null -> no Metadata)");
            ok(s.get("Version") instanceof IntTag v && v.value() == 3, "Version must be int 3");
            ok(s.get("DataVersion") instanceof IntTag v && v.value() == 4790, "DataVersion must be int 4790");
            ok(s.get("Width") instanceof ShortTag w && w.value() == 2, "Width must be short 2");
            ok(s.get("Height") instanceof ShortTag h && h.value() == 1, "Height must be short 1");
            ok(s.get("Length") instanceof ShortTag l && l.value() == 1, "Length must be short 1");
            eq("[-1, 0, 1]", Arrays.toString(((IntArrayTag) s.get("Offset")).getAsIntArray()), "Offset");
            CompoundTag b = (CompoundTag) s.get("Blocks");
            eq(List.of("BlockEntities", "Data", "Palette"), sorted(b.keySet()), "Blocks keys");
            CompoundTag palette = new CompoundTag();
            palette.putInt("minecraft:stone", 0);
            palette.putInt(CHEST, 1);
            sameJson(ShareDump.tagToJson(palette), ShareDump.tagToJson(b.get("Palette")), "Palette");
            TestKit.eqHex("00 01", ((ByteArrayTag) b.get("Data")).getAsByteArray(), "Data");
            sameJson(ShareDump.parse("""
                {"list": [{"compound": {"Pos": {"intArray": [1, 0, 0]}, "Id": {"string": "minecraft:chest"},
                           "Data": {"compound": {"CustomName": {"string": "箱子"}}}}}]}
                """), ShareDump.tagToJson(b.get("BlockEntities")), "BlockEntities");
        });
        t.check("writer: Palette numbered by first appearance; unused states (also air) are not written", () -> {
            ShareModel m = new ShareModel(3, 1, 1);
            m.paletteId("minecraft:gold_block");
            m.set(0, 0, 0, "minecraft:dirt");
            m.set(1, 0, 0, "minecraft:stone");
            m.set(2, 0, 0, "minecraft:dirt");
            CompoundTag b = (CompoundTag) schematicOf(m).get("Blocks");
            CompoundTag palette = new CompoundTag();
            palette.putInt("minecraft:dirt", 0);
            palette.putInt("minecraft:stone", 1);
            sameJson(ShareDump.tagToJson(palette), ShareDump.tagToJson(b.get("Palette")), "Palette");
            TestKit.eqHex("00 01 00", ((ByteArrayTag) b.get("Data")).getAsByteArray(), "Data");
        });
        t.check("writer: RequiredMods recomputed from the written palette (sorted, no minecraft, \":stone\" -> \"\")", () -> {
            String[] states = {"create:shaft[axis=x]", "minecraft:stone", "xiaojingyu:shell", ":stone", "foo", "create:gear"};
            ShareModel m = new ShareModel(states.length, 1, 1);
            for (int i = 0; i < states.length; i++) {
                m.set(i, 0, 0, states[i]);
            }
            m.paletteId("unused:block");
            CompoundTag meta = new CompoundTag();
            meta.putString("Name", "x");
            meta.put("RequiredMods", intList(1));
            CompoundTag before = meta.copy();
            m.setMeta(meta);
            CompoundTag md = (CompoundTag) schematicOf(m).get("Metadata");
            ListTag expected = new ListTag();
            for (String ns : new String[] {"", "create", "xiaojingyu"}) {
                expected.add(StringTag.valueOf(ns));
            }
            sameJson(ShareDump.tagToJson(expected), ShareDump.tagToJson(md.get("RequiredMods")), "RequiredMods");
            eq(List.of("Name", "RequiredMods"), sorted(md.keySet()), "Metadata keys");
            sameJson(ShareDump.tagToJson(before), ShareDump.tagToJson(m.meta()), "the model's own meta must not change");
            eq(List.of("", "create", "xiaojingyu"), SchemCodec.requiredMods(Arrays.asList(states)), "requiredMods()");
        });
        t.check("writer: vanilla-only palette removes RequiredMods, keeps other keys; meta null -> no Metadata", () -> {
            ShareModel m = stoneChest();
            CompoundTag meta = new CompoundTag();
            meta.putString("Name", "x");
            meta.put("RequiredMods", intList(1));
            m.setMeta(meta);
            eq(List.of("Name"), sorted(((CompoundTag) schematicOf(m).get("Metadata")).keySet()), "Metadata keys");
            m.setMeta(null);
            ok(!schematicOf(m).contains("Metadata"), "meta null must write no Metadata");
        });
        t.check("writer: an all-air model still has Offset, Palette {air: 0} and an empty BlockEntities list", () -> {
            CompoundTag s = schematicOf(new ShareModel(1, 1, 1));
            eq("[0, 0, 0]", Arrays.toString(((IntArrayTag) s.get("Offset")).getAsIntArray()), "Offset");
            CompoundTag b = (CompoundTag) s.get("Blocks");
            CompoundTag palette = new CompoundTag();
            palette.putInt(ShareModel.AIR, 0);
            sameJson(ShareDump.tagToJson(palette), ShareDump.tagToJson(b.get("Palette")), "Palette");
            ok(b.get("BlockEntities") instanceof ListTag l && l.isEmpty(), "BlockEntities must be an empty list");
            ShareModel back = ShareFiles.read(ShareFiles.writePng(new ShareModel(1, 1, 1)));
            eq(List.of(ShareModel.AIR), back.palette(), "palette read back");
            eq(List.of(), back.warnings(), "warnings read back");
        });
        t.check("writer: block entities sorted by cell index; data null -> no Data key", () -> {
            ShareModel m = new ShareModel(2, 2, 1);
            m.putBlockEntity(0, 1, 0, "test:b", null);
            CompoundTag d = new CompoundTag();
            d.putInt("n", 1);
            m.putBlockEntity(1, 0, 0, "test:a", d);
            sameJson(ShareDump.parse("""
                {"list": [
                  {"compound": {"Pos": {"intArray": [1, 0, 0]}, "Id": {"string": "test:a"},
                                "Data": {"compound": {"n": {"int": 1}}}}},
                  {"compound": {"Pos": {"intArray": [0, 1, 0]}, "Id": {"string": "test:b"}}}]}
                """), ShareDump.tagToJson(((CompoundTag) schematicOf(m).get("Blocks")).get("BlockEntities")), "BlockEntities");
        });
        t.check("writer: a cell with an id outside the palette -> bad_schematic", () -> {
            ShareModel m = new ShareModel(2, 1, 1);
            m.cells()[1] = 5;
            error(BAD, () -> SchemCodec.encode(m), "id 5");
            m.cells()[1] = -1;
            error(BAD, () -> SchemCodec.encode(m), "id -1");
        });
        t.check("writer: 65,536 used states write and read back; 65,537 -> too_large", () -> {
            ShareModel m = new ShareModel(1024, 1, 64);
            int[] cells = m.cells();
            for (int i = 0; i < cells.length; i++) {
                cells[i] = m.paletteId("test:s" + i);
            }
            eq(65_536, ShareFiles.read(ShareFiles.writePng(m)).palette().size(), "palette size read back");
            ShareModel big = new ShareModel(1024, 1, 65);
            int[] bigCells = big.cells();
            for (int i = 0; i < bigCells.length; i++) {
                bigCells[i] = big.paletteId("test:s" + i);
            }
            ShareException e = error(ShareException.TOO_LARGE, () -> SchemCodec.encode(big));
            ok(e.detail().contains("66560 different block states"), "detail: " + e.detail());
        });
        t.check("writer: dataVersion is written as set; reading warns when it is not 4790", () -> {
            ShareModel m = stoneChest();
            m.setDataVersion(3953);
            ok(schematicOf(m).get("DataVersion") instanceof IntTag v && v.value() == 3953, "DataVersion");
            ShareModel back = ShareFiles.read(ShareFiles.writePng(m));
            eq(3953, back.dataVersion(), "read back");
            eq(List.of(ShareModel.WARN_DATA_VERSION), back.warnings(), "warnings");
        });
    }

    // ---------------------------------------------------------------- ShareModel

    private static void model(TestKit t) {
        t.check("model: sizes 1..1024 per side and at most 4,194,304 cells are allowed", () -> {
            ok(ShareModel.sizeAllowed(1, 1, 1), "1x1x1");
            ok(ShareModel.sizeAllowed(1024, 4, 1024), "1024x4x1024");
            ok(ShareModel.sizeAllowed(1024, 1024, 4), "1024x1024x4");
            int[][] refused = {{0, 1, 1}, {1, 0, 1}, {1, 1, 0}, {-1, 1, 1}, {1025, 1, 1}, {1, 1025, 1},
                {1, 1, 1025}, {1024, 5, 1024}, {1024, 1024, 1024}, {Integer.MAX_VALUE, 1, 1}};
            for (int[] s : refused) {
                ok(!ShareModel.sizeAllowed(s[0], s[1], s[2]), "allowed: " + Arrays.toString(s));
                TestKit.thrown(IllegalArgumentException.class, () -> new ShareModel(s[0], s[1], s[2]),
                    "new ShareModel" + Arrays.toString(s));
            }
        });
        t.check("model: checkSize says bad_schematic for a side < 1, too_large above the limits", () -> {
            ShareModel.checkSize(1024, 4, 1024);
            error(BAD, () -> ShareModel.checkSize(0, 1, 1));
            error(BAD, () -> ShareModel.checkSize(1, 1, -5));
            error(ShareException.TOO_LARGE, () -> ShareModel.checkSize(1025, 1, 1));
            error(ShareException.TOO_LARGE, () -> ShareModel.checkSize(1024, 5, 1024));
        });
        t.check("model: a new model is all air, DataVersion 4790, offset 0, no meta", () -> {
            ShareModel m = new ShareModel(3, 4, 5);
            eq(60, m.volume(), "volume");
            eq(List.of(ShareModel.AIR), m.palette(), "palette");
            eq(60, m.cells().length, "cells");
            ok(Arrays.stream(m.cells()).allMatch(c -> c == 0), "cells all 0");
            eq(4790, ShareModel.CURRENT_DATA_VERSION, "CURRENT_DATA_VERSION");
            eq(4790, m.dataVersion(), "dataVersion");
            eq("[0, 0, 0]", Arrays.toString(m.offset()), "offset");
            ok(m.meta() == null, "meta null");
            ok(m.blockEntities().isEmpty() && m.warnings().isEmpty(), "no block entities, no warnings");
        });
        t.check("model: cell index is x + z*W + y*W*L; outside -> IndexOutOfBoundsException", () -> {
            ShareModel m = new ShareModel(3, 4, 5);
            eq(0, m.index(0, 0, 0), "(0,0,0)");
            eq(1, m.index(1, 0, 0), "(1,0,0)");
            eq(3, m.index(0, 0, 1), "(0,0,1)");
            eq(15, m.index(0, 1, 0), "(0,1,0)");
            eq(2 + 4 * 3 + 3 * 15, m.index(2, 3, 4), "(2,3,4)");
            ok(m.contains(2, 3, 4) && !m.contains(3, 0, 0) && !m.contains(0, -1, 0), "contains");
            int[][] outside = {{3, 0, 0}, {0, 4, 0}, {0, 0, 5}, {-1, 0, 0}, {0, -1, 0}, {0, 0, -1}};
            for (int[] p : outside) {
                TestKit.thrown(IndexOutOfBoundsException.class, () -> m.index(p[0], p[1], p[2]),
                    "index" + Arrays.toString(p));
            }
        });
        t.check("model: set/get/paletteId; cells() is the live array of palette ids", () -> {
            ShareModel m = new ShareModel(2, 2, 2);
            m.set(1, 0, 0, "minecraft:stone");
            m.set(0, 1, 1, CHEST);
            m.set(1, 1, 1, "minecraft:stone");
            eq(List.of(ShareModel.AIR, "minecraft:stone", CHEST), m.palette(), "palette");
            eq("minecraft:stone", m.get(1, 0, 0), "get(1,0,0)");
            eq(CHEST, m.get(0, 1, 1), "get(0,1,1)");
            eq(ShareModel.AIR, m.get(0, 0, 0), "get(0,0,0)");
            eq(1, m.paletteId("minecraft:stone"), "paletteId of a known state");
            eq(3, m.paletteId("minecraft:dirt"), "paletteId adds a new state");
            m.cells()[m.index(0, 0, 0)] = 3;
            eq("minecraft:dirt", m.get(0, 0, 0), "after writing cells() directly");
            TestKit.thrown(UnsupportedOperationException.class, () -> m.palette().add("x"), "palette() is read-only");
        });
        t.check("model: block entities by cell, sorted by cell index; blockEntityData / fullNbt", () -> {
            ShareModel m = new ShareModel(2, 2, 1);
            CompoundTag full = new CompoundTag();
            full.putString("id", "minecraft:chest");
            full.putInt("x", 100);
            full.putInt("y", 64);
            full.putInt("z", -7);
            full.putString("CustomName", "箱子");
            CompoundTag data = ShareModel.blockEntityData(full);
            eq(List.of("CustomName"), sorted(data.keySet()), "data keys");
            eq(5, full.size(), "the full NBT is not changed");
            m.putBlockEntity(1, 1, 0, "minecraft:sign", null);
            m.putBlockEntity(1, 0, 0, "minecraft:chest", data);
            m.putBlockEntity(0, 1, 0, "minecraft:barrel", new CompoundTag());
            List<Integer> order = new ArrayList<>();
            for (ShareModel.BlockEntityEntry be : m.blockEntities()) {
                order.add(m.index(be.x(), be.y(), be.z()));
            }
            eq(List.of(1, 2, 3), order, "cell indexes in order");
            m.putBlockEntity(1, 0, 0, "minecraft:trapped_chest", data);
            eq("minecraft:trapped_chest", m.blockEntity(1, 0, 0).id(), "replaced");
            eq(3, m.blockEntities().size(), "still 3");
            m.removeBlockEntity(0, 1, 0);
            ok(m.blockEntity(0, 1, 0) == null && m.blockEntities().size() == 2, "removed");
            CompoundTag back = m.blockEntity(1, 0, 0).fullNbt(100, 64, -7);
            full.putString("id", "minecraft:trapped_chest");
            sameJson(ShareDump.tagToJson(full), ShareDump.tagToJson(back), "fullNbt");
            eq(List.of("id", "x", "y", "z"), sorted(m.blockEntity(1, 1, 0).fullNbt(0, 0, 0).keySet()),
                "fullNbt without data");
            TestKit.thrown(IndexOutOfBoundsException.class, () -> m.putBlockEntity(2, 0, 0, "x:y", null),
                "outside");
        });
        t.check("model: newMeta builds the Metadata of FORMAT.md section 3.1; defaultName", () -> {
            CompoundTag meta = ShareModel.newMeta("capture-20261106-040506", "Steve", 1_762_372_000_000L,
                "east", 10, 64, -20, "minecraft:overworld", "xiaojingyu-mod/0.1.0", "26.1.2");
            sameJson(ShareDump.parse("""
                {"compound": {"Name": {"string": "capture-20261106-040506"}, "Author": {"string": "Steve"},
                 "Date": {"long": "1762372000000"},
                 "Xiaojingyu": {"compound": {"FormatVersion": {"int": 1}, "Facing": {"string": "east"},
                   "Origin": {"intArray": [10, 64, -20]}, "Dimension": {"string": "minecraft:overworld"},
                   "Source": {"string": "xiaojingyu-mod/0.1.0"}, "GameVersion": {"string": "26.1.2"}}}}}
                """), ShareDump.tagToJson(meta), "meta");
            TestKit.thrown(IllegalArgumentException.class, () -> ShareModel.newMeta("n", "a", 0, "up", 0, 0, 0,
                "minecraft:overworld", "s", "g"), "facing up");
            eq("capture-20261106-040506", ShareModel.defaultName(LocalDateTime.of(2026, 11, 6, 4, 5, 6)), "name");
        });
    }

    // ---------------------------------------------------------------- dump JSON (FORMAT §4)

    interface JsonEdit {
        void apply(JsonObject dump);
    }

    private static void dumpJson(TestKit t, Path formatDoc) {
        if (formatDoc == null) {
            t.skip("dump: the example in FORMAT.md section 4", "no --format-doc given");
        } else {
            t.check("dump: the example in FORMAT.md section 4 -> model -> dump is the same; also through a PNG", () -> {
                JsonElement example = ShareDump.parse(fenced(section(readDoc(formatDoc), "## 4."), "```json"));
                ShareModel m = ShareDump.toModel(example);
                sameJson(example, ShareDump.dump(m), "dump");
                sameJson(example, ShareDump.dump(ShareFiles.read(ShareFiles.writePng(m))), "via PNG");
            });
        }
        t.check("dump: typed JSON of every NBT type (FORMAT.md section 4 table), both ways", () -> {
            CompoundTag c = new CompoundTag();
            c.putByte("b", (byte) -1);
            c.putShort("s", (short) 300);
            c.putInt("i", 7);
            c.putLong("l", Long.MIN_VALUE);
            c.putFloat("f", 1.5f);
            c.putDouble("d", 1.5);
            c.putString("t", "海边 🐳");
            c.putByteArray("ba", new byte[] {-128, 0, 127});
            c.putIntArray("ia", new int[] {1, -2});
            c.putLongArray("la", new long[] {1, -2});
            c.put("li", intList(1, 2));
            c.put("c", new CompoundTag());
            JsonElement expected = ShareDump.parse("""
                {"compound": {"b": {"byte": -1}, "s": {"short": 300}, "i": {"int": 7},
                 "l": {"long": "-9223372036854775808"}, "f": {"float": "3fc00000"},
                 "d": {"double": "3ff8000000000000"}, "t": {"string": "海边 🐳"},
                 "ba": {"byteArray": [-128, 0, 127]}, "ia": {"intArray": [1, -2]},
                 "la": {"longArray": ["1", "-2"]}, "li": {"list": [{"int": 1}, {"int": 2}]},
                 "c": {"compound": {}}}}
                """);
            sameJson(expected, ShareDump.tagToJson(c), "tag -> JSON");
            sameJson(expected, ShareDump.tagToJson(ShareDump.jsonToTag(expected, "$")), "JSON -> tag -> JSON");
        });
        t.check("dump: typed JSON written any other way is refused", () -> {
            String[] refused = {
                "{\"float\": \"3FC00000\"}", "{\"float\": \"3fc0000\"}", "{\"float\": 1.5}",
                "{\"double\": \"3ff8\"}", "{\"long\": 5}", "{\"long\": \"01\"}", "{\"long\": \"+1\"}",
                "{\"long\": \"-0\"}", "{\"long\": \"9223372036854775808\"}", "{\"byte\": 128}",
                "{\"short\": -32769}", "{\"int\": 2147483648}", "{\"int\": 1.5}", "{\"int\": \"7\"}",
                "{\"string\": 5}", "{\"byteArray\": [200]}", "{\"intArray\": [\"1\"]}",
                "{\"longArray\": [1]}", "{\"list\": [7]}", "{\"compound\": []}", "{\"bool\": true}",
                "{\"int\": 1, \"byte\": 1}", "{}"};
            for (String s : refused) {
                TestKit.thrown(IllegalArgumentException.class, () -> ShareDump.jsonToTag(ShareDump.parse(s), "$"), s);
            }
        });
        t.check("dump: toModel refuses broken dumps", () -> {
            List<JsonEdit> edits = List.of(
                d -> d.remove("warnings"),
                d -> d.addProperty("extra", 1),
                d -> d.addProperty("dump", 2),
                d -> d.add("size", ShareDump.parse("[2, 1]")),
                d -> d.add("size", ShareDump.parse("[0, 1, 1]")),
                d -> d.add("offset", ShareDump.parse("[0, 0]")),
                d -> d.remove("meta"),
                d -> d.add("palette", ShareDump.parse("[\"minecraft:stone\", \"minecraft:stone\"]")),
                d -> d.add("cells", ShareDump.parse("[[1, 0]]")),
                d -> d.add("cells", ShareDump.parse("[[1, 0], [2, 1]]")),
                d -> d.add("cells", ShareDump.parse("[[0, 0], [2, 1]]")),
                d -> d.add("cells", ShareDump.parse("[[1, 0], [1, 2]]")),
                d -> firstBeOf(d).add("pos", ShareDump.parse("[2, 0, 0]")),
                d -> firstBeOf(d).addProperty("extra", 1),
                d -> firstBeOf(d).remove("data"),
                d -> firstBeOf(d).addProperty("id", 5),
                d -> d.getAsJsonArray("blockEntities").add(firstBeOf(d).deepCopy()),
                d -> d.add("warnings", ShareDump.parse("[1]")));
            for (int i = 0; i < edits.size(); i++) {
                JsonObject d = ShareDump.parse(SAMPLE_DUMP).getAsJsonObject();
                ShareDump.toModel(d);
                edits.get(i).apply(d);
                TestKit.thrown(IllegalArgumentException.class, () -> ShareDump.toModel(d), "broken dump " + i);
            }
        });
        t.check("dump: print escapes for the console, keeps text in files; parse(print(x)) == x", () -> {
            JsonElement x = ShareDump.parse("""
                {"compound": {"键": {"string": "a\\u0000b🐳\\ud800\\"\\\\é"}}}
                """);
            String ascii = ShareDump.print(x, true);
            ok(ascii.chars().allMatch(c -> c == '\n' || (c >= 0x20 && c < 0x7f)), "console print is printable ASCII");
            ok(ascii.contains("\\ud800"), "lone surrogate escaped: " + ascii);
            sameJson(x, ShareDump.parse(ascii), "parse(console print)");
            String file = ShareDump.print(x, false);
            ok(file.contains("键") && file.contains("🐳") && file.contains("é"), "file print keeps the text");
            ok(file.contains("\\ud800") && !file.contains("\r") && file.endsWith("}\n"),
                "file print: lone surrogate escaped, LF only, newline at the end");
            sameJson(x, ShareDump.parse(file), "parse(file print)");
        });
        t.check("dump: firstDifference ignores key order and 1 vs 1.0, names the first differing path", () -> {
            JsonElement a = ShareDump.parse("{\"a\": 1, \"b\": [1, 2, {\"c\": \"x\"}]}");
            ok(ShareDump.firstDifference(a, ShareDump.parse("{\"b\": [1.0, 2, {\"c\": \"x\"}], \"a\": 1}")) == null,
                "same value");
            String d = ShareDump.firstDifference(a, ShareDump.parse("{\"a\": 1, \"b\": [1, 2, {\"c\": \"y\"}]}"));
            ok(d != null && d.startsWith("$.b[2].c:"), "path: " + d);
            String[] different = {"{\"a\": 1, \"b\": [1, 2]}", "{\"a\": 1, \"b\": [1, 2, {\"c\": \"x\"}], \"d\": 0}",
                "{\"a\": \"1\", \"b\": [1, 2, {\"c\": \"x\"}]}", "{\"b\": [1, 2, {\"c\": \"x\"}]}", "{\"a\": null, \"b\": []}"};
            for (String s : different) {
                ok(ShareDump.firstDifference(a, ShareDump.parse(s)) != null, "not the same: " + s);
            }
        });
    }

    static JsonObject firstBeOf(JsonObject dump) {
        return dump.getAsJsonArray("blockEntities").get(0).getAsJsonObject();
    }

    /** docs/FORMAT.md as text (CRLF turned into LF); a FAIL when the file is missing. */
    static String readDoc(Path formatDoc) {
        if (!Files.isRegularFile(formatDoc)) {
            throw fail("FORMAT.md not found: " + formatDoc);
        }
        try {
            return Files.readString(formatDoc, StandardCharsets.UTF_8).replace("\r\n", "\n");
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    /** From the line starting with {@code heading} up to the next "## " heading. */
    static String section(String doc, String heading) {
        int start = doc.startsWith(heading) ? 0 : doc.indexOf("\n" + heading);
        if (start < 0) {
            throw fail("FORMAT.md has no heading " + heading);
        }
        int end = doc.indexOf("\n## ", start + 1);
        return end < 0 ? doc.substring(start) : doc.substring(start, end);
    }

    /** The text of the first fenced block opened by {@code fence} (e.g. "```json") in text. */
    static String fenced(String text, String fence) {
        int open = text.indexOf("\n" + fence + "\n");
        if (open < 0) {
            throw fail("no " + fence + " block");
        }
        int from = open + fence.length() + 2;
        int close = text.indexOf("\n```", from - 1);
        if (close < 0) {
            throw fail("the " + fence + " block is not closed");
        }
        return text.substring(from, close + 1);
    }

    // ---------------------------------------------------------------- messages (FORMAT §5)

    private static final Pattern ERROR_ROW =
        Pattern.compile("(?m)^\\| `([a-z_]+)` \\|[^|\\n]*\\| ([^|\\n]+?) \\|\\s*$");
    private static final Pattern WARNING_LINE = Pattern.compile("(?m)^警告.*$");

    private static void messages(TestKit t, Path formatDoc) {
        if (formatDoc == null) {
            t.skip("messages: error codes and sentences are the ones in FORMAT.md section 5", "no --format-doc given");
            return;
        }
        t.check("messages: the error codes in FORMAT.md section 5 are exactly ShareException's", () -> eq(
            new TreeSet<>(List.of(ShareException.UNKNOWN_FILE, ShareException.BAD_PNG, ShareException.NO_DATA,
                ShareException.MULTIPLE_DATA, ShareException.BAD_CRC, ShareException.TOO_LARGE,
                ShareException.BAD_GZIP, ShareException.BAD_NBT, ShareException.UNSUPPORTED_VERSION, BAD)),
            new TreeSet<>(errorTable(formatDoc).keySet()), "codes"));
        t.check("messages: every getMessage() is the sentence of FORMAT.md section 5", () -> {
            TreeMap<String, String> table = errorTable(formatDoc);
            ok(!table.isEmpty(), "no error table found");
            for (Map.Entry<String, String> e : table.entrySet()) {
                String code = e.getKey();
                String doc5 = e.getValue();
                ShareException x;
                String expected;
                if (code.equals(ShareException.UNSUPPORTED_VERSION)) {
                    x = ShareException.unsupportedVersion(2);
                    expected = doc5.replace("第 N 版", "第 2 版");
                } else if (code.equals(BAD)) {
                    x = ShareException.badSchematic("Palette 缺了", "Palette missing");
                    expected = doc5.replace("（写明具体哪里）", "Palette 缺了") + "。";
                } else {
                    x = ShareException.of(code, "test");
                    expected = doc5;
                }
                eq(code, x.code(), "code");
                eq(expected, x.getMessage(), code);
            }
        });
        t.check("messages: the warning codes in FORMAT.md section 5 are the WARN_* constants", () -> {
            Matcher line = WARNING_LINE.matcher(section(readDoc(formatDoc), "## 5."));
            ok(line.find(), "no line starting with 警告");
            TreeSet<String> found = new TreeSet<>();
            Matcher code = Pattern.compile("`([a-z_]+)`").matcher(line.group());
            while (code.find()) {
                found.add(code.group(1));
            }
            eq(new TreeSet<>(List.of(ShareModel.WARN_DATA_VERSION, ShareModel.WARN_IGNORED_BIOMES,
                ShareModel.WARN_IGNORED_ENTITIES, ShareModel.WARN_NEWER_FORMAT, ShareModel.WARN_UNUSED_PALETTE)),
                found, "warnings");
        });
    }

    /** FORMAT.md §5 error table: code -> the sentence for the user. */
    static TreeMap<String, String> errorTable(Path formatDoc) {
        TreeMap<String, String> table = new TreeMap<>();
        Matcher row = ERROR_ROW.matcher(section(readDoc(formatDoc), "## 5."));
        while (row.find()) {
            table.put(row.group(1), row.group(2));
        }
        return table;
    }
}
