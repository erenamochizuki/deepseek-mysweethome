package com.xiaojingyu.share;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataOutput;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UTFDataFormatException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
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

/**
 * gzip and NBT for share files (docs/FORMAT.md §2).
 *
 * <p>Reading uses this class's own parser instead of {@code NbtIo.read}, because NbtIo reports
 * bad data through CrashReport (needs the game loaded), turns -0.0 into +0.0 and allocates
 * arrays and lists by their declared length before checking it (see mod/README.md
 * 「分享格式（鲸图）」). It builds MC's own tag objects and counts depth with MC's
 * {@link NbtAccounter}. Writing uses MC's own {@code Tag.write} (so lists are wrapped exactly
 * like MC does) through a {@link DataOutput} that keeps float bits and refuses too long strings.
 */
final class ShareNbt {
    /** Most bytes allowed after gunzip (64 MiB). */
    static final int MAX_UNZIPPED = 64 * 1024 * 1024;
    /** Deepest nesting of compounds and lists, the root compound counting as 1; same as MC. */
    static final int MAX_DEPTH = 512;
    /**
     * Most tags in one file (2^21, FORMAT §2): the root, every compound member and every list
     * element count 1 each, arrays count 1 whatever their length, end markers do not count. An
     * empty compound is 1 byte in the file but tens of bytes in memory, so without this a 58 KB
     * file can need gigabytes.
     */
    static final int MAX_TAGS = 2_097_152;

    private static final int TAG_COMPOUND = 10;
    /** Fewest bytes one list element of each type takes, to check list lengths before reading. */
    private static final int[] MIN_SIZE = {0, 1, 2, 4, 8, 4, 8, 4, 2, 5, 1, 4, 4};

    private ShareNbt() {
    }

    // ---------------------------------------------------------------- gzip

    /** gzip with the JDK defaults: level 6, mtime 0, no file name. */
    static byte[] gzip(byte[] data) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(256, data.length / 8));
        try (GZIPOutputStream gz = new GZIPOutputStream(out, 65536)) {
            gz.write(data);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }

    /** Whole gunzip; stops as soon as the output passes {@link #MAX_UNZIPPED}. */
    static byte[] gunzip(byte[] gz) throws ShareException {
        byte[] buf = new byte[(int) Math.min(MAX_UNZIPPED + 1L, Math.max(8192L, gz.length * 8L))];
        int n = 0;
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(gz), 65536)) {
            while (true) {
                if (n == buf.length) {
                    buf = Arrays.copyOf(buf, (int) Math.min(MAX_UNZIPPED + 1L, buf.length * 2L));
                }
                int r = in.read(buf, n, buf.length - n);
                if (r < 0) {
                    break;
                }
                n += r;
                if (n > MAX_UNZIPPED) {
                    throw ShareException.of(ShareException.TOO_LARGE,
                        "more than " + MAX_UNZIPPED + " bytes after gunzip");
                }
            }
        } catch (IOException e) {
            // ZipException (not gzip, corrupt data, bad CRC or size), EOFException (cut off), ...
            throw ShareException.of(ShareException.BAD_GZIP, "gunzip failed: " + e, e);
        }
        return n == buf.length ? buf : Arrays.copyOf(buf, n);
    }

    // ---------------------------------------------------------------- read

    /** Reads the root compound (any name); bytes after it are ignored. Every problem is {@code bad_nbt}. */
    static CompoundTag readRoot(byte[] nbt) throws ShareException {
        Reader reader = new Reader(nbt);
        try {
            int type = reader.u8();
            if (type != TAG_COMPOUND) {
                throw reader.bad("root tag has type " + type + ", must be a compound (10)");
            }
            reader.countTag();
            reader.string();
            return reader.compound();
        } catch (NbtAccounterException e) {
            throw ShareException.of(ShareException.BAD_NBT, "nesting deeper than " + MAX_DEPTH, e);
        }
    }

    private static final class Reader {
        private final byte[] b;
        private final NbtAccounter depth = NbtAccounter.unlimitedHeap();
        private int p;
        private int tags;

        Reader(byte[] b) {
            this.b = b;
        }

        ShareException bad(String what) {
            return ShareException.of(ShareException.BAD_NBT, what + " (at byte " + p + ")");
        }

        /** Called before reading each tag; the one after {@link #MAX_TAGS} is refused unread. */
        void countTag() throws ShareException {
            if (++tags > MAX_TAGS) {
                throw ShareException.of(ShareException.TOO_LARGE,
                    "more than " + MAX_TAGS + " tags (at byte " + p + ")");
            }
        }

        private void need(long count) throws ShareException {
            if (count > b.length - p) {
                throw bad("data cut off: need " + count + " more bytes, " + (b.length - p) + " left");
            }
        }

        int u8() throws ShareException {
            need(1);
            return b[p++] & 0xFF;
        }

        private int u16() throws ShareException {
            need(2);
            int v = ((b[p] & 0xFF) << 8) | (b[p + 1] & 0xFF);
            p += 2;
            return v;
        }

        private int i32() throws ShareException {
            need(4);
            int v = ((b[p] & 0xFF) << 24) | ((b[p + 1] & 0xFF) << 16) | ((b[p + 2] & 0xFF) << 8) | (b[p + 3] & 0xFF);
            p += 4;
            return v;
        }

        private long i64() throws ShareException {
            need(8);
            long hi = i32();
            return (hi << 32) | (i32() & 0xFFFFFFFFL);
        }

        CompoundTag compound() throws ShareException {
            depth.pushDepth();
            CompoundTag tag = new CompoundTag();
            while (true) {
                int type = u8();
                if (type == 0) {
                    break;
                }
                countTag(); // before the name and the type check, same place as the web reader
                String name = string();
                tag.put(name, payload(type));
            }
            depth.popDepth();
            return tag;
        }

        @SuppressWarnings("removal") // FloatTag.valueOf / DoubleTag.valueOf would turn -0.0 into +0.0
        private Tag payload(int type) throws ShareException {
            return switch (type) {
                case 1 -> ByteTag.valueOf((byte) u8());
                case 2 -> ShortTag.valueOf((short) u16());
                case 3 -> IntTag.valueOf(i32());
                case 4 -> LongTag.valueOf(i64());
                case 5 -> new FloatTag(Float.intBitsToFloat(i32()));
                case 6 -> new DoubleTag(Double.longBitsToDouble(i64()));
                case 7 -> new ByteArrayTag(bytes(arrayLength(1)));
                case 8 -> StringTag.valueOf(string());
                case 9 -> list();
                case 10 -> compound();
                case 11 -> new IntArrayTag(ints(arrayLength(4)));
                case 12 -> new LongArrayTag(longs(arrayLength(8)));
                default -> throw bad("unknown tag type " + type);
            };
        }

        private ListTag list() throws ShareException {
            depth.pushDepth();
            int type = u8();
            int count = i32();
            if (count < 0) {
                throw bad("negative list length " + count);
            }
            ListTag list = new ListTag();
            if (count > 0) {
                // MC: an empty list may name any element type, a non-empty one must name a real one.
                if (type == 0 || type >= MIN_SIZE.length) {
                    throw bad("list of " + count + " elements with element type " + type);
                }
                need((long) count * MIN_SIZE[type]);
                for (int i = 0; i < count; i++) {
                    countTag();
                    list.addAndUnwrap(payload(type));
                }
            }
            depth.popDepth();
            return list;
        }

        private int arrayLength(int elementSize) throws ShareException {
            int n = i32();
            if (n < 0) {
                throw bad("negative array length " + n);
            }
            need((long) n * elementSize);
            return n;
        }

        private byte[] bytes(int n) {
            byte[] a = Arrays.copyOfRange(b, p, p + n);
            p += n;
            return a;
        }

        private int[] ints(int n) {
            int[] a = new int[n];
            ByteBuffer.wrap(b, p, n * 4).asIntBuffer().get(a);
            p += n * 4;
            return a;
        }

        private long[] longs(int n) {
            long[] a = new long[n];
            ByteBuffer.wrap(b, p, n * 8).asLongBuffer().get(a);
            p += n * 8;
            return a;
        }

        /** Modified UTF-8, exactly as lenient and as strict as {@code DataInputStream.readUTF}. */
        String string() throws ShareException {
            int n = u16();
            need(n);
            int start = p;
            int end = p + n;
            int i = start;
            while (i < end && b[i] >= 0) {
                i++;
            }
            if (i == end) {
                p = end;
                return new String(b, start, n, StandardCharsets.ISO_8859_1);
            }
            char[] chars = new char[n];
            int count = 0;
            for (int j = start; j < i; j++) {
                chars[count++] = (char) b[j];
            }
            while (i < end) {
                int c = b[i] & 0xFF;
                switch (c >> 4) {
                    case 0, 1, 2, 3, 4, 5, 6, 7 -> {
                        chars[count++] = (char) c;
                        i += 1;
                    }
                    case 12, 13 -> {
                        if (i + 2 > end) {
                            throw badString(i, "partial character at end");
                        }
                        int c2 = b[i + 1];
                        if ((c2 & 0xC0) != 0x80) {
                            throw badString(i, "bad continuation byte");
                        }
                        chars[count++] = (char) (((c & 0x1F) << 6) | (c2 & 0x3F));
                        i += 2;
                    }
                    case 14 -> {
                        if (i + 3 > end) {
                            throw badString(i, "partial character at end");
                        }
                        int c2 = b[i + 1];
                        int c3 = b[i + 2];
                        if ((c2 & 0xC0) != 0x80 || (c3 & 0xC0) != 0x80) {
                            throw badString(i, "bad continuation byte");
                        }
                        chars[count++] = (char) (((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F));
                        i += 3;
                    }
                    default -> throw badString(i, "bad lead byte 0x" + Integer.toHexString(c));
                }
            }
            p = end;
            return new String(chars, 0, count);
        }

        private ShareException badString(int at, String what) {
            return ShareException.of(ShareException.BAD_NBT, "malformed string: " + what + " (at byte " + at + ")");
        }
    }

    // ---------------------------------------------------------------- write

    /**
     * The root compound as uncompressed NBT, named "". {@code bad_nbt} if nesting is deeper than
     * {@link #MAX_DEPTH} or a string is longer than 65535 bytes in modified UTF-8; {@code too_large}
     * if there are more than {@link #MAX_TAGS} tags. Depth and tags are counted exactly as the
     * reader will count them in the written file (list wrappers included), in the same order.
     */
    static byte[] writeRoot(CompoundTag root) throws ShareException {
        new TreeCheck().compound(root, 1);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(4096);
        try {
            NbtIo.writeUnnamedTag(root, new RawOut(new DataOutputStream(bytes)));
        } catch (UTFDataFormatException e) {
            throw ShareException.of(ShareException.BAD_NBT, "string too long for NBT: " + e.getMessage(), e);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return bytes.toByteArray();
    }

    /** Walks a tree the way the reader will walk the written file: counts tags, checks depth. */
    private static final class TreeCheck {
        private int tags = 1; // the root

        private void count() throws ShareException {
            if (++tags > MAX_TAGS) {
                throw ShareException.of(ShareException.TOO_LARGE, "more than " + MAX_TAGS + " tags to write");
            }
        }

        private static void depth(int level) throws ShareException {
            if (level > MAX_DEPTH) {
                throw ShareException.of(ShareException.BAD_NBT, "nesting deeper than " + MAX_DEPTH);
            }
        }

        /** A compound at nesting {@code level}, entered the way the reader enters it. */
        void compound(CompoundTag compound, int level) throws ShareException {
            depth(level);
            for (Map.Entry<String, Tag> entry : compound.entrySet()) {
                count();
                value(entry.getValue(), level);
            }
        }

        /** The payload of a member or list element whose container sits at {@code level}. */
        private void value(Tag value, int level) throws ShareException {
            if (value instanceof CompoundTag compound) {
                compound(compound, level + 1);
            } else if (value instanceof ListTag list) {
                list(list, level + 1);
            }
        }

        private void list(ListTag list, int level) throws ShareException {
            depth(level);
            int elementType = rawElementType(list);
            for (Tag value : list) {
                count();
                // ListTag.write puts non-compounds and {"": x} compounds of a type-10 list into {"": ...}:
                // the wrapper is one more compound level and its "" member one more tag.
                boolean wrapped = elementType == TAG_COMPOUND
                    && (!(value instanceof CompoundTag compound) || isWrapper(compound));
                if (wrapped) {
                    depth(level + 1);
                    count();
                    value(value, level + 1);
                } else {
                    value(value, level);
                }
            }
        }
    }

    /** The element type ListTag.write will use: the common type, 10 for mixed lists, 0 for empty ones. */
    static int rawElementType(ListTag list) {
        if (list.isEmpty()) {
            return 0;
        }
        byte first = list.get(0).getId();
        for (Tag value : list) {
            if (value.getId() != first) {
                return TAG_COMPOUND;
            }
        }
        return first;
    }

    static boolean isWrapper(CompoundTag compound) {
        return compound.size() == 1 && compound.contains("");
    }

    /** DataOutput that writes float and double bits as they are (DataOutputStream turns every NaN into one). */
    private static final class RawOut implements DataOutput {
        private final DataOutputStream out;

        RawOut(DataOutputStream out) {
            this.out = out;
        }

        @Override
        public void write(int v) throws IOException {
            out.write(v);
        }

        @Override
        public void write(byte[] v) throws IOException {
            out.write(v);
        }

        @Override
        public void write(byte[] v, int off, int len) throws IOException {
            out.write(v, off, len);
        }

        @Override
        public void writeBoolean(boolean v) throws IOException {
            out.writeBoolean(v);
        }

        @Override
        public void writeByte(int v) throws IOException {
            out.writeByte(v);
        }

        @Override
        public void writeShort(int v) throws IOException {
            out.writeShort(v);
        }

        @Override
        public void writeChar(int v) throws IOException {
            out.writeChar(v);
        }

        @Override
        public void writeInt(int v) throws IOException {
            out.writeInt(v);
        }

        @Override
        public void writeLong(long v) throws IOException {
            out.writeLong(v);
        }

        @Override
        public void writeFloat(float v) throws IOException {
            out.writeInt(Float.floatToRawIntBits(v));
        }

        @Override
        public void writeDouble(double v) throws IOException {
            out.writeLong(Double.doubleToRawLongBits(v));
        }

        @Override
        public void writeBytes(String s) throws IOException {
            out.writeBytes(s);
        }

        @Override
        public void writeChars(String s) throws IOException {
            out.writeChars(s);
        }

        @Override
        public void writeUTF(String s) throws IOException {
            out.writeUTF(s); // throws UTFDataFormatException past 65535 bytes, before writing anything
        }
    }
}
