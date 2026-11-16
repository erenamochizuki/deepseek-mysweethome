package com.xiaojingyu.build;

import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.Predicate;

import org.jspecify.annotations.Nullable;

/**
 * File names for /xjy capture and /xjy place (docs/COMMANDS.md §2, §3). Pure string work, except {@link #findIn},
 * which looks a name up in a folder.
 */
public final class FileNames {
    /** At most this many characters (code points) in a building's file name, before "-2" and the extension. */
    public static final int MAX_LENGTH = 64;
    public static final String PNG = ".png";
    public static final String SCHEM = ".schem";

    private static final String FORBIDDEN = "\\/:*?\"<>|";
    /** Refused in a /xjy place argument: path separators and ':' (drive letters, NTFS alternate data streams). */
    private static final String PLACE_FORBIDDEN = "\\/:";
    private static final Set<String> RESERVED = Set.of(
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9");

    private FileNames() {
    }

    /**
     * A file name (without extension) for a building: forbidden and control characters become {@code _},
     * at most {@link #MAX_LENGTH} characters, no trailing spaces or dots, Windows device names get a
     * leading {@code _}. Uses {@code fallback} when nothing is left.
     */
    public static String sanitize(String name, String fallback) {
        String cleaned = clean(name == null ? "" : name.strip());
        if (cleaned.isEmpty()) {
            cleaned = clean(fallback);
        }
        if (isReserved(cleaned)) {
            cleaned = clean("_" + cleaned);
        }
        return cleaned;
    }

    /**
     * Default building name for {@code /xjy capture 上次} (COMMANDS.md §2b): the placed file's name without
     * {@code .png} / {@code .schem}, without a time stamp an earlier "上次" capture put there
     * ({@code -yyyyMMdd-HHmmss}, maybe followed by {@code -2} …), then {@code -} + {@code stamp}.
     * {@code house-v4-b.png} → {@code house-v4-b-20261107-121530}.
     */
    public static String lastCaptureName(String placedFile, String stamp) {
        String stem = placedFile;
        String lower = stem.toLowerCase(Locale.ROOT);
        if (lower.endsWith(PNG)) {
            stem = stem.substring(0, stem.length() - PNG.length());
        } else if (lower.endsWith(SCHEM)) {
            stem = stem.substring(0, stem.length() - SCHEM.length());
        }
        stem = stem.replaceFirst("-\\d{8}-\\d{6}(-\\d+)?$", "");
        return stem.isBlank() ? stamp : stem + "-" + stamp;
    }

    /** Whether Windows treats this file name as a device (CON, nul.txt, "com1 .png" …). */
    public static boolean isReserved(String name) {
        int dot = name.indexOf('.');
        String stem = (dot < 0 ? name : name.substring(0, dot)).stripTrailing();
        return RESERVED.contains(stem.toUpperCase(Locale.ROOT));
    }

    /** {@code base + ext}, or base-2, base-3 … + ext when that is already taken. */
    public static String firstFree(String base, String ext, Predicate<String> taken) {
        String name = base + ext;
        for (int n = 2; taken.test(name); n++) {
            name = base + "-" + n + ext;
        }
        return name;
    }

    /**
     * Whether a /xjy place argument may name a file in the buildings folder (COMMANDS.md §3): not blank, not "." or
     * "..", no '/', '\', ':' and no control characters. Dots inside a name ("a..b") are fine; {@link #findIn} still
     * makes sure the file sits directly in the folder.
     */
    public static boolean isSafePlaceArg(@Nullable String arg) {
        if (arg == null || arg.isBlank() || arg.equals(".") || arg.equals("..")) {
            return false;
        }
        for (int i = 0; i < arg.length(); i++) {
            char c = arg.charAt(i);
            if (Character.isISOControl(c) || PLACE_FORBIDDEN.indexOf(c) >= 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * The building file a /xjy place argument names in {@code folder}, or null (COMMANDS.md §3): the first of
     * {@link #placeCandidates} that, after normalizing, sits directly in the folder and is a regular file (not a
     * folder or a link). Names the file system does not accept count as not found.
     */
    public static @Nullable Path findIn(Path folder, String arg) {
        Path dir = folder.toAbsolutePath().normalize();
        for (String name : placeCandidates(arg)) {
            Path p;
            try {
                p = dir.resolve(name).normalize();
            } catch (InvalidPathException e) {
                continue;
            }
            if (dir.equals(p.getParent()) && Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)) {
                return p;
            }
        }
        return null;
    }

    /** File names to try, in order, for a /xjy place argument: the name as typed if it has an extension, then .png, then .schem. */
    public static List<String> placeCandidates(String arg) {
        String lower = arg.toLowerCase(Locale.ROOT);
        if (lower.endsWith(PNG) || lower.endsWith(SCHEM)) {
            return List.of(arg, arg + PNG, arg + SCHEM);
        }
        return List.of(arg + PNG, arg + SCHEM);
    }

    /** Whether a file in the buildings folder is one /xjy place can read. */
    public static boolean isBuildingFile(String fileName) {
        String lower = fileName.toLowerCase(Locale.ROOT);
        return lower.endsWith(PNG) || lower.endsWith(SCHEM);
    }

    /** How to type a file name as a command argument: as is when Brigadier reads it unquoted, otherwise in double quotes. */
    public static String quoteIfNeeded(String s) {
        boolean plain = !s.isEmpty();
        for (int i = 0; i < s.length() && plain; i++) {
            plain = isUnquotedChar(s.charAt(i));
        }
        return plain ? s : "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /** Whether a file name fits what has been typed so far: a leading quote is ignored, case does not matter. */
    public static boolean matchesTyped(String fileName, String typed) {
        String t = typed.startsWith("\"") ? typed.substring(1) : typed;
        return fileName.toLowerCase(Locale.ROOT).startsWith(t.toLowerCase(Locale.ROOT));
    }

    /** Same set as Brigadier's StringReader.isAllowedInUnquotedString. */
    static boolean isUnquotedChar(char c) {
        return c >= '0' && c <= '9' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z'
            || c == '_' || c == '-' || c == '.' || c == '+';
    }

    private static String clean(String s) {
        StringBuilder out = new StringBuilder();
        int count = 0;
        for (int i = 0; i < s.length() && count < MAX_LENGTH; count++) {
            int cp = s.codePointAt(i);
            i += Character.charCount(cp);
            boolean bad = cp < 0x20 || (cp >= 0x7F && cp <= 0x9F) || (cp >= 0xD800 && cp <= 0xDFFF)
                || FORBIDDEN.indexOf(cp) >= 0;
            if (bad) {
                out.append('_');
            } else {
                out.appendCodePoint(cp);
            }
        }
        int end = out.length();
        while (end > 0 && (out.charAt(end - 1) == ' ' || out.charAt(end - 1) == '.')) {
            end--;
        }
        return out.substring(0, end);
    }
}
