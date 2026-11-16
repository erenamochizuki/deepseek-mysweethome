package com.xiaojingyu.command;

import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.exceptions.SimpleCommandExceptionType;
import com.xiaojingyu.share.ShareException;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/**
 * Chat text for /xjy. Everything goes through translation keys (docs/COMMANDS.md §6): keys are
 * {@link #PREFIX} + the short key used in code, in both lang files.
 */
public final class Msg {
    public static final String PREFIX = "xiaojingyu.command.";

    /** FORMAT.md §5 codes; each has the key share.&lt;code&gt;. */
    public static final List<String> SHARE_CODES = List.of(
        ShareException.UNKNOWN_FILE, ShareException.BAD_PNG, ShareException.NO_DATA, ShareException.MULTIPLE_DATA,
        ShareException.BAD_CRC, ShareException.TOO_LARGE, ShareException.BAD_GZIP, ShareException.BAD_NBT,
        ShareException.UNSUPPORTED_VERSION, ShareException.BAD_SCHEMATIC);

    private static final Pattern NUMBER = Pattern.compile("-?\\d+");
    private static final String SCHEMATIC_PREFIX = "方块数据不完整：";

    private Msg() {
    }

    /** The text for a short key, e.g. t("undo.nothing"). */
    public static MutableComponent t(String key, Object... args) {
        return Component.translatable(PREFIX + key, args);
    }

    /** A command failure with this text: the command reports success = false and does nothing. */
    public static CommandSyntaxException fail(String key, Object... args) {
        return fail(t(key, args));
    }

    public static CommandSyntaxException fail(Component message) {
        return new SimpleCommandExceptionType(message).create();
    }

    /** The FORMAT.md §5 message for a building file that could not be read or written. */
    public static MutableComponent shareError(ShareException e) {
        String code = e.code();
        return switch (code) {
            case ShareException.UNSUPPORTED_VERSION -> {
                Matcher m = NUMBER.matcher(String.valueOf(e.detail()));
                yield t("share.unsupported_version", m.find() ? m.group() : "?");
            }
            case ShareException.BAD_SCHEMATIC ->
                t("share.bad_schematic", where(String.valueOf(e.getMessage())), String.valueOf(e.detail()));
            case ShareException.UNKNOWN_FILE, ShareException.BAD_PNG, ShareException.NO_DATA,
                 ShareException.MULTIPLE_DATA, ShareException.BAD_CRC, ShareException.TOO_LARGE,
                 ShareException.BAD_GZIP, ShareException.BAD_NBT -> t("share." + code);
            default -> t("share.unknown", code, String.valueOf(e.getMessage()));
        };
    }

    /** The Chinese "which part" out of a bad_schematic message ("方块数据不完整：X。" → "X"). */
    static String where(String message) {
        String s = message;
        if (s.startsWith(SCHEMATIC_PREFIX)) {
            s = s.substring(SCHEMATIC_PREFIX.length());
        }
        return s.endsWith("。") ? s.substring(0, s.length() - 1) : s;
    }
}
