package com.xiaojingyu.probe;

import com.google.gson.JsonObject;

/**
 * 接口的返回值。afterSend 在回复发出之后才执行（/quit 用：先回复，再退出）。
 */
public record Reply(int status, JsonObject body, Runnable afterSend) {
    /** 新建一个成功回复的 body，"ok":true 排在第一个。 */
    public static JsonObject newBody() {
        JsonObject o = new JsonObject();
        o.addProperty("ok", true);
        return o;
    }

    public static Reply ok(JsonObject body) {
        if (!body.has("ok")) {
            body.addProperty("ok", true);
        }
        return new Reply(200, body, null);
    }

    public static Reply okThen(JsonObject body, Runnable afterSend) {
        if (!body.has("ok")) {
            body.addProperty("ok", true);
        }
        return new Reply(200, body, afterSend);
    }

    public static Reply error(int status, String code, String message) {
        JsonObject o = new JsonObject();
        o.addProperty("ok", false);
        o.addProperty("error", code);
        o.addProperty("message", message == null ? code : message);
        return new Reply(status, o, null);
    }
}
