package com.xiaojingyu.share;

/**
 * Reading and writing whole share files: 鲸图 PNG or bare .schem (docs/FORMAT.md).
 *
 * <pre>{@code
 * ShareModel model = ShareFiles.read(Files.readAllBytes(path));   // PNG or .schem, found by content
 * byte[] png = ShareFiles.writePng(model);                         // placeholder picture + data
 * byte[] schem = ShareFiles.writeSchem(model);
 * }</pre>
 *
 * Every method throws {@link ShareException} with a FORMAT.md §5 code when something is wrong.
 */
public final class ShareFiles {
    private ShareFiles() {
    }

    /** A model from a 鲸图 PNG or a bare .schem; which one is decided by the first bytes. */
    public static ShareModel read(byte[] file) throws ShareException {
        if (SharePng.isPng(file)) {
            return readSchem(SharePng.extract(file));
        }
        if (file.length >= 2 && (file[0] & 0xFF) == 0x1F && (file[1] & 0xFF) == 0x8B) {
            return readSchem(file);
        }
        throw ShareException.of(ShareException.UNKNOWN_FILE, "neither PNG signature nor gzip header");
    }

    /** A model from .schem bytes (gzip of NBT). */
    public static ShareModel readSchem(byte[] schem) throws ShareException {
        return SchemCodec.decode(ShareNbt.readRoot(ShareNbt.gunzip(schem)));
    }

    /** The model as .schem bytes. */
    public static byte[] writeSchem(ShareModel model) throws ShareException {
        byte[] nbt = ShareNbt.writeRoot(SchemCodec.encode(model));
        if (nbt.length > ShareNbt.MAX_UNZIPPED) {
            throw ShareException.of(ShareException.TOO_LARGE, "NBT is " + nbt.length + " bytes, more than 64 MiB");
        }
        return ShareNbt.gzip(nbt);
    }

    /** The model as a 鲸图 with the placeholder picture ({@link SharePng#placeholder()}). */
    public static byte[] writePng(ShareModel model) throws ShareException {
        return writePng(model, SharePng.placeholder());
    }

    /** The model as a 鲸图 with the given picture (a valid PNG, e.g. a rendered view of the building). */
    public static byte[] writePng(ShareModel model, byte[] picture) throws ShareException {
        return SharePng.withData(picture, writeSchem(model));
    }
}
