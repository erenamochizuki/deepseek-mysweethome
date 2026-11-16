package com.xiaojingyu.probe;

/**
 * 探针自己的错误：带 HTTP 状态码和 docs/PROBE.md 里的错误码。
 * 处理请求时抛出，由 ProbeServer 统一转成 {"ok":false,"error":...,"message":...}。
 */
public final class ProbeException extends RuntimeException {
    private final int status;
    private final String code;

    public ProbeException(int status, String code, String message) {
        // 这是正常的控制流，不需要栈。
        super(message, null, false, false);
        this.status = status;
        this.code = code;
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    public static ProbeException badRequest(String message) {
        return new ProbeException(400, "bad_request", message);
    }

    public static ProbeException tooLarge(String message) {
        return new ProbeException(400, "too_large", message);
    }

    public static ProbeException unauthorized(String message) {
        return new ProbeException(401, "unauthorized", message);
    }

    public static ProbeException forbidden(String message) {
        return new ProbeException(403, "forbidden", message);
    }

    public static ProbeException notFound(String message) {
        return new ProbeException(404, "not_found", message);
    }

    public static ProbeException methodNotAllowed(String message) {
        return new ProbeException(405, "method_not_allowed", message);
    }

    public static ProbeException busy(String message) {
        return new ProbeException(409, "busy", message);
    }

    public static ProbeException notInWorld(String message) {
        return new ProbeException(409, "not_in_world", message);
    }

    public static ProbeException chunkNotLoaded(String message) {
        return new ProbeException(409, "chunk_not_loaded", message);
    }

    public static ProbeException timeout(String message) {
        return new ProbeException(504, "timeout", message);
    }

    public static ProbeException internal(String message) {
        return new ProbeException(500, "internal", message);
    }
}
