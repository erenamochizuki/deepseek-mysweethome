package com.xiaojingyu.share;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.google.gson.Strictness;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
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
import net.minecraft.nbt.ShortTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;

/**
 * Model ⇄ dump JSON (docs/FORMAT.md §4), plus a JSON printer and comparator for the tests.
 * Test code: not in the mod jar.
 */
final class ShareDump {
    private static final Set<String> DUMP_KEYS =
        Set.of("dump", "size", "offset", "dataVersion", "meta", "palette", "cells", "blockEntities", "warnings");
    private static final Set<String> BLOCK_ENTITY_KEYS = Set.of("pos", "id", "data");

    private ShareDump() {
    }

    // ---------------------------------------------------------------- model -> dump

    /** The dump of a model (canonical palette, runs, typed NBT). The model must have no bad cells. */
    static JsonObject dump(ShareModel model) {
        ShareModel.Canonical canonical = model.canonical();
        JsonObject o = new JsonObject();
        o.addProperty("dump", 1);
        o.add("size", ints(model.width(), model.height(), model.length()));
        o.add("offset", ints(model.offset()));
        o.addProperty("dataVersion", model.dataVersion());
        o.add("meta", model.meta() == null ? JsonNull.INSTANCE : tagToJson(model.meta()));
        JsonArray palette = new JsonArray();
        for (String state : canonical.palette()) {
            palette.add(state);
        }
        o.add("palette", palette);
        JsonArray runs = new JsonArray();
        int[] cells = canonical.cells();
        for (int i = 0; i < cells.length; ) {
            int j = i + 1;
            while (j < cells.length && cells[j] == cells[i]) {
                j++;
            }
            runs.add(ints(j - i, cells[i]));
            i = j;
        }
        o.add("cells", runs);
        JsonArray blockEntities = new JsonArray();
        for (ShareModel.BlockEntityEntry be : model.blockEntities()) {
            JsonObject b = new JsonObject();
            b.add("pos", ints(be.x(), be.y(), be.z()));
            b.addProperty("id", be.id());
            b.add("data", be.data() == null ? JsonNull.INSTANCE : tagToJson(be.data()));
            blockEntities.add(b);
        }
        o.add("blockEntities", blockEntities);
        TreeSet<String> warnings = new TreeSet<>(model.warnings());
        if (canonical.droppedUnused()) {
            warnings.add(ShareModel.WARN_UNUSED_PALETTE);
        }
        JsonArray w = new JsonArray();
        for (String warning : warnings) {
            w.add(warning);
        }
        o.add("warnings", w);
        return o;
    }

    /** Typed JSON of one NBT value (FORMAT.md §4 table). */
    static JsonObject tagToJson(Tag tag) {
        JsonObject o = new JsonObject();
        switch (tag) {
            case ByteTag t -> o.addProperty("byte", t.value());
            case ShortTag t -> o.addProperty("short", t.value());
            case IntTag t -> o.addProperty("int", t.value());
            case LongTag t -> o.addProperty("long", Long.toString(t.value()));
            case FloatTag t -> o.addProperty("float", String.format("%08x", Float.floatToRawIntBits(t.value())));
            case DoubleTag t -> o.addProperty("double", String.format("%016x", Double.doubleToRawLongBits(t.value())));
            case StringTag t -> o.addProperty("string", t.value());
            case ByteArrayTag t -> {
                JsonArray a = new JsonArray();
                for (byte b : t.getAsByteArray()) {
                    a.add(b);
                }
                o.add("byteArray", a);
            }
            case IntArrayTag t -> o.add("intArray", ints(t.getAsIntArray()));
            case LongArrayTag t -> {
                JsonArray a = new JsonArray();
                for (long v : t.getAsLongArray()) {
                    a.add(Long.toString(v));
                }
                o.add("longArray", a);
            }
            case ListTag t -> {
                JsonArray a = new JsonArray();
                for (Tag element : t) {
                    a.add(tagToJson(element));
                }
                o.add("list", a);
            }
            case CompoundTag t -> {
                JsonObject c = new JsonObject();
                for (String key : new TreeSet<>(t.keySet())) {
                    c.add(key, tagToJson(t.get(key)));
                }
                o.add("compound", c);
            }
            default -> throw new IllegalArgumentException("cannot dump tag type " + tag.getId());
        }
        return o;
    }

    private static JsonArray ints(int... values) {
        JsonArray a = new JsonArray();
        for (int v : values) {
            a.add(v);
        }
        return a;
    }

    // ---------------------------------------------------------------- dump -> model

    /**
     * A model from a dump (strict: unknown keys, wrong types, bad runs are errors). Palette ids
     * are used as given; warnings are copied.
     *
     * @throws IllegalArgumentException with the JSON path of the problem
     */
    static ShareModel toModel(JsonElement json) {
        JsonObject o = object(json, "$");
        for (String key : o.keySet()) {
            if (!DUMP_KEYS.contains(key)) {
                throw bad("$." + key, "unknown key");
            }
        }
        if (integer(o.get("dump"), "$.dump") != 1) {
            throw bad("$.dump", "must be 1");
        }
        int[] size = intArray(o.get("size"), 3, "$.size");
        if (!ShareModel.sizeAllowed(size[0], size[1], size[2])) {
            throw bad("$.size", "size not allowed");
        }
        ShareModel model = new ShareModel(size[0], size[1], size[2]);
        int[] offset = intArray(o.get("offset"), 3, "$.offset");
        model.setOffset(offset[0], offset[1], offset[2]);
        model.setDataVersion(integer(o.get("dataVersion"), "$.dataVersion"));
        model.setMeta(compoundOrNull(o.get("meta"), "$.meta"));

        JsonArray paletteJson = array(o.get("palette"), "$.palette");
        List<String> palette = new ArrayList<>();
        for (int i = 0; i < paletteJson.size(); i++) {
            palette.add(string(paletteJson.get(i), "$.palette[" + i + "]"));
        }
        if (new HashSet<>(palette).size() != palette.size()) {
            throw bad("$.palette", "a state appears twice");
        }
        model.setPalette(palette);

        JsonArray runs = array(o.get("cells"), "$.cells");
        int[] cells = model.cells();
        int at = 0;
        for (int r = 0; r < runs.size(); r++) {
            String path = "$.cells[" + r + "]";
            int[] run = intArray(runs.get(r), 2, path);
            if (run[0] < 1) {
                throw bad(path, "count must be at least 1");
            }
            if (run[1] < 0 || run[1] >= palette.size()) {
                throw bad(path, "palette id " + run[1] + " out of range");
            }
            if ((long) at + run[0] > cells.length) {
                throw bad(path, "more cells than W*H*L");
            }
            Arrays.fill(cells, at, at + run[0], run[1]);
            at += run[0];
        }
        if (at != cells.length) {
            throw bad("$.cells", "covers " + at + " cells, needs " + cells.length);
        }

        JsonArray blockEntities = array(o.get("blockEntities"), "$.blockEntities");
        for (int i = 0; i < blockEntities.size(); i++) {
            String path = "$.blockEntities[" + i + "]";
            JsonObject b = object(blockEntities.get(i), path);
            for (String key : b.keySet()) {
                if (!BLOCK_ENTITY_KEYS.contains(key)) {
                    throw bad(path + "." + key, "unknown key");
                }
            }
            int[] pos = intArray(b.get("pos"), 3, path + ".pos");
            if (!model.contains(pos[0], pos[1], pos[2])) {
                throw bad(path + ".pos", "outside the size");
            }
            if (model.blockEntity(pos[0], pos[1], pos[2]) != null) {
                throw bad(path + ".pos", "two block entities in one cell");
            }
            String id = string(b.get("id"), path + ".id");
            model.putBlockEntity(pos[0], pos[1], pos[2], id, compoundOrNull(b.get("data"), path + ".data"));
        }

        JsonArray warnings = array(o.get("warnings"), "$.warnings");
        for (int i = 0; i < warnings.size(); i++) {
            model.addWarning(string(warnings.get(i), "$.warnings[" + i + "]"));
        }
        return model;
    }

    private static CompoundTag compoundOrNull(JsonElement e, String path) {
        if (e == null) {
            throw bad(path, "missing (use null)");
        }
        if (e.isJsonNull()) {
            return null;
        }
        if (!(jsonToTag(e, path) instanceof CompoundTag compound)) {
            throw bad(path, "must be a compound or null");
        }
        return compound;
    }

    /**
     * An NBT value from typed JSON. Lists are built with {@code add}, so a list keeps exactly the
     * elements written in the JSON (what MC's reader gives back after its unwrapping).
     */
    @SuppressWarnings("removal") // FloatTag/DoubleTag constructors: valueOf would turn -0.0 into +0.0
    static Tag jsonToTag(JsonElement e, String path) {
        JsonObject o = object(e, path);
        if (o.size() != 1) {
            throw bad(path, "a typed value has exactly one key");
        }
        Map.Entry<String, JsonElement> only = o.entrySet().iterator().next();
        String type = only.getKey();
        JsonElement v = only.getValue();
        String p = path + "." + type;
        return switch (type) {
            case "byte" -> ByteTag.valueOf((byte) integerIn(v, Byte.MIN_VALUE, Byte.MAX_VALUE, p));
            case "short" -> ShortTag.valueOf((short) integerIn(v, Short.MIN_VALUE, Short.MAX_VALUE, p));
            case "int" -> IntTag.valueOf(integer(v, p));
            case "long" -> LongTag.valueOf(longString(v, p));
            case "float" -> new FloatTag(Float.intBitsToFloat((int) hexBits(v, 8, p)));
            case "double" -> new DoubleTag(Double.longBitsToDouble(hexBits(v, 16, p)));
            case "string" -> StringTag.valueOf(string(v, p));
            case "byteArray" -> {
                JsonArray a = array(v, p);
                byte[] bytes = new byte[a.size()];
                for (int i = 0; i < bytes.length; i++) {
                    bytes[i] = (byte) integerIn(a.get(i), Byte.MIN_VALUE, Byte.MAX_VALUE, p + "[" + i + "]");
                }
                yield new ByteArrayTag(bytes);
            }
            case "intArray" -> new IntArrayTag(intArray(v, -1, p));
            case "longArray" -> {
                JsonArray a = array(v, p);
                long[] longs = new long[a.size()];
                for (int i = 0; i < longs.length; i++) {
                    longs[i] = longString(a.get(i), p + "[" + i + "]");
                }
                yield new LongArrayTag(longs);
            }
            case "list" -> {
                JsonArray a = array(v, p);
                ListTag list = new ListTag();
                for (int i = 0; i < a.size(); i++) {
                    list.add(jsonToTag(a.get(i), p + "[" + i + "]"));
                }
                yield list;
            }
            case "compound" -> {
                JsonObject c = object(v, p);
                CompoundTag compound = new CompoundTag();
                for (Map.Entry<String, JsonElement> entry : c.entrySet()) {
                    compound.put(entry.getKey(), jsonToTag(entry.getValue(), p + "." + entry.getKey()));
                }
                yield compound;
            }
            default -> throw bad(path, "unknown type " + type);
        };
    }

    private static IllegalArgumentException bad(String path, String what) {
        return new IllegalArgumentException(path + ": " + what);
    }

    private static JsonObject object(JsonElement e, String path) {
        if (e == null || !e.isJsonObject()) {
            throw bad(path, e == null ? "missing" : "must be an object");
        }
        return e.getAsJsonObject();
    }

    private static JsonArray array(JsonElement e, String path) {
        if (e == null || !e.isJsonArray()) {
            throw bad(path, e == null ? "missing" : "must be an array");
        }
        return e.getAsJsonArray();
    }

    private static String string(JsonElement e, String path) {
        if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isString()) {
            throw bad(path, e == null ? "missing" : "must be a string");
        }
        return e.getAsString();
    }

    private static long integerIn(JsonElement e, long min, long max, String path) {
        if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isNumber()) {
            throw bad(path, e == null ? "missing" : "must be a number");
        }
        long v;
        try {
            v = new BigDecimal(e.getAsJsonPrimitive().getAsString()).longValueExact();
        } catch (ArithmeticException | NumberFormatException x) {
            throw bad(path, "must be a whole number");
        }
        if (v < min || v > max) {
            throw bad(path, v + " out of range " + min + ".." + max);
        }
        return v;
    }

    private static int integer(JsonElement e, String path) {
        return (int) integerIn(e, Integer.MIN_VALUE, Integer.MAX_VALUE, path);
    }

    private static int[] intArray(JsonElement e, int n, String path) {
        JsonArray a = array(e, path);
        if (n >= 0 && a.size() != n) {
            throw bad(path, "must have " + n + " elements");
        }
        int[] v = new int[a.size()];
        for (int i = 0; i < v.length; i++) {
            v[i] = integer(a.get(i), path + "[" + i + "]");
        }
        return v;
    }

    private static long longString(JsonElement e, String path) {
        String s = string(e, path);
        long v;
        try {
            v = Long.parseLong(s);
        } catch (NumberFormatException x) {
            throw bad(path, "not a 64-bit decimal: " + s);
        }
        if (!Long.toString(v).equals(s)) {
            throw bad(path, "not written the canonical way: " + s);
        }
        return v;
    }

    private static long hexBits(JsonElement e, int digits, String path) {
        String s = string(e, path);
        if (s.length() != digits || !s.matches("[0-9a-f]+")) {
            throw bad(path, "must be " + digits + " lowercase hex digits: " + s);
        }
        return Long.parseUnsignedLong(s, 16);
    }

    // ---------------------------------------------------------------- JSON text

    /** Strict JSON parse (no comments, no trailing commas, nothing after the value). */
    static JsonElement parse(String text) {
        try {
            JsonReader reader = new JsonReader(new StringReader(text));
            reader.setStrictness(Strictness.STRICT);
            JsonElement e = JsonParser.parseReader(reader);
            if (reader.peek() != JsonToken.END_DOCUMENT) {
                throw new IllegalArgumentException("text after the JSON value");
            }
            return e;
        } catch (IOException e) {
            throw new IllegalArgumentException(e);
        }
    }

    /**
     * Pretty JSON, two-space indent, arrays of plain values on one line, LF line ends, ends with a
     * newline. Lone surrogates are always escaped; with {@code ascii} every non-ASCII char is too.
     */
    static String print(JsonElement e, boolean ascii) {
        StringBuilder sb = new StringBuilder();
        print(sb, e, "", ascii);
        return sb.append('\n').toString();
    }

    private static void print(StringBuilder sb, JsonElement e, String indent, boolean ascii) {
        if (e == null || e.isJsonNull()) {
            sb.append("null");
        } else if (e.isJsonPrimitive()) {
            JsonPrimitive p = e.getAsJsonPrimitive();
            if (p.isString()) {
                quote(sb, p.getAsString(), ascii);
            } else {
                sb.append(p.getAsString());
            }
        } else if (e.isJsonArray()) {
            JsonArray a = e.getAsJsonArray();
            if (a.isEmpty()) {
                sb.append("[]");
                return;
            }
            boolean flat = true;
            for (JsonElement x : a) {
                flat &= x.isJsonPrimitive() || x.isJsonNull();
            }
            if (flat) {
                sb.append('[');
                for (int i = 0; i < a.size(); i++) {
                    if (i > 0) {
                        sb.append(", ");
                    }
                    print(sb, a.get(i), indent, ascii);
                }
                sb.append(']');
                return;
            }
            String inner = indent + "  ";
            sb.append("[\n");
            for (int i = 0; i < a.size(); i++) {
                sb.append(inner);
                print(sb, a.get(i), inner, ascii);
                sb.append(i + 1 < a.size() ? ",\n" : "\n");
            }
            sb.append(indent).append(']');
        } else {
            JsonObject o = e.getAsJsonObject();
            if (o.isEmpty()) {
                sb.append("{}");
                return;
            }
            String inner = indent + "  ";
            sb.append("{\n");
            int i = 0;
            for (Map.Entry<String, JsonElement> entry : o.entrySet()) {
                sb.append(inner);
                quote(sb, entry.getKey(), ascii);
                sb.append(": ");
                print(sb, entry.getValue(), inner, ascii);
                sb.append(++i < o.size() ? ",\n" : "\n");
            }
            sb.append(indent).append('}');
        }
    }

    private static void quote(StringBuilder sb, String s, boolean ascii) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    boolean paired = Character.isHighSurrogate(c)
                        ? i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1))
                        : Character.isLowSurrogate(c) && i > 0 && Character.isHighSurrogate(s.charAt(i - 1));
                    boolean lone = Character.isSurrogate(c) && !paired;
                    if (c < 0x20 || c == 0x7F || lone || (ascii && c > 0x7E)) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }

    /**
     * Null if the two JSON values are equal (FORMAT.md §4: object key order ignored, arrays
     * ordered, numbers by value), else where and how they first differ.
     */
    static String firstDifference(JsonElement expected, JsonElement actual) {
        return diff(expected, actual, "$");
    }

    private static String diff(JsonElement a, JsonElement b, String path) {
        boolean aNull = a == null || a.isJsonNull();
        boolean bNull = b == null || b.isJsonNull();
        if (aNull || bNull) {
            return aNull == bNull ? null : path + ": expected " + brief(a) + ", got " + brief(b);
        }
        if (a.isJsonPrimitive() && b.isJsonPrimitive()) {
            JsonPrimitive pa = a.getAsJsonPrimitive();
            JsonPrimitive pb = b.getAsJsonPrimitive();
            boolean same;
            if (pa.isNumber() && pb.isNumber()) {
                same = new BigDecimal(pa.getAsString()).compareTo(new BigDecimal(pb.getAsString())) == 0;
            } else if (pa.isString() && pb.isString()) {
                same = pa.getAsString().equals(pb.getAsString());
            } else if (pa.isBoolean() && pb.isBoolean()) {
                same = pa.getAsBoolean() == pb.getAsBoolean();
            } else {
                same = false;
            }
            return same ? null : path + ": expected " + brief(a) + ", got " + brief(b);
        }
        if (a.isJsonArray() && b.isJsonArray()) {
            JsonArray xa = a.getAsJsonArray();
            JsonArray xb = b.getAsJsonArray();
            for (int i = 0; i < Math.min(xa.size(), xb.size()); i++) {
                String d = diff(xa.get(i), xb.get(i), path + "[" + i + "]");
                if (d != null) {
                    return d;
                }
            }
            return xa.size() == xb.size() ? null
                : path + ": expected " + xa.size() + " elements, got " + xb.size();
        }
        if (a.isJsonObject() && b.isJsonObject()) {
            JsonObject oa = a.getAsJsonObject();
            JsonObject ob = b.getAsJsonObject();
            for (String key : new TreeSet<>(oa.keySet())) {
                if (!ob.has(key)) {
                    return path + ": key \"" + key + "\" missing";
                }
                String d = diff(oa.get(key), ob.get(key), path + "." + key);
                if (d != null) {
                    return d;
                }
            }
            for (String key : new TreeSet<>(ob.keySet())) {
                if (!oa.has(key)) {
                    return path + ": unexpected key \"" + key + "\"";
                }
            }
            return null;
        }
        return path + ": expected " + brief(a) + ", got " + brief(b);
    }

    private static String brief(JsonElement e) {
        if (e == null) {
            return "nothing";
        }
        String s = print(e, true).strip();
        return s.length() > 200 ? s.substring(0, 200) + "..." : s;
    }
}
