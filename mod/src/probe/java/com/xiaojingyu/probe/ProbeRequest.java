package com.xiaojingyu.probe;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.util.Map;
import net.minecraft.core.BlockPos;
import org.jspecify.annotations.Nullable;

/**
 * 一次已经通过安全检查的请求。参数先看 JSON 请求体，再看查询串（?x=1）。
 * 整数参数必须是整数：1.5 回 400，不会被悄悄截成 1。
 */
public final class ProbeRequest {
    private final String path;
    private final Map<String, String> query;
    private final JsonObject body;

    ProbeRequest(String path, Map<String, String> query, JsonObject body) {
        this.path = path;
        this.query = query;
        this.body = body;
    }

    public String path() {
        return path;
    }

    /** 取原始参数：请求体优先，其次查询串。没有（或是 null）就返回 null。 */
    private @Nullable JsonElement raw(String name) {
        JsonElement e = body.get(name);
        if (e != null && !e.isJsonNull()) {
            return e;
        }
        String q = query.get(name);
        return q == null ? null : new JsonPrimitive(q);
    }

    public boolean has(String name) {
        return raw(name) != null;
    }

    public @Nullable String string(String name, @Nullable String def) {
        JsonElement e = raw(name);
        if (e == null) {
            return def;
        }
        if (!e.isJsonPrimitive()) {
            throw ProbeException.badRequest("parameter '" + name + "' must be a string");
        }
        return e.getAsString();
    }

    public String requireString(String name) {
        String s = string(name, null);
        if (s == null || s.isBlank()) {
            throw ProbeException.badRequest("missing parameter '" + name + "'");
        }
        return s;
    }

    /**
     * 布尔参数：请求体里必须是 JSON 的 true / false（写成 null、字符串、数字都回 400），
     * 查询串里只认 "true" / "false"。没给就用 def。
     */
    public boolean bool(String name, boolean def) {
        JsonElement e = body.get(name);
        if (e != null) {
            if (e.isJsonPrimitive() && e.getAsJsonPrimitive().isBoolean()) {
                return e.getAsBoolean();
            }
            throw ProbeException.badRequest("parameter '" + name + "' must be true or false");
        }
        String q = query.get(name);
        if (q == null) {
            return def;
        }
        if (q.equals("true") || q.equals("false")) {
            return q.equals("true");
        }
        throw ProbeException.badRequest("parameter '" + name + "' must be true or false");
    }

    /** 必填的布尔参数：没写回 400；写了按 {@link #bool} 的规矩（null、字符串、数字都回 400）。 */
    public boolean requireBool(String name) {
        if (!body.has(name) && !query.containsKey(name)) {
            throw ProbeException.badRequest("missing parameter '" + name + "' (true or false)");
        }
        return bool(name, false);
    }

    /** 整数参数（JSON 数字或数字字符串）。不是整数回 400。 */
    public long number(String name, long def) {
        JsonElement e = raw(name);
        if (e == null) {
            return def;
        }
        try {
            return exactLong(e);
        } catch (RuntimeException ex) {
            throw ProbeException.badRequest("parameter '" + name + "' must be an integer");
        }
    }

    public int requireInt(String name) {
        if (!has(name)) {
            throw ProbeException.badRequest("missing parameter '" + name + "'");
        }
        long v = number(name, 0);
        if (v < Integer.MIN_VALUE || v > Integer.MAX_VALUE) {
            throw ProbeException.badRequest("parameter '" + name + "' out of range");
        }
        return (int) v;
    }

    /** 坐标：x/y/z 三个参数（GET /block 用）。 */
    public BlockPos pos() {
        return new BlockPos(requireInt("x"), requireInt("y"), requireInt("z"));
    }

    /** 坐标：一个参数，写成 [x,y,z] 或 {"x":..,"y":..,"z":..}，都必须是整数。 */
    public BlockPos pos(String name) {
        JsonElement e = body.get(name);
        if (e == null || e.isJsonNull()) {
            throw ProbeException.badRequest("missing parameter '" + name + "'");
        }
        try {
            if (e.isJsonArray()) {
                JsonArray a = e.getAsJsonArray();
                if (a.size() == 3) {
                    return new BlockPos(exactInt(a.get(0)), exactInt(a.get(1)), exactInt(a.get(2)));
                }
            } else if (e.isJsonObject()) {
                JsonObject o = e.getAsJsonObject();
                return new BlockPos(exactInt(o.get("x")), exactInt(o.get("y")), exactInt(o.get("z")));
            }
        } catch (RuntimeException ignored) {
            // 落到下面统一报错
        }
        throw ProbeException.badRequest("parameter '" + name + "' must be [x,y,z] or {x,y,z} integers");
    }

    /** 小数列表参数，写成 [a,b,c]（正好 n 个有限的数字）。没写返回 null，写错回 400。 */
    public double @Nullable [] doubles(String name, int n) {
        JsonElement e = body.get(name);
        if (e == null || e.isJsonNull()) {
            return null;
        }
        if (e.isJsonArray() && e.getAsJsonArray().size() == n) {
            double[] out = new double[n];
            JsonArray a = e.getAsJsonArray();
            boolean ok = true;
            for (int i = 0; i < n && ok; i++) {
                JsonElement v = a.get(i);
                ok = v.isJsonPrimitive() && v.getAsJsonPrimitive().isNumber() && Double.isFinite(v.getAsDouble());
                out[i] = ok ? v.getAsDouble() : 0;
            }
            if (ok) {
                return out;
            }
        }
        throw ProbeException.badRequest("parameter '" + name + "' must be [" + n + " numbers]");
    }

    private static long exactLong(JsonElement e) {
        JsonPrimitive p = e.getAsJsonPrimitive(); // 不是基本类型会抛 IllegalStateException
        if (p.isNumber()) {
            return p.getAsBigDecimal().longValueExact(); // 1.5 抛 ArithmeticException，1.0 可以
        }
        if (p.isString()) {
            return Long.parseLong(p.getAsString().trim());
        }
        throw new IllegalArgumentException("not a number");
    }

    private static int exactInt(JsonElement e) {
        if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("not a number");
        }
        return e.getAsJsonPrimitive().getAsBigDecimal().intValueExact();
    }
}
