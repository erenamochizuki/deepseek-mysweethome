package com.xiaojingyu.build;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import java.util.zip.Deflater;

/** A small PNG encoder (8-bit RGBA, no filtering, one IDAT) for capture previews; COMMANDS.md §5 forbids ImageIO and NativeImage. */
public final class PngWriter {
    private static final byte[] SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};

    private PngWriter() {
    }

    /**
     * @param argb width × height pixels, row by row from the top, 0xAARRGGBB
     * @return a complete PNG file
     */
    public static byte[] encode(int width, int height, int[] argb) {
        if (width <= 0 || height <= 0 || argb.length != width * height) {
            throw new IllegalArgumentException("bad image size " + width + "x" + height + " for " + argb.length + " pixels");
        }
        byte[] raw = new byte[height * (1 + 4 * width)];
        int p = 0;
        for (int y = 0; y < height; y++) {
            raw[p++] = 0; // filter: none
            for (int x = 0; x < width; x++) {
                int c = argb[y * width + x];
                raw[p++] = (byte) (c >>> 16);
                raw[p++] = (byte) (c >>> 8);
                raw[p++] = (byte) c;
                raw[p++] = (byte) (c >>> 24);
            }
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(SIGNATURE);
        byte[] ihdr = new byte[13];
        putInt(ihdr, 0, width);
        putInt(ihdr, 4, height);
        ihdr[8] = 8; // bit depth
        ihdr[9] = 6; // colour type: RGBA
        chunk(out, "IHDR", ihdr);
        chunk(out, "IDAT", deflate(raw));
        chunk(out, "IEND", new byte[0]);
        return out.toByteArray();
    }

    private static byte[] deflate(byte[] data) {
        Deflater deflater = new Deflater(Deflater.BEST_COMPRESSION);
        try {
            deflater.setInput(data);
            deflater.finish();
            ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, data.length / 4));
            byte[] buf = new byte[8192];
            while (!deflater.finished()) {
                out.write(buf, 0, deflater.deflate(buf));
            }
            return out.toByteArray();
        } finally {
            deflater.end();
        }
    }

    private static void chunk(ByteArrayOutputStream out, String type, byte[] data) {
        byte[] typeBytes = type.getBytes(StandardCharsets.US_ASCII);
        byte[] len = new byte[4];
        putInt(len, 0, data.length);
        out.writeBytes(len);
        out.writeBytes(typeBytes);
        out.writeBytes(data);
        CRC32 crc = new CRC32();
        crc.update(typeBytes);
        crc.update(data);
        byte[] sum = new byte[4];
        putInt(sum, 0, (int) crc.getValue());
        out.writeBytes(sum);
    }

    private static void putInt(byte[] b, int at, int v) {
        b[at] = (byte) (v >>> 24);
        b[at + 1] = (byte) (v >>> 16);
        b[at + 2] = (byte) (v >>> 8);
        b[at + 3] = (byte) v;
    }
}
