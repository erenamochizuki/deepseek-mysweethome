package com.xiaojingyu.photo;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import org.jspecify.annotations.Nullable;

/**
 * The photo rules of docs/PHOTOS.md §1, without any Minecraft class (cmdTest checks them in a plain JVM):
 * a photo is a 128 × 128 PNG of at most 48 KB. Whoever reads one checks it first; a photo that fails is
 * treated as missing (not drawn, not paged to), never a crash. The check looks only at the bytes we must
 * trust before decoding: the PNG signature and the IHDR chunk's width and height. The client decodes with
 * MC's own PNG reader afterwards (which also refuses broken data).
 */
public final class Photos {
    /** Width and height in pixels (like a map). */
    public static final int SIZE = 128;
    /**
     * Largest PNG file a reader accepts: 48 × 1024 = 49152 bytes. Writers (the web page) stay at or under 48000
     * (PHOTOS.md §1, lead 2026-11-08); the mod only reads photos, so this is the only limit it has.
     */
    public static final int MAX_BYTES = 48 * 1024;
    /** Most photos in one album (PHOTOS.md §2). */
    public static final int MAX_ALBUM = 64;
    /** Length of a photo Id: the first 16 hex digits of the PNG's SHA-1. */
    public static final int ID_LENGTH = 16;

    /** Why a photo is not used (also the word in the log line). */
    public enum Problem {
        /** No Png byte array at all. */
        MISSING,
        /** More than 48 KB. */
        TOO_LARGE,
        /** Does not start with the PNG signature and an IHDR chunk. */
        NOT_PNG,
        /** A PNG, but not 128 × 128. */
        WRONG_SIZE
    }

    private static final byte[] SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
    private static final byte[] IHDR = "IHDR".getBytes(StandardCharsets.US_ASCII);
    /** Signature (8) + IHDR length (4) + type (4) + width (4) + height (4). */
    private static final int HEADER_BYTES = 24;

    private Photos() {
    }

    /** Null if {@code png} is a usable photo, otherwise why not. */
    public static @Nullable Problem problem(byte @Nullable [] png) {
        if (png == null) {
            return Problem.MISSING;
        }
        if (png.length > MAX_BYTES) {
            return Problem.TOO_LARGE;
        }
        if (png.length < HEADER_BYTES) {
            return Problem.NOT_PNG;
        }
        for (int i = 0; i < SIGNATURE.length; i++) {
            if (png[i] != SIGNATURE[i]) {
                return Problem.NOT_PNG;
            }
        }
        // The first chunk must be IHDR with 13 data bytes (PNG spec §11.2.2).
        if (readInt(png, 8) != 13) {
            return Problem.NOT_PNG;
        }
        for (int i = 0; i < IHDR.length; i++) {
            if (png[12 + i] != IHDR[i]) {
                return Problem.NOT_PNG;
            }
        }
        return width(png) == SIZE && height(png) == SIZE ? null : Problem.WRONG_SIZE;
    }

    /** Width from the IHDR chunk (call only after the header was checked). */
    public static int width(byte[] png) {
        return readInt(png, 16);
    }

    /** Height from the IHDR chunk (call only after the header was checked). */
    public static int height(byte[] png) {
        return readInt(png, 20);
    }

    /** The photo Id of PNG bytes: SHA-1, first 16 hex digits, lower case. */
    public static String id(byte[] png) {
        try {
            byte[] sha = MessageDigest.getInstance("SHA-1").digest(png);
            return HexFormat.of().formatHex(sha).substring(0, ID_LENGTH);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("no SHA-1 in this JVM", e);
        }
    }

    private static int readInt(byte[] b, int at) {
        return (b[at] & 0xFF) << 24 | (b[at + 1] & 0xFF) << 16 | (b[at + 2] & 0xFF) << 8 | (b[at + 3] & 0xFF);
    }
}
