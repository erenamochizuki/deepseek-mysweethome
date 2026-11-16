package com.xiaojingyu.blacklist;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.jspecify.annotations.Nullable;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;

import net.minecraft.resources.Identifier;

/**
 * The text of the capture blacklist file {@code config/xiaojingyu-blacklist.json} (COMMANDS.md §2a):
 * reading is forgiving (people edit it with Notepad), writing is always the same shape. No game needed,
 * so cmdTest checks it in a plain JVM.
 *
 * <pre>{
 *   "note": "…",
 *   "blocks": [
 *     "minecraft:stone",
 *     "xiaojingyu:dining_table"
 *   ]
 * }</pre>
 *
 * Also accepted: a bare list {@code ["minecraft:stone"]}, ids without {@code minecraft:}, capital letters,
 * a block state ({@code minecraft:oak_stairs[facing=north]} counts as the whole block), a UTF-8 BOM,
 * comments and trailing commas (Gson's lenient reader).
 */
public final class BlacklistFile {
    /** At most this many blocks are read; the rest are skipped. */
    public static final int MAX_ENTRIES = 4096;
    /** Longer strings are not block ids. */
    public static final int MAX_ID_LENGTH = 256;
    /** The "note" written at the top of the file for people who open it. */
    public static final String NOTE = "小鲸鱼之家：用 /xjy capture 抓鲸图时，blocks 里列出的方块都当空气导出。"
        + "一项写一个方块 id，比如 \"minecraft:stone\"，用英文双引号括起来，项和项之间用英文逗号隔开。"
        + "保存以后，下一次抓取就按新的名单算。也可以在游戏里用 /xjy blacklist 改。";

    private static final Pattern WHERE = Pattern.compile("line (\\d+) column (\\d+)");

    /**
     * Why the whole file could not be used. {@code code}: {@code syntax} (not JSON; line and column are
     * 1-based, 0 when unknown) or {@code shape} (JSON, but not a list or {"blocks": [...]}).
     */
    public record Problem(String code, int line, int column, String detail) {
    }

    /**
     * @param ids        the block ids in file order, normalized, without repeats
     * @param skipped    entries that are not block ids (as written), plus the ones past {@link #MAX_ENTRIES}
     * @param duplicates how many entries repeated an earlier one
     * @param problem    not null when the file could not be used at all (then {@code ids} is empty)
     */
    public record Parsed(List<String> ids, List<String> skipped, int duplicates, @Nullable Problem problem) {
    }

    private BlacklistFile() {
    }

    public static Parsed parse(String text) {
        String s = text.startsWith("﻿") ? text.substring(1) : text;
        if (s.isBlank()) {
            return new Parsed(List.of(), List.of(), 0, null);
        }
        JsonElement root;
        try {
            root = JsonParser.parseString(s);
        } catch (JsonParseException | IllegalStateException e) {
            String msg = String.valueOf(e.getMessage());
            Matcher m = WHERE.matcher(msg);
            boolean where = m.find();
            return problem(new Problem("syntax", where ? Integer.parseInt(m.group(1)) : 0,
                where ? Integer.parseInt(m.group(2)) : 0, msg));
        }
        JsonArray list;
        if (root.isJsonArray()) {
            list = root.getAsJsonArray();
        } else if (root.isJsonObject() && root.getAsJsonObject().get("blocks") instanceof JsonArray a) {
            list = a;
        } else {
            return problem(new Problem("shape", 0, 0, "expected [\"id\", …] or {\"blocks\": [\"id\", …]}"));
        }
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        List<String> skipped = new ArrayList<>();
        int duplicates = 0;
        for (JsonElement e : list) {
            if (e.isJsonNull()) {
                continue; // a trailing comma reads as null in lenient mode
            }
            String raw = e.isJsonPrimitive() && e.getAsJsonPrimitive().isString() ? e.getAsString() : e.toString();
            String id = e.isJsonPrimitive() && e.getAsJsonPrimitive().isString() ? normalize(raw) : null;
            if (id == null || ids.size() >= MAX_ENTRIES && !ids.contains(id)) {
                skipped.add(raw);
            } else if (!ids.add(id)) {
                duplicates++;
            }
        }
        return new Parsed(List.copyOf(ids), List.copyOf(skipped), duplicates, null);
    }

    private static Parsed problem(Problem p) {
        return new Parsed(List.of(), List.of(), 0, p);
    }

    /** The file text for these ids (UTF-8, no BOM, ends with a newline). */
    public static String format(Collection<String> ids) {
        JsonObject o = new JsonObject();
        o.addProperty("note", NOTE);
        JsonArray a = new JsonArray();
        ids.forEach(a::add);
        o.add("blocks", a);
        return new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(o) + "\n";
    }

    /**
     * A block id as written by a person → {@code namespace:path}, or null if it is not one. Trims, lower
     * cases, adds {@code minecraft:} when there is no namespace, drops a {@code [state]} or {@code {nbt}}
     * part. Whether the block exists in this game is checked elsewhere.
     */
    public static @Nullable String normalize(String raw) {
        String s = raw.strip().toLowerCase(Locale.ROOT);
        int cut = indexOfAny(s, '[', '{');
        if (cut >= 0) {
            s = s.substring(0, cut).strip();
        }
        if (s.isEmpty() || s.length() > MAX_ID_LENGTH) {
            return null;
        }
        Identifier id = Identifier.tryParse(s);
        return id == null || id.getPath().isEmpty() ? null : id.toString();
    }

    private static int indexOfAny(String s, char a, char b) {
        int i = s.indexOf(a);
        int j = s.indexOf(b);
        return i < 0 ? j : j < 0 ? i : Math.min(i, j);
    }
}
