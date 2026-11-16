package com.xiaojingyu.share;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.Adler32;
import java.util.zip.CRC32;

/**
 * The PNG side of a 鲸图 (docs/FORMAT.md §1): the whole .schem goes into one private chunk
 * {@code xjSc} right before IEND. Works on bytes only (no ImageIO).
 */
public final class SharePng {
    /** Chunk type that carries the .schem bytes. */
    public static final String CHUNK_TYPE = "xjSc";
    /** Largest allowed xjSc chunk (16 MiB). */
    public static final int MAX_CHUNK = 16 * 1024 * 1024;
    /** Color of the placeholder picture, 0xRRGGBB. */
    public static final int PLACEHOLDER_RGB = 0x2F7FBF;

    private static final byte[] SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
    private static final int XJSC = type("xjSc");
    private static final int IHDR = type("IHDR");
    private static final int IDAT = type("IDAT");
    private static final int IEND = type("IEND");

    private SharePng() {
    }

    /** Whether the bytes start with the 8-byte PNG signature. */
    public static boolean isPng(byte[] file) {
        return file.length >= SIGNATURE.length && Arrays.equals(file, 0, SIGNATURE.length, SIGNATURE, 0, SIGNATURE.length);
    }

    /** The .schem bytes inside a PNG. Errors: bad_png, too_large, bad_crc, no_data, multiple_data. */
    public static byte[] extract(byte[] png) throws ShareException {
        Chunk found = null;
        int count = 0;
        for (Chunk chunk : chunks(png, true)) {
            if (chunk.type == XJSC) {
                found = chunk;
                count++;
            }
        }
        if (count == 0) {
            throw ShareException.of(ShareException.NO_DATA, "no " + CHUNK_TYPE + " chunk");
        }
        if (count > 1) {
            throw ShareException.of(ShareException.MULTIPLE_DATA, count + " " + CHUNK_TYPE + " chunks");
        }
        return Arrays.copyOfRange(png, found.dataStart, found.dataStart + found.length);
    }

    /**
     * A copy of the picture with {@code schem} as its only xjSc chunk, right before IEND (old xjSc
     * chunks and bytes after IEND are dropped).
     */
    public static byte[] withData(byte[] png, byte[] schem) throws ShareException {
        if (schem.length > MAX_CHUNK) {
            throw ShareException.of(ShareException.TOO_LARGE, "share data is " + schem.length + " bytes, more than 16 MiB");
        }
        return rebuild(png, schem);
    }

    /** A copy of the picture without xjSc chunks (and without bytes after IEND). */
    public static byte[] strip(byte[] png) throws ShareException {
        return rebuild(png, null);
    }

    /** The placeholder picture: 16×16, one color. Always the same bytes. */
    public static byte[] placeholder() {
        return solidImage(16, 16, PLACEHOLDER_RGB);
    }

    /** A PNG of one color (8-bit RGB, no compression in IDAT, so the bytes depend on nothing but the arguments). */
    public static byte[] solidImage(int width, int height, int rgb) {
        if (width < 1 || height < 1 || (long) width * height > 4096L * 4096L) {
            throw new IllegalArgumentException("bad image size " + width + "x" + height);
        }
        int rowBytes = 1 + width * 3;
        byte[] raw = new byte[rowBytes * height];
        for (int y = 0; y < height; y++) {
            int p = y * rowBytes;
            raw[p++] = 0; // filter: none
            for (int x = 0; x < width; x++) {
                raw[p++] = (byte) (rgb >> 16);
                raw[p++] = (byte) (rgb >> 8);
                raw[p++] = (byte) rgb;
            }
        }
        // zlib stream made of stored (uncompressed) deflate blocks
        ByteArrayOutputStream zlib = new ByteArrayOutputStream(raw.length + raw.length / 65535 * 5 + 16);
        zlib.write(0x78);
        zlib.write(0x01);
        int at = 0;
        do {
            int len = Math.min(65535, raw.length - at);
            boolean last = at + len == raw.length;
            zlib.write(last ? 1 : 0);
            zlib.write(len & 0xFF);
            zlib.write(len >>> 8);
            zlib.write(~len & 0xFF);
            zlib.write((~len >>> 8) & 0xFF);
            zlib.write(raw, at, len);
            at += len;
        } while (at < raw.length);
        Adler32 adler = new Adler32();
        adler.update(raw);
        writeInt(zlib, (int) adler.getValue());

        byte[] ihdr = new byte[13];
        putInt(ihdr, 0, width);
        putInt(ihdr, 4, height);
        ihdr[8] = 8; // bit depth
        ihdr[9] = 2; // color type: RGB
        // compression, filter, interlace: 0

        ByteArrayOutputStream out = new ByteArrayOutputStream(zlib.size() + 64);
        out.write(SIGNATURE, 0, SIGNATURE.length);
        writeChunk(out, IHDR, ihdr, 0, ihdr.length);
        byte[] idat = zlib.toByteArray();
        writeChunk(out, IDAT, idat, 0, idat.length);
        writeChunk(out, IEND, new byte[0], 0, 0);
        return out.toByteArray();
    }

    /** CRC-32 as PNG uses it (over chunk type and data). */
    static int crc32(int chunkType, byte[] data, int off, int len) {
        CRC32 crc = new CRC32();
        byte[] type = new byte[4];
        putInt(type, 0, chunkType);
        crc.update(type);
        crc.update(data, off, len);
        return (int) crc.getValue();
    }

    // ---------------------------------------------------------------- internals

    /** One chunk: {@code start} is where its length field is; it ends at dataStart + length + 4. */
    private record Chunk(int start, int type, int dataStart, int length) {
    }

    /**
     * Walks the chunks from byte 8 to IEND (FORMAT.md §1). With {@code checkData}, xjSc chunks are
     * checked on the spot: declared length over 16 MiB → too_large, cut off → bad_png, CRC → bad_crc.
     */
    private static List<Chunk> chunks(byte[] png, boolean checkData) throws ShareException {
        if (!isPng(png)) {
            throw ShareException.of(ShareException.UNKNOWN_FILE, "no PNG signature");
        }
        List<Chunk> list = new ArrayList<>();
        int p = SIGNATURE.length;
        while (true) {
            if (png.length - p < 8) {
                throw ShareException.of(ShareException.BAD_PNG,
                    p == png.length ? "file ends before IEND" : "chunk header cut off at byte " + p);
            }
            long length = getInt(png, p) & 0xFFFFFFFFL;
            int type = getInt(png, p + 4);
            if (checkData && type == XJSC && length > MAX_CHUNK) {
                throw ShareException.of(ShareException.TOO_LARGE, CHUNK_TYPE + " chunk declares " + length + " bytes");
            }
            if (length + 4 > png.length - p - 8L) {
                throw ShareException.of(ShareException.BAD_PNG,
                    "chunk at byte " + p + " declares " + length + " bytes, past the end of the file");
            }
            Chunk chunk = new Chunk(p, type, p + 8, (int) length);
            if (checkData && type == XJSC) {
                int stored = getInt(png, chunk.dataStart + chunk.length);
                if (stored != crc32(XJSC, png, chunk.dataStart, chunk.length)) {
                    throw ShareException.of(ShareException.BAD_CRC, CHUNK_TYPE + " chunk at byte " + p + " has a wrong CRC");
                }
            }
            list.add(chunk);
            p = chunk.dataStart + chunk.length + 4;
            if (type == IEND) {
                return list;
            }
        }
    }

    private static byte[] rebuild(byte[] png, byte[] schem) throws ShareException {
        List<Chunk> list = chunks(png, false);
        ByteArrayOutputStream out = new ByteArrayOutputStream(png.length + (schem == null ? 0 : schem.length + 12));
        out.write(png, 0, SIGNATURE.length);
        for (Chunk chunk : list) {
            if (chunk.type == XJSC) {
                continue;
            }
            if (chunk.type == IEND && schem != null) {
                writeChunk(out, XJSC, schem, 0, schem.length);
            }
            out.write(png, chunk.start, chunk.length + 12);
        }
        return out.toByteArray();
    }

    private static void writeChunk(ByteArrayOutputStream out, int type, byte[] data, int off, int len) {
        writeInt(out, len);
        writeInt(out, type);
        out.write(data, off, len);
        writeInt(out, crc32(type, data, off, len));
    }

    /** A chunk type name as the 4-byte number in the file. */
    static int type(String name) {
        byte[] b = name.getBytes(StandardCharsets.US_ASCII);
        return getInt(b, 0);
    }

    private static int getInt(byte[] b, int p) {
        return ((b[p] & 0xFF) << 24) | ((b[p + 1] & 0xFF) << 16) | ((b[p + 2] & 0xFF) << 8) | (b[p + 3] & 0xFF);
    }

    private static void putInt(byte[] b, int p, int v) {
        b[p] = (byte) (v >>> 24);
        b[p + 1] = (byte) (v >>> 16);
        b[p + 2] = (byte) (v >>> 8);
        b[p + 3] = (byte) v;
    }

    private static void writeInt(ByteArrayOutputStream out, int v) {
        out.write(v >>> 24);
        out.write(v >>> 16);
        out.write(v >>> 8);
        out.write(v);
    }
}
