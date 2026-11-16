package com.xiaojingyu.share;

/**
 * A share file (鲸图 PNG or .schem) could not be read or written.
 *
 * <p>{@link #code()} is one of the error codes of docs/FORMAT.md §5 (the same on the web side);
 * {@link #getMessage()} is the Chinese sentence for the player; {@link #detail()} says what
 * exactly was wrong (for logs, not for players).
 */
public final class ShareException extends Exception {
    public static final String UNKNOWN_FILE = "unknown_file";
    public static final String BAD_PNG = "bad_png";
    public static final String NO_DATA = "no_data";
    public static final String MULTIPLE_DATA = "multiple_data";
    public static final String BAD_CRC = "bad_crc";
    public static final String TOO_LARGE = "too_large";
    public static final String BAD_GZIP = "bad_gzip";
    public static final String BAD_NBT = "bad_nbt";
    public static final String UNSUPPORTED_VERSION = "unsupported_version";
    public static final String BAD_SCHEMATIC = "bad_schematic";

    private static final long serialVersionUID = 1L;

    private final String code;
    private final String detail;

    private ShareException(String code, String message, String detail, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.detail = detail;
    }

    /** Error code from FORMAT.md §5, e.g. {@code "no_data"}. */
    public String code() {
        return code;
    }

    /** What exactly was wrong, in English, for logs. */
    public String detail() {
        return detail;
    }

    @Override
    public String toString() {
        return "ShareException[" + code + "]: " + detail;
    }

    static ShareException of(String code, String detail) {
        return of(code, detail, null);
    }

    static ShareException of(String code, String detail, Throwable cause) {
        String message = switch (code) {
            case UNKNOWN_FILE -> "这不是鲸图（PNG）也不是 .schem 文件。";
            case BAD_PNG -> "图片文件不完整，可能没下载完。请重新保存原图再试。";
            case NO_DATA -> "这张图里没有方块数据。聊天软件（微信、QQ 等）发图时常会压缩图片、去掉附加数据。"
                + "请让对方「发送原图」或者把图片当文件发，再试一次。";
            case MULTIPLE_DATA -> "这张图里有好几份方块数据，不知道该用哪份。";
            case BAD_CRC -> "方块数据损坏了。请让对方重新发原文件。";
            case TOO_LARGE -> "这个建筑太大了，或者里面的东西太多了（上限：每边 1024 格，总共 4,194,304 格）。";
            case BAD_GZIP -> "方块数据损坏了（解压失败）。";
            case BAD_NBT -> "方块数据损坏了（数据结构不对）。";
            default -> throw new IllegalArgumentException("use unsupportedVersion/badSchematic for " + code);
        };
        return new ShareException(code, message, detail, cause);
    }

    static ShareException unsupportedVersion(int version) {
        return new ShareException(UNSUPPORTED_VERSION,
            "这个文件是 Sponge 第 " + version + " 版格式，现在只支持第 3 版。",
            "Sponge schematic version " + version + ", only 3 is supported", null);
    }

    /**
     * @param where Chinese, what is missing or wrong, e.g. "Palette 里的编号必须是整数"
     * @param detail the same in English, for logs
     */
    static ShareException badSchematic(String where, String detail) {
        return new ShareException(BAD_SCHEMATIC, "方块数据不完整：" + where + "。", detail, null);
    }
}
