package com.xiaojingyu.share;

import static com.xiaojingyu.share.TestKit.cat;
import static com.xiaojingyu.share.TestKit.eq;
import static com.xiaojingyu.share.TestKit.error;
import static com.xiaojingyu.share.TestKit.i32;
import static com.xiaojingyu.share.TestKit.ok;
import static com.xiaojingyu.share.TestKit.sameBytes;
import static com.xiaojingyu.share.TestKit.unhex;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.zip.GZIPOutputStream;
import net.minecraft.nbt.ByteTag;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.IntTag;
import net.minecraft.nbt.ListTag;

/**
 * The tag limit of FORMAT §2: at most {@link ShareNbt#MAX_TAGS} tags in one file. The root, every
 * compound member and every list element count 1 (a list wrapper {"": v} and its member count 2),
 * an array counts 1, end markers 0. Each tag is counted before it is read, so the one after the
 * limit is refused unread, even when it is broken (agreed with the web reader).
 */
final class ShareTagTests {
    private static final int N = ShareNbt.MAX_TAGS;

    private ShareTagTests() {
    }

    static void run(TestKit t) {
        reading(t);
        boundary(t);
        writing(t);
        bomb(t);
    }

    /** {@code head}, then {@code count} copies of {@code element}, then {@code tail}. */
    private static byte[] repeat(byte[] head, byte[] element, int count, byte[] tail) {
        byte[] out = Arrays.copyOf(head, head.length + element.length * count + tail.length);
        int p = head.length;
        for (int i = 0; i < count; i++, p += element.length) {
            System.arraycopy(element, 0, out, p, element.length);
        }
        System.arraycopy(tail, 0, out, p, tail.length);
        return out;
    }

    /** root { "l": [count × element], then the members in {@code tail} }: count + 2 tags + tail's. */
    private static byte[] list(int elementType, int count, byte[] element, byte[] tail) {
        byte[] head = cat(unhex("0a 0000 09 0001 6c"), new byte[] {(byte) elementType}, i32(count));
        return repeat(head, element, count, cat(tail, unhex("00")));
    }

    /** root { "l": [count × {}] }: count + 2 tags. */
    private static byte[] compounds(int count) {
        return list(10, count, unhex("00"), new byte[0]);
    }

    private static int listSize(byte[] nbt) throws ShareException {
        return ((ListTag) ShareNbt.readRoot(nbt).get("l")).size();
    }

    private static void reading(TestKit t) {
        t.check("tags: exactly 2^21 tags pass the NBT step (no Version, so bad_schematic after it)", () -> {
            byte[] nbt = compounds(N - 2);
            eq(N - 2, listSize(nbt), "elements read");
            error(ShareException.BAD_SCHEMATIC, () -> ShareFiles.readSchem(ShareNbt.gzip(nbt)));
        });
        t.check("tags: one more (2^21 + 1) is too_large, from NBT and from a .schem", () -> {
            byte[] nbt = compounds(N - 1);
            ShareException e = error(ShareException.TOO_LARGE, () -> ShareNbt.readRoot(nbt));
            ok(e.detail().contains("more than " + N + " tags"), "the tag limit fired: " + e.detail());
            error(ShareException.TOO_LARGE, () -> ShareFiles.readSchem(ShareNbt.gzip(nbt)));
        });
        t.check("tags: every list element counts 1 (byte list: 2^21 ok, 2^21 + 1 too_large)", () -> {
            eq(N - 2, listSize(list(1, N - 2, unhex("05"), new byte[0])), "bytes");
            error(ShareException.TOO_LARGE, () -> ShareNbt.readRoot(list(1, N - 1, unhex("05"), new byte[0])));
        });
        t.check("tags: a {\"\": v} wrapper in a list counts 2, counted before unwrapping", () -> {
            int count = (N - 2) / 2;                 // root + l + 2 per element = N
            byte[] wrapped = unhex("01 0000 05 00"); // {"": byte 5}
            ListTag l = (ListTag) ShareNbt.readRoot(list(10, count, wrapped, new byte[0])).get("l");
            eq(count, l.size(), "elements");
            ok(l.get(0) instanceof ByteTag, "read as bytes: " + l.get(0));
            error(ShareException.TOO_LARGE,
                () -> ShareNbt.readRoot(list(10, count, wrapped, unhex("01 0001 62 07"))), "one member more");
        });
        t.check("tags: a repeated key counts every time it appears", () -> {
            byte[] member = unhex("01 0001 61 05"); // "a": byte 5
            eq(1, ShareNbt.readRoot(repeat(unhex("0a 0000"), member, N - 1, unhex("00"))).size(), "keys left");
            error(ShareException.TOO_LARGE, () -> ShareNbt.readRoot(repeat(unhex("0a 0000"), member, N, unhex("00"))));
        });
        t.check("tags: an array counts 1 however long it is", () -> {
            byte[] array = cat(unhex("07 0001 62"), i32(10_000_000), new byte[10_000_000]); // "b": 10 million bytes
            eq(N - 3, listSize(list(1, N - 3, unhex("05"), array)), "list next to the array");
            error(ShareException.TOO_LARGE, () -> ShareNbt.readRoot(list(1, N - 2, unhex("05"), array)));
        });
    }

    private static void boundary(TestKit t) {
        // root { "l": [(N - 2) × {}] } is exactly N tags; drop the root's end marker and append one more member.
        byte[] full = compounds(N - 2);
        byte[] open = Arrays.copyOf(full, full.length - 1);
        t.check("tags: the tag after the limit is refused before its name is read (name cut off: too_large)", () ->
            error(ShareException.TOO_LARGE, () -> ShareNbt.readRoot(cat(open, unhex("01 00")))));
        t.check("tags: ... and before its type is checked (unknown type 13: too_large)", () ->
            error(ShareException.TOO_LARGE, () -> ShareNbt.readRoot(cat(open, unhex("0d 0000 00")))));
        t.check("tags: the same broken member inside the limit is bad_nbt", () -> {
            byte[] fewer = compounds(N - 3);
            byte[] fewerOpen = Arrays.copyOf(fewer, fewer.length - 1);
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(cat(fewerOpen, unhex("01 00"))), "name cut off");
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(cat(fewerOpen, unhex("0d 0000 00"))), "type 13");
        });
        t.check("tags: a list header that promises more than the bytes left is bad_nbt before any counting", () -> {
            byte[] head = cat(unhex("0a 0000 09 0001 6c 03"), i32(N)); // N ints, but only 4 bytes follow
            error(ShareException.BAD_NBT, () -> ShareNbt.readRoot(cat(head, unhex("00000005 00"))));
        });
    }

    private static void writing(TestKit t) {
        t.check("tags: the writer counts like the reader (2^21 written, the same bytes; one more too_large)", () -> {
            CompoundTag root = new CompoundTag();
            ListTag l = new ListTag();
            for (int i = 0; i < N - 2; i++) {
                l.add(ByteTag.valueOf((byte) 5));
            }
            root.put("l", l);
            sameBytes(list(1, N - 2, unhex("05"), new byte[0]), ShareNbt.writeRoot(root), "bytes");
            l.add(ByteTag.valueOf((byte) 5));
            ShareException e = error(ShareException.TOO_LARGE, () -> ShareNbt.writeRoot(root));
            ok(e.detail().contains("tags"), "the tag limit fired: " + e.detail());
        });
        t.check("tags: the writer counts {\"\": v} wrappers as 2, like the reader will", () -> {
            // [int, byte, byte, ...] is mixed, so MC writes it as compounds {"": v}: 2 tags per element.
            int count = (N - 2) / 2;
            CompoundTag root = new CompoundTag();
            ListTag l = new ListTag();
            l.add(IntTag.valueOf(1));
            for (int i = 1; i < count; i++) {
                l.add(ByteTag.valueOf((byte) 5));
            }
            root.put("l", l);
            byte[] nbt = ShareNbt.writeRoot(root); // root + l + 2 × count = N
            eq(count, listSize(nbt), "read back");
            root.putByte("b", (byte) 7);
            error(ShareException.TOO_LARGE, () -> ShareNbt.writeRoot(root), "one member more");
        });
        t.check("tags: writeSchem refuses a model whose block entity holds too many tags", () -> {
            ShareModel m = new ShareModel(1, 1, 1);
            m.set(0, 0, 0, "minecraft:chest[facing=north,type=single,waterlogged=false]");
            CompoundTag data = new CompoundTag();
            ListTag items = new ListTag();
            for (int i = 0; i < N; i++) {
                items.add(ByteTag.valueOf((byte) 1));
            }
            data.put("Items", items);
            m.putBlockEntity(0, 0, 0, "minecraft:chest", data);
            error(ShareException.TOO_LARGE, () -> ShareFiles.writeSchem(m));
            error(ShareException.TOO_LARGE, () -> ShareFiles.writePng(m));
        });
    }

    private static void bomb(TestKit t) {
        t.check("tags: 60 million empty compounds (58 KB gzip) are too_large at once, no OutOfMemoryError", () -> {
            ByteArrayOutputStream gz = new ByteArrayOutputStream();
            try (GZIPOutputStream out = new GZIPOutputStream(gz)) {
                out.write(cat(unhex("0a 0000 09 0001 6c 0a"), i32(60_000_000)));
                byte[] zeros = new byte[1 << 20];
                for (int left = 60_000_000; left > 0; left -= zeros.length) {
                    out.write(zeros, 0, Math.min(left, zeros.length));
                }
                out.write(0);
            }
            byte[] schem = gz.toByteArray();
            long start = System.nanoTime();
            ShareException e = error(ShareException.TOO_LARGE, () -> ShareFiles.readSchem(schem));
            long ms = (System.nanoTime() - start) / 1_000_000;
            ok(e.detail().contains("tags"), "the tag limit fired: " + e.detail());
            ok(ms < 3000, "took " + ms + " ms");
            error(ShareException.TOO_LARGE, () -> ShareFiles.read(SharePng.withData(SharePng.placeholder(), schem)), "as PNG");
            t.note("many-tags bomb: " + schem.length + " bytes gzip, refused after " + ms + " ms");
        });
    }
}
