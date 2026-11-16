package com.xiaojingyu.share;

import static com.xiaojingyu.share.TestKit.cat;
import static com.xiaojingyu.share.TestKit.eq;
import static com.xiaojingyu.share.TestKit.eqHex;
import static com.xiaojingyu.share.TestKit.error;
import static com.xiaojingyu.share.TestKit.fail;
import static com.xiaojingyu.share.TestKit.hex;
import static com.xiaojingyu.share.TestKit.i32;
import static com.xiaojingyu.share.TestKit.ok;
import static com.xiaojingyu.share.TestKit.sameBytes;
import static com.xiaojingyu.share.TestKit.sameJson;
import static com.xiaojingyu.share.TestKit.unhex;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.GZIPOutputStream;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;

/** Unit tests: gzip limits, CRC32, the xjSc chunk, file sniffing (docs/FORMAT.md §1, §2). */
final class SharePngTests {
    private SharePngTests() {
    }

    static void run(TestKit t) {
        gzip(t);
        crc(t);
        placeholder(t);
        chunk(t);
        sniff(t);
    }

    // ---------------------------------------------------------------- gzip

    /** gzip of n zero bytes, made in pieces so the zeros are never all in memory. */
    private static byte[] gzipZeros(long n) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(out, 1 << 16) {
            {
                def.setLevel(Deflater.BEST_SPEED);
            }
        }) {
            byte[] zeros = new byte[1 << 20];
            for (long left = n; left > 0; left -= zeros.length) {
                gz.write(zeros, 0, (int) Math.min(left, zeros.length));
            }
        }
        return out.toByteArray();
    }

    private static void gzip(TestKit t) {
        t.check("gzip header: 1f 8b, deflate, no flags (no file name), mtime 0", () -> {
            byte[] gz = ShareNbt.gzip("hello".getBytes(StandardCharsets.US_ASCII));
            eqHex("1f8b0800 00000000", Arrays.copyOf(gz, 8), "first 8 bytes");
            t.note("XFL/OS bytes from this JDK: " + hex(Arrays.copyOfRange(gz, 8, 10)) + " (FORMAT does not fix them)");
        });
        t.check("gzip: round trip (random 100 KB, empty)", () -> {
            byte[] data = new byte[100_000];
            new Random(1).nextBytes(data);
            sameBytes(data, ShareNbt.gunzip(ShareNbt.gzip(data)), "random");
            eq(0, ShareNbt.gunzip(ShareNbt.gzip(new byte[0])).length, "empty");
        });
        t.check("gzip: broken streams are bad_gzip (cut, bad CRC, bad length, bad method, garbage)", () -> {
            byte[] gz = ShareNbt.gzip("hello hello hello".getBytes(StandardCharsets.US_ASCII));
            for (int cut : new int[] {2, 4, 10, 12, gz.length - 8, gz.length - 4, gz.length - 1}) {
                error(ShareException.BAD_GZIP, () -> ShareNbt.gunzip(Arrays.copyOf(gz, cut)), "cut to " + cut);
            }
            byte[] badCrc = gz.clone();
            badCrc[gz.length - 8] ^= 1;
            error(ShareException.BAD_GZIP, () -> ShareNbt.gunzip(badCrc), "CRC");
            byte[] badSize = gz.clone();
            badSize[gz.length - 4] ^= 1;
            error(ShareException.BAD_GZIP, () -> ShareNbt.gunzip(badSize), "ISIZE");
            byte[] badMethod = gz.clone();
            badMethod[2] = 7;
            error(ShareException.BAD_GZIP, () -> ShareNbt.gunzip(badMethod), "method");
            error(ShareException.BAD_GZIP, () -> ShareNbt.gunzip(unhex("1f8b 0800 00000000 00ff ffffffff")), "garbage");
            error(ShareException.BAD_GZIP, () -> ShareNbt.gunzip(new byte[0]), "empty");
        });
        t.check("gzip: exactly 64 MiB after gunzip is allowed (then bad_nbt), one byte more is too_large", () -> {
            byte[] exact = gzipZeros(ShareNbt.MAX_UNZIPPED);
            eq(ShareNbt.MAX_UNZIPPED, ShareNbt.gunzip(exact).length, "64 MiB");
            error(ShareException.BAD_NBT, () -> ShareFiles.readSchem(exact), "64 MiB of zeros as a file");
            byte[] over = gzipZeros(ShareNbt.MAX_UNZIPPED + 1L);
            error(ShareException.TOO_LARGE, () -> ShareNbt.gunzip(over), "64 MiB + 1");
            error(ShareException.TOO_LARGE, () -> ShareFiles.readSchem(over), "64 MiB + 1 as a file");
        });
        t.check("gzip: a 1 GiB zip bomb stops at 64 MiB (too_large) without unpacking it all", () -> {
            byte[] bomb = gzipZeros(1L << 30);
            long start = System.nanoTime();
            error(ShareException.TOO_LARGE, () -> ShareNbt.gunzip(bomb));
            double ms = (System.nanoTime() - start) / 1e6;
            t.note(String.format("bomb: %d bytes on disk, refused after %.0f ms", bomb.length, ms));
            ok(ms < 3000, "took " + ms + " ms");
        });
    }

    // ---------------------------------------------------------------- CRC32

    private static void crc(TestKit t) {
        t.check("CRC32 known values: \"123456789\" = cbf43926, IEND chunk = ae426082", () -> {
            CRC32 c = new CRC32();
            c.update("123456789".getBytes(StandardCharsets.US_ASCII));
            eq("cbf43926", String.format("%08x", c.getValue()), "check value");
            eq("ae426082", String.format("%08x", SharePng.crc32(SharePng.type("IEND"), new byte[0], 0, 0)), "IEND");
        });
    }

    // ---------------------------------------------------------------- PNG helpers

    private record RawChunk(String type, int start, byte[] data, int crc) {
    }

    /** A strict chunk walk for the tests: signature, every length, every CRC, ends with IEND. */
    static List<RawChunk> walk(byte[] png) {
        ok(SharePng.isPng(png), "no PNG signature");
        List<RawChunk> chunks = new ArrayList<>();
        int p = 8;
        while (true) {
            ok(p + 8 <= png.length, "chunk header cut off at " + p);
            int length = getInt(png, p);
            String type = new String(png, p + 4, 4, StandardCharsets.ISO_8859_1);
            ok(length >= 0 && p + 12L + length <= png.length, type + " runs past the end");
            byte[] data = Arrays.copyOfRange(png, p + 8, p + 8 + length);
            int crc = getInt(png, p + 8 + length);
            eq(SharePng.crc32(SharePng.type(type), data, 0, length), crc, type + " CRC");
            chunks.add(new RawChunk(type, p, data, crc));
            p += 12 + length;
            if (type.equals("IEND")) {
                return chunks;
            }
        }
    }

    private static int getInt(byte[] b, int p) {
        return (b[p] & 0xff) << 24 | (b[p + 1] & 0xff) << 16 | (b[p + 2] & 0xff) << 8 | (b[p + 3] & 0xff);
    }

    /** One whole chunk (length, type, data, CRC). */
    static byte[] chunk(String type, byte[] data) {
        return cat(i32(data.length), type.getBytes(StandardCharsets.ISO_8859_1), data,
            i32(SharePng.crc32(SharePng.type(type), data, 0, data.length)));
    }

    private static final byte[] SIGNATURE = unhex("89504e470d0a1a0a");

    /** The placeholder cut into whole chunks: IHDR, IDAT, IEND. */
    private static byte[][] pieces() {
        byte[] png = SharePng.placeholder();
        List<RawChunk> c = walk(png);
        byte[][] out = new byte[c.size()][];
        for (int i = 0; i < c.size(); i++) {
            int end = i + 1 < c.size() ? c.get(i + 1).start() : png.length;
            out[i] = Arrays.copyOfRange(png, c.get(i).start(), end);
        }
        return out;
    }

    private static List<String> types(byte[] png) {
        List<String> names = new ArrayList<>();
        for (RawChunk c : walk(png)) {
            names.add(c.type());
        }
        return names;
    }

    private static void solid(BufferedImage image, int w, int h, int rgb) {
        ok(image != null, "ImageIO could not decode it");
        eq(w + "x" + h, image.getWidth() + "x" + image.getHeight(), "size");
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if ((image.getRGB(x, y) & 0xffffff) != rgb) {
                    throw fail("pixel " + x + "," + y + " is " + Integer.toHexString(image.getRGB(x, y)));
                }
            }
        }
    }

    private static void placeholder(TestKit t) {
        t.check("placeholder PNG: 16x16 RGB, chunks IHDR IDAT IEND, all CRCs right, same bytes every time", () -> {
            byte[] png = SharePng.placeholder();
            eq(List.of("IHDR", "IDAT", "IEND"), types(png), "chunks");
            eqHex("00000010 00000010 08 02 00 00 00", walk(png).get(0).data(), "IHDR");
            sameBytes(png, SharePng.placeholder(), "second call");
            t.note("placeholder: " + png.length + " bytes");
        });
        t.check("placeholder PNG: ImageIO decodes it as a solid sea-blue square", () ->
            solid(ImageIO.read(new ByteArrayInputStream(SharePng.placeholder())), 16, 16, SharePng.PLACEHOLDER_RGB));
        t.check("solid image 300x200 (several stored deflate blocks) decodes right", () ->
            solid(ImageIO.read(new ByteArrayInputStream(SharePng.solidImage(300, 200, 0x123456))), 300, 200, 0x123456));
    }

    // ---------------------------------------------------------------- xjSc chunk

    private static ShareModel tiny() {
        ShareModel m = new ShareModel(2, 1, 1);
        m.set(1, 0, 0, "minecraft:stone");
        return m;
    }

    private static void chunk(TestKit t) {
        byte[][] p = pieces(); // IHDR, IDAT, IEND
        byte[] data = unhex("01 02 03 fe ff");
        byte[] xj = chunk("xjSc", data);
        t.check("withData: xjSc goes right before IEND, bytes unchanged, CRC right, ImageIO still reads it", () -> {
            byte[] png = SharePng.withData(SharePng.placeholder(), data);
            eq(List.of("IHDR", "IDAT", "xjSc", "IEND"), types(png), "chunks");
            sameBytes(cat(SIGNATURE, p[0], p[1], xj, p[2]), png, "whole file");
            sameBytes(data, SharePng.extract(png), "extract");
            solid(ImageIO.read(new ByteArrayInputStream(png)), 16, 16, SharePng.PLACEHOLDER_RGB);
        });
        t.check("withData twice keeps one xjSc (the new one); strip gives the plain picture back", () -> {
            byte[] once = SharePng.withData(SharePng.placeholder(), unhex("aa"));
            byte[] twice = SharePng.withData(once, data);
            eq(List.of("IHDR", "IDAT", "xjSc", "IEND"), types(twice), "chunks");
            sameBytes(data, SharePng.extract(twice), "data");
            sameBytes(SharePng.placeholder(), SharePng.strip(twice), "strip");
        });
        t.check("read: xjSc anywhere before IEND counts (before IHDR, between IDATs, after tEXt)", () -> {
            byte[] text = chunk("tEXt", "Comment\0hi".getBytes(StandardCharsets.ISO_8859_1));
            for (byte[] png : List.of(cat(SIGNATURE, xj, p[0], p[1], p[2]), cat(SIGNATURE, p[0], xj, p[1], p[2]),
                cat(SIGNATURE, p[0], text, p[1], xj, p[2]))) {
                sameBytes(data, SharePng.extract(png), "extract");
            }
        });
        t.check("read: bytes after IEND are ignored (even another xjSc); withData drops them", () -> {
            byte[] png = cat(SIGNATURE, p[0], p[1], xj, p[2], xj, unhex("deadbeef"));
            sameBytes(data, SharePng.extract(png), "extract");
            sameBytes(cat(SIGNATURE, p[0], p[1], xj, p[2]), SharePng.withData(png, data), "rewritten");
        });
        t.check("read: no xjSc is no_data, two are multiple_data", () -> {
            error(ShareException.NO_DATA, () -> SharePng.extract(SharePng.placeholder()), "none");
            error(ShareException.MULTIPLE_DATA, () -> SharePng.extract(cat(SIGNATURE, p[0], xj, p[1], xj, p[2])), "two");
        });
        t.check("read: wrong xjSc CRC is bad_crc; a wrong CRC on another chunk is not checked", () -> {
            byte[] bad = cat(SIGNATURE, p[0], p[1], xj, p[2]);
            bad[bad.length - p[2].length - 1] ^= 1;
            error(ShareException.BAD_CRC, () -> SharePng.extract(bad), "xjSc CRC");
            byte[] idat = p[1].clone();
            idat[idat.length - 1] ^= 1;
            sameBytes(data, SharePng.extract(cat(SIGNATURE, p[0], idat, xj, p[2])), "IDAT CRC ignored");
        });
        t.check("read: xjSc declaring more than 16 MiB is too_large, even when the file is short", () -> {
            byte[] huge = cat(i32(SharePng.MAX_CHUNK + 1), "xjSc".getBytes(StandardCharsets.US_ASCII), data);
            error(ShareException.TOO_LARGE, () -> SharePng.extract(cat(SIGNATURE, p[0], huge)), "16 MiB + 1");
            byte[] max = cat(i32(-1), "xjSc".getBytes(StandardCharsets.US_ASCII), data);
            error(ShareException.TOO_LARGE, () -> SharePng.extract(cat(SIGNATURE, p[0], max)), "ffffffff");
            byte[] exact = cat(i32(SharePng.MAX_CHUNK), "xjSc".getBytes(StandardCharsets.US_ASCII), data);
            error(ShareException.BAD_PNG, () -> SharePng.extract(cat(SIGNATURE, p[0], exact)), "16 MiB, cut off");
        });
        t.check("read: a file cut off anywhere after the signature is bad_png", () -> {
            byte[] png = SharePng.withData(SharePng.placeholder(), data);
            for (int cut = 8; cut < png.length; cut++) {
                int at = cut;
                error(ShareException.BAD_PNG, () -> SharePng.extract(Arrays.copyOf(png, at)), "cut to " + at);
            }
            byte[] other = cat(SIGNATURE, p[0], i32(1000), "IDAT".getBytes(StandardCharsets.US_ASCII), data);
            error(ShareException.BAD_PNG, () -> SharePng.extract(other), "IDAT longer than the file");
        });
        t.check("read: an empty xjSc gives 0 bytes, and as a file that is bad_gzip", () -> {
            byte[] png = cat(SIGNATURE, p[0], p[1], chunk("xjSc", new byte[0]), p[2]);
            eq(0, SharePng.extract(png).length, "length");
            error(ShareException.BAD_GZIP, () -> ShareFiles.read(png), "read");
        });
        t.check("write: 16 MiB of data fits, one byte more is too_large", () -> {
            byte[] png = SharePng.withData(SharePng.placeholder(), new byte[SharePng.MAX_CHUNK]);
            eq(SharePng.MAX_CHUNK, SharePng.extract(png).length, "16 MiB");
            error(ShareException.TOO_LARGE, () -> SharePng.withData(SharePng.placeholder(), new byte[SharePng.MAX_CHUNK + 1]));
        });
        t.check("write: an old xjSc with a wrong CRC is simply replaced", () -> {
            byte[] old = cat(SIGNATURE, p[0], p[1], xj, p[2]);
            old[old.length - p[2].length - 1] ^= 1;
            byte[] png = SharePng.withData(old, unhex("77"));
            eqHex("77", SharePng.extract(png), "new data");
        });
        t.check("write: not a PNG is unknown_file, a PNG without IEND is bad_png", () -> {
            error(ShareException.UNKNOWN_FILE, () -> SharePng.withData(unhex("1f8b0800"), data), "gzip");
            error(ShareException.BAD_PNG, () -> SharePng.withData(cat(SIGNATURE, p[0], p[1]), data), "no IEND");
        });
    }

    // ---------------------------------------------------------------- sniffing

    private static void sniff(TestKit t) {
        t.check("sniff: not PNG and not gzip is unknown_file (empty, text, 1 byte, raw NBT, almost-PNG)", () -> {
            for (String h : List.of("", "68656c6c6f", "1f", "89", "0a000000", "89504e470d0a1a0b", "8b1f0800")) {
                error(ShareException.UNKNOWN_FILE, () -> ShareFiles.read(unhex(h)), h.isEmpty() ? "empty" : h);
            }
        });
        t.check("sniff: starts with 1f 8b but is not a gzip stream: bad_gzip", () -> {
            error(ShareException.BAD_GZIP, () -> ShareFiles.read(unhex("1f8b")), "1f8b");
            error(ShareException.BAD_GZIP, () -> ShareFiles.read(unhex("1f8b 0700 00000000 00ff 0300 00000000 00000000")),
                "method 7");
        });
        t.check("sniff: PNG signature and nothing else is bad_png", () ->
            error(ShareException.BAD_PNG, () -> ShareFiles.read(SIGNATURE)));
        t.check("sniff: gzip of something that is not NBT is bad_nbt; of an empty compound bad_schematic", () -> {
            error(ShareException.BAD_NBT, () -> ShareFiles.read(ShareNbt.gzip("hello".getBytes(StandardCharsets.US_ASCII))),
                "text");
            error(ShareException.BAD_SCHEMATIC, () -> ShareFiles.read(ShareNbt.gzip(unhex("0a0000 00"))), "{}");
        });
        t.check("ShareFiles: PNG and raw .schem of the same model read the same; PNG = placeholder + xjSc", () -> {
            ShareModel m = tiny();
            byte[] schem = ShareFiles.writeSchem(m);
            byte[] png = ShareFiles.writePng(m);
            sameBytes(SharePng.withData(SharePng.placeholder(), schem), png, "writePng");
            sameBytes(schem, SharePng.extract(png), "extract");
            sameJson(ShareDump.dump(ShareFiles.read(schem)), ShareDump.dump(ShareFiles.read(png)), "dump");
            eq("minecraft:stone", ShareFiles.read(png).get(1, 0, 0), "cell");
        });
    }
}
