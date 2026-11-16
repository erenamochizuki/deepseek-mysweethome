package com.xiaojingyu.share;

import static com.xiaojingyu.share.TestKit.cat;
import static com.xiaojingyu.share.TestKit.eq;
import static com.xiaojingyu.share.TestKit.eqHex;
import static com.xiaojingyu.share.TestKit.error;
import static com.xiaojingyu.share.TestKit.fail;
import static com.xiaojingyu.share.TestKit.hex;
import static com.xiaojingyu.share.TestKit.mcWrite;
import static com.xiaojingyu.share.TestKit.named;
import static com.xiaojingyu.share.TestKit.ok;
import static com.xiaojingyu.share.TestKit.root;
import static com.xiaojingyu.share.TestKit.sameBytes;
import static com.xiaojingyu.share.TestKit.sameJson;
import static com.xiaojingyu.share.TestKit.u16;
import static com.xiaojingyu.share.TestKit.unhex;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.Random;
import net.minecraft.nbt.ByteArrayTag;
import net.minecraft.nbt.ByteTag;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.DoubleTag;
import net.minecraft.nbt.FloatTag;
import net.minecraft.nbt.IntArrayTag;
import net.minecraft.nbt.IntTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.LongArrayTag;
import net.minecraft.nbt.LongTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtAccounterException;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.ShortTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;

/** Unit tests: varints, MUTF-8, NBT types, list rules, NBT errors, depth (docs/FORMAT.md §2, §3). */
final class ShareNbtTests {
    private ShareNbtTests() {
    }

    static void run(TestKit t) {
        varints(t);
        mutf8(t);
        types(t);
        lists(t);
        errors(t);
        depth(t);
    }

    // ---------------------------------------------------------------- varint

    private static void varints(TestKit t) {
        int[][] lengths = {
            {0, 1}, {1, 1}, {127, 1}, {128, 2}, {255, 2}, {300, 2}, {16383, 2}, {16384, 3},
            {2097151, 3}, {2097152, 4}, {268435455, 4}, {268435456, 5}, {Integer.MAX_VALUE, 5},
        };
        for (int[] c : lengths) {
            t.check("varint " + c[0] + " is " + c[1] + " byte(s) and reads back", () -> {
                byte[] b = SchemCodec.encodeVarints(new int[] {c[0]});
                eq(c[1], b.length, "length");
                int[] back = new int[1];
                SchemCodec.decodeVarints(b, back);
                eq(c[0], back[0], "value");
            });
        }
        String[][] bytes = {
            {"0", "00"}, {"127", "7f"}, {"128", "8001"}, {"300", "ac02"}, {"16384", "808001"},
            {"268435456", "8080808001"}, {"2147483647", "ffffffff07"},
        };
        for (String[] c : bytes) {
            t.check("varint " + c[0] + " is written as " + c[1], () ->
                eqHex(c[1], SchemCodec.encodeVarints(new int[] {Integer.parseInt(c[0])}), "bytes"));
        }
        t.check("varint: several values in a row", () -> {
            int[] values = {0, 300, 1, Integer.MAX_VALUE, 128};
            byte[] b = SchemCodec.encodeVarints(values);
            eqHex("00 ac02 01 ffffffff07 8001", b, "bytes");
            int[] back = new int[values.length];
            SchemCodec.decodeVarints(b, back);
            eq(java.util.Arrays.toString(values), java.util.Arrays.toString(back), "values");
        });
        t.check("varint: longer-than-needed encodings are accepted", () -> {
            int[] back = new int[3];
            SchemCodec.decodeVarints(unhex("8000 ff00 8080808000"), back);
            eq("[0, 127, 0]", java.util.Arrays.toString(back), "values");
        });
        String[][] bad = {
            {"ffffffff08", "bigger than 2^31-1"}, {"ffffffff0f", "5th byte over 0x07"},
            {"808080808000", "6 bytes"}, {"80", "cut inside a varint"}, {"", "no bytes"},
            {"0000", "a byte left over"},
        };
        for (String[] c : bad) {
            t.check("varint error: " + c[1], () ->
                error(ShareException.BAD_SCHEMATIC, () -> SchemCodec.decodeVarints(unhex(c[0]), new int[1])));
        }
        t.check("varint error: fewer values than cells", () ->
            error(ShareException.BAD_SCHEMATIC, () -> SchemCodec.decodeVarints(unhex("01"), new int[2])));
    }

    // ---------------------------------------------------------------- MUTF-8

    /** The NBT bytes of a root compound {s: string}, string given as raw MUTF-8 body bytes. */
    private static byte[] stringRoot(byte[] body) {
        return root(named(8, "s", cat(u16(body.length), body)));
    }

    private static String readString(byte[] nbt) throws ShareException {
        Tag s = ShareNbt.readRoot(nbt).get("s");
        if (!(s instanceof StringTag str)) {
            throw fail("s is not a string: " + s);
        }
        return str.value();
    }

    /** What the JDK reads from these MUTF-8 bytes, or null if it refuses them. */
    private static String jdkRead(byte[] body) {
        try {
            return new DataInputStream(new ByteArrayInputStream(cat(u16(body.length), body))).readUTF();
        } catch (IOException e) {
            return null;
        }
    }

    private static byte[] jdkWrite(String s) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new DataOutputStream(out).writeUTF(s);
        return out.toByteArray();
    }

    private static void mutf8(TestKit t) {
        t.check("MUTF-8: U+0000 and an emoji are written like DataOutput.writeUTF and MC NbtIo.write", () -> {
            String s = "\u0000\uD83D\uDC33"; // NUL + whale emoji (a surrogate pair)
            CompoundTag tag = new CompoundTag();
            tag.put("s", StringTag.valueOf(s));
            byte[] ours = ShareNbt.writeRoot(tag);
            eqHex("0a0000 08 0001 73 0008 c080 eda0bd edb0b3 00", ours, "our bytes");
            sameBytes(mcWrite(tag), ours, "same as MC NbtIo.write");
            eqHex("0008 c080 eda0bd edb0b3", jdkWrite(s), "DataOutputStream.writeUTF");
            eq(s, readString(ours), "reads back");
        });
        String[][] accepted = { // what DataInputStream.readUTF accepts, we accept too
            {"c080", "\u0000"}, {"00", "\u0000"}, {"c181", "A"}, {"e08080", "\u0000"},
            {"eda080", "\uD800"}, {"edb0b3", "\uDC33"}, {"eda0bd", "\uD83D"}, {"", ""},
            {"7f", "\u007f"}, {"dfbf", "\u07ff"}, {"efbfbf", "\uffff"}, {"e4b8ad", "\u4e2d"},
        };
        for (String[] c : accepted) {
            t.check("MUTF-8 read: " + (c[0].isEmpty() ? "(empty)" : c[0]) + " is accepted like the JDK", () -> {
                eq(c[1], jdkRead(unhex(c[0])), "JDK");
                eq(c[1], readString(stringRoot(unhex(c[0]))), "ours");
            });
        }
        String[] refused = {"80", "8080", "bf", "ff", "f0", "f09f90b3", "c0", "e080", "e0", "c041", "e04180", "e08041"};
        for (String c : refused) {
            t.check("MUTF-8 read: " + c + " is bad_nbt (the JDK refuses it too)", () -> {
                eq(null, jdkRead(unhex(c)), "JDK");
                error(ShareException.BAD_NBT, () -> readString(stringRoot(unhex(c))));
            });
        }
        t.check("MUTF-8 read: length past the end of the file is bad_nbt", () ->
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(unhex("0a0000 08 0001 73 0005 6162"))));
        t.check("MUTF-8 read: 20000 random byte strings decode exactly like DataInputStream.readUTF", () -> {
            int[] alphabet = {0x00, 0x41, 0x7f, 0x80, 0xbf, 0xc0, 0xc1, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xff, 0xa0, 0xb3};
            Random random = new Random(20261106);
            for (int i = 0; i < 20000; i++) {
                byte[] body = new byte[random.nextInt(7)];
                for (int j = 0; j < body.length; j++) {
                    body[j] = (byte) alphabet[random.nextInt(alphabet.length)];
                }
                String jdk = jdkRead(body);
                String ours;
                try {
                    ours = readString(stringRoot(body));
                } catch (ShareException e) {
                    ours = null;
                }
                if (!java.util.Objects.equals(jdk, ours)) {
                    throw fail("bytes " + hex(body) + ": JDK " + jdk + ", ours " + ours);
                }
            }
        });
        t.check("MUTF-8 write: 65535 bytes is fine, 65536 is refused (bad_nbt) instead of MC's silent \"\"", () -> {
            CompoundTag ok = new CompoundTag();
            ok.put("s", StringTag.valueOf("a".repeat(65535)));
            eq("a".repeat(65535), readString(ShareNbt.writeRoot(ok)), "65535 reads back");
            CompoundTag big = new CompoundTag();
            big.put("s", StringTag.valueOf("\u0000".repeat(32768))); // 2 bytes each = 65536
            error(ShareException.BAD_NBT, () -> ShareNbt.writeRoot(big));
            CompoundTag bigKey = new CompoundTag();
            bigKey.put("\u4e2d".repeat(21846), StringTag.valueOf("")); // 3 bytes each = 65538
            error(ShareException.BAD_NBT, () -> ShareNbt.writeRoot(bigKey));
        });
    }

    // ---------------------------------------------------------------- all tag types

    @SuppressWarnings("removal") // FloatTag/DoubleTag constructors keep -0.0 and NaN payloads
    static CompoundTag allTypes() {
        CompoundTag t = new CompoundTag();
        t.put("byteMin", ByteTag.valueOf(Byte.MIN_VALUE));
        t.put("byteMax", ByteTag.valueOf(Byte.MAX_VALUE));
        t.put("shortMin", ShortTag.valueOf(Short.MIN_VALUE));
        t.put("shortMax", ShortTag.valueOf(Short.MAX_VALUE));
        t.put("intMin", IntTag.valueOf(Integer.MIN_VALUE));
        t.put("intMax", IntTag.valueOf(Integer.MAX_VALUE));
        t.put("longMin", LongTag.valueOf(Long.MIN_VALUE));
        t.put("longMax", LongTag.valueOf(Long.MAX_VALUE));
        int[] floatBits = {0x00000000, 0x80000000, 0x3f800000, 0x7f800000, 0xff800000, 0x7fc00000, 0x00000001, 0x7f7fffff};
        ListTag floats = new ListTag();
        for (int bits : floatBits) {
            floats.add(new FloatTag(Float.intBitsToFloat(bits)));
        }
        t.put("floats", floats);
        long[] doubleBits = {0L, 0x8000000000000000L, 0x3ff0000000000000L, 0x7ff0000000000000L,
            0xfff0000000000000L, 0x7ff8000000000000L, 1L, 0x7fefffffffffffffL};
        ListTag doubles = new ListTag();
        for (long bits : doubleBits) {
            doubles.add(new DoubleTag(Double.longBitsToDouble(bits)));
        }
        t.put("doubles", doubles);
        t.put("negZeroFloat", new FloatTag(-0.0f));
        t.put("negZeroDouble", new DoubleTag(-0.0));
        t.put("string", StringTag.valueOf("\u9cb8\u56fe \uD83D\uDC33 \"q\" \\ \u0000 end"));
        t.put("emptyString", StringTag.valueOf(""));
        t.put("bytes", new ByteArrayTag(new byte[] {-128, -1, 0, 1, 127}));
        t.put("emptyBytes", new ByteArrayTag(new byte[0]));
        t.put("ints", new IntArrayTag(new int[] {Integer.MIN_VALUE, -1, 0, Integer.MAX_VALUE}));
        t.put("longs", new LongArrayTag(new long[] {Long.MIN_VALUE, -1, 0, Long.MAX_VALUE}));
        t.put("emptyLongs", new LongArrayTag(new long[0]));
        ListTag nested = new ListTag();
        ListTag inner = new ListTag();
        inner.add(StringTag.valueOf("x"));
        nested.add(inner);
        nested.add(new ListTag());
        t.put("nestedLists", nested);
        CompoundTag child = new CompoundTag();
        child.put("\u952e", IntTag.valueOf(7)); // a non-ASCII key
        child.put("", ShortTag.valueOf((short) -2)); // an empty key next to others
        t.put("compound", child);
        t.put("emptyCompound", new CompoundTag());
        return t;
    }

    private static void types(TestKit t) {
        t.check("NBT: every tag type round-trips (min/max, -0.0, NaN, +-Inf, denormals, unicode)", () -> {
            CompoundTag tag = allTypes();
            CompoundTag back = ShareNbt.readRoot(ShareNbt.writeRoot(tag));
            sameJson(ShareDump.tagToJson(tag), ShareDump.tagToJson(back), "typed dump");
            eq("80000000", String.format("%08x", Float.floatToRawIntBits(((FloatTag) back.get("negZeroFloat")).value())), "-0.0f bits");
            eq("8000000000000000", String.format("%016x", Double.doubleToRawLongBits(((DoubleTag) back.get("negZeroDouble")).value())), "-0.0 bits");
        });
        t.check("NBT: our bytes are exactly what MC NbtIo.write writes (standard NaN only)", () -> {
            CompoundTag tag = allTypes();
            sameBytes(mcWrite(tag), ShareNbt.writeRoot(tag), "bytes");
        });
        t.check("NBT: NaN payloads keep their bits (MC's DataOutputStream would turn them into 7fc00000)", () -> {
            CompoundTag tag = nanPayloads();
            CompoundTag back = ShareNbt.readRoot(ShareNbt.writeRoot(tag));
            eq("7fc00001", String.format("%08x", Float.floatToRawIntBits(((FloatTag) back.get("f")).value())), "float");
            eq("7ff8000000000001", String.format("%016x", Double.doubleToRawLongBits(((DoubleTag) back.get("d")).value())), "double");
        });
        t.check("NBT: bytes after the root compound are ignored; the root may have a name", () -> {
            byte[] body = named(3, "v", TestKit.i32(5));
            eq(5, ((IntTag) ShareNbt.readRoot(cat(root(body), unhex("ffffff"))).get("v")).value(), "trailing bytes");
            byte[] namedRoot = cat(unhex("0a 0003"), "abc".getBytes(java.nio.charset.StandardCharsets.US_ASCII), body, unhex("00"));
            eq(5, ((IntTag) ShareNbt.readRoot(namedRoot).get("v")).value(), "named root");
        });
        t.check("NBT: a repeated key keeps the later value (FORMAT: untested, we follow MC)", () -> {
            byte[] nbt = root(named(3, "v", TestKit.i32(1)), named(3, "v", TestKit.i32(2)));
            eq(2, ((IntTag) ShareNbt.readRoot(nbt).get("v")).value(), "value");
        });
    }

    @SuppressWarnings("removal")
    private static CompoundTag nanPayloads() {
        CompoundTag tag = new CompoundTag();
        tag.put("f", new FloatTag(Float.intBitsToFloat(0x7fc00001)));
        tag.put("d", new DoubleTag(Double.longBitsToDouble(0x7ff8000000000001L)));
        return tag;
    }

    // ---------------------------------------------------------------- lists (FORMAT.md §2)

    private static void lists(TestKit t) {
        String[][] written = { // typed JSON of the list, expected list payload (element type, count, elements)
            {"[{\"int\":1},{\"int\":2}]", "03 00000002 00000001 00000002"},
            {"[]", "00 00000000"},
            {"[{\"int\":1},{\"string\":\"x\"}]", "0a 00000002 03 0000 00000001 00 08 0000 0001 78 00"},
            {"[{\"compound\":{\"a\":{\"int\":1}}}]", "0a 00000001 03 0001 61 00000001 00"},
            {"[{\"compound\":{}}]", "0a 00000001 00"},
            {"[{\"compound\":{\"\":{\"int\":5}}}]", "0a 00000001 0a 0000 03 0000 00000005 00 00"},
            {"[{\"int\":1},{\"compound\":{\"a\":{\"int\":1}}}]", "0a 00000002 03 0000 00000001 00 03 0001 61 00000001 00"},
            {"[{\"int\":1},{\"compound\":{\"\":{\"int\":2}}}]", "0a 00000002 03 0000 00000001 00 0a 0000 03 0000 00000002 00 00"},
            {"[{\"list\":[{\"int\":1}]},{\"list\":[]}]", "09 00000002 03 00000001 00000001 00 00000000"},
            {"[{\"int\":1},{\"list\":[{\"int\":2}]}]", "0a 00000002 03 0000 00000001 00 09 0000 03 00000001 00000002 00"},
        };
        for (String[] c : written) {
            t.check("list " + c[0] + " is written as " + c[1] + " and reads back the same", () -> {
                CompoundTag tag = new CompoundTag();
                tag.put("l", ShareDump.jsonToTag(ShareDump.parse("{\"list\":" + c[0] + "}"), "$"));
                byte[] nbt = ShareNbt.writeRoot(tag);
                sameBytes(root(named(9, "l", unhex(c[1]))), nbt, "bytes " + hex(nbt));
                sameBytes(mcWrite(tag), nbt, "same as MC NbtIo.write");
                sameJson(ShareDump.tagToJson(tag), ShareDump.tagToJson(ShareNbt.readRoot(nbt)), "read back");
            });
        }
        String[][] read = { // list payload in a file, typed JSON we must read
            {"0a 00000002 03 0000 00000001 00 03 0000 00000002 00", "[{\"int\":1},{\"int\":2}]"},
            {"0a 00000001 03 0000 00000001 03 0001 61 00000002 00", "[{\"compound\":{\"\":{\"int\":1},\"a\":{\"int\":2}}}]"},
            {"0d 00000000", "[]"},
            {"ff 00000000", "[]"},
            {"03 00000000", "[]"},
        };
        for (String[] c : read) {
            t.check("list payload " + c[0] + " reads as " + c[1], () -> {
                CompoundTag back = ShareNbt.readRoot(root(named(9, "l", unhex(c[0]))));
                sameJson(ShareDump.parse("{\"list\":" + c[1] + "}"), ShareDump.tagToJson(back.get("l")), "read");
            });
        }
        t.check("list: an empty list is written back with element type 0 whatever the file said", () ->
            eqHex("0a0000 09 0001 6c 00 00000000 00",
                ShareNbt.writeRoot(ShareNbt.readRoot(root(named(9, "l", unhex("0d 00000000"))))), "bytes"));
    }

    // ---------------------------------------------------------------- NBT errors

    private static void errors(TestKit t) {
        String[][] bad = {
            {"", "empty"}, {"00", "root is an end tag"}, {"08 0000 0001 61", "root is a string"},
            {"09 0000 00 00000000", "root is a list"}, {"0a 0000", "root compound without its end"},
            {"0a 00", "root name cut off"}, {"0a 0000 0d 0001 61 00", "unknown tag type 13"},
            {"0a 0000 ff 0001 61 00", "unknown tag type 255"},
            {"0a 0000 09 0001 6c 03 ffffffff 00", "negative list length"},
            {"0a 0000 09 0001 6c 03 7fffffff 00", "list length past the end of the file"},
            {"0a 0000 09 0001 6c 0a 7fffffff 00", "huge list of compounds"},
            {"0a 0000 09 0001 6c 00 00000002 00", "list of 2 elements with element type 0"},
            {"0a 0000 09 0001 6c 0d 00000001 00 00", "list with unknown element type 13"},
            {"0a 0000 07 0001 62 ffffffff 00", "negative byte array length"},
            {"0a 0000 07 0001 62 7fffffff 00", "byte array length past the end"},
            {"0a 0000 0b 0001 69 40000000 00", "int array of 2^30 (x4 overflows an int)"},
            {"0a 0000 0c 0001 6c 20000000 00", "long array of 2^29 (x8 overflows an int)"},
            {"0a 0000 0b 0001 69 80000000 00", "int array, negative length"},
            {"0a 0000 03 0001 76 0000", "int cut off"},
            {"0a 0000 08 0001 73 ffff 61", "string length past the end"},
        };
        for (String[] c : bad) {
            t.check("NBT error (bad_nbt): " + c[1], () ->
                error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(unhex(c[0]))));
        }
        t.check("NBT error: every cut-off prefix of a valid file is bad_nbt", () -> {
            byte[] full = ShareNbt.writeRoot(allTypes());
            for (int n = 0; n < full.length; n++) {
                int cut = n;
                error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(java.util.Arrays.copyOf(full, cut)), cut + " bytes");
            }
        });
    }

    // ---------------------------------------------------------------- depth (512, like MC)

    private static byte[] nestedCompounds(int levels) { // the root compound is level 1
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(unhex("0a0000"));
        for (int i = 1; i < levels; i++) {
            out.writeBytes(unhex("0a 0001 63"));
        }
        for (int i = 0; i < levels; i++) {
            out.writeBytes(unhex("00"));
        }
        return out.toByteArray();
    }

    private static byte[] nestedLists(int levels) { // root compound, then levels-1 lists
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(unhex("0a0000 09 0001 6c"));
        for (int i = 2; i < levels; i++) {
            out.writeBytes(unhex("09 00000001"));
        }
        out.writeBytes(unhex("03 00000000 00"));
        return out.toByteArray();
    }

    private static CompoundTag compoundChain(int levels) {
        CompoundTag root = new CompoundTag();
        CompoundTag at = root;
        for (int i = 1; i < levels; i++) {
            CompoundTag next = new CompoundTag();
            at.put("c", next);
            at = next;
        }
        return root;
    }

    private static ListTag listChain(int lists) {
        ListTag list = new ListTag();
        for (int i = 1; i < lists; i++) {
            ListTag outer = new ListTag();
            outer.add(list);
            list = outer;
        }
        return list;
    }

    /** root{l: [1, [chain]]}: the inner list is written inside a {"": …} wrapper, so 4 + n levels. */
    private static CompoundTag wrappedChain(int n) {
        ListTag inner = new ListTag();
        inner.add(compoundChain(n));
        ListTag mixed = new ListTag();
        mixed.add(IntTag.valueOf(1));
        mixed.add(inner);
        CompoundTag root = new CompoundTag();
        root.put("l", mixed);
        return root;
    }

    private static CompoundTag mcRead(byte[] nbt) throws IOException {
        return NbtIo.read(new DataInputStream(new ByteArrayInputStream(nbt)), NbtAccounter.unlimitedHeap());
    }

    private static void depth(TestKit t) {
        t.check("depth: 512 nested compounds read, 513 and 600 are bad_nbt", () -> {
            ShareNbt.readRoot(nestedCompounds(512));
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(nestedCompounds(513)), "513");
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(nestedCompounds(600)), "600");
        });
        t.check("depth: 512 levels of lists read, 513 and 600 are bad_nbt", () -> {
            ShareNbt.readRoot(nestedLists(512));
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(nestedLists(513)), "513");
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(nestedLists(600)), "600");
        });
        t.check("depth: MC's own reader (NbtIo.read + unlimitedHeap) draws the line at the same place", () -> {
            mcRead(nestedCompounds(512));
            mcRead(nestedLists(512));
            TestKit.thrown(NbtAccounterException.class, () -> mcRead(nestedCompounds(513)), "compounds 513");
            TestKit.thrown(NbtAccounterException.class, () -> mcRead(nestedLists(513)), "lists 513");
        });
        t.check("depth: 100000 levels are refused quickly, without a stack overflow", () -> {
            long start = System.nanoTime();
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(nestedCompounds(100_000)), "compounds");
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(nestedLists(100_000)), "lists");
            ok(System.nanoTime() - start < 2_000_000_000L, "took more than 2 s");
        });
        t.check("depth: the writer refuses what the reader would refuse (compounds 512 ok / 513)", () -> {
            sameBytes(nestedCompounds(512), ShareNbt.writeRoot(compoundChain(512)), "512 bytes");
            error(ShareException.BAD_NBT, () -> ShareNbt.writeRoot(compoundChain(513)), "513");
        });
        t.check("depth: the writer refuses what the reader would refuse (lists 512 ok / 513)", () -> {
            CompoundTag ok = new CompoundTag();
            ok.put("l", listChain(511));
            ShareNbt.readRoot(ShareNbt.writeRoot(ok));
            CompoundTag tooDeep = new CompoundTag();
            tooDeep.put("l", listChain(512));
            error(ShareException.BAD_NBT, () -> ShareNbt.writeRoot(tooDeep), "513");
        });
        t.check("depth: the {\"\": ...} wrapper in mixed lists counts as a level for writer and reader", () -> {
            ShareNbt.readRoot(ShareNbt.writeRoot(wrappedChain(508))); // 512 levels
            error(ShareException.BAD_NBT, () -> ShareNbt.writeRoot(wrappedChain(509)), "writer, 513");
            byte[] mcBytes = mcWrite(wrappedChain(509)); // MC writes it anyway
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(mcBytes), "our reader, 513");
            TestKit.thrown(NbtAccounterException.class, () -> mcRead(mcBytes), "MC reader, 513");
        });
    }
}
