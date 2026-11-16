package com.xiaojingyu.probe;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jspecify.annotations.Nullable;

/**
 * 探针的 HTTP 服务（docs/PROBE.md「接口约定（v1）」）。
 * 只听 127.0.0.1；一个线程按顺序处理请求，处理完一个才接下一个。
 */
final class ProbeServer {
    static final int MAX_BODY_BYTES = 64 * 1024;
    private static final Gson GSON = new GsonBuilder().serializeNulls().disableHtmlEscaping().create();

    @FunctionalInterface
    interface Handler {
        Reply handle(ProbeRequest req);
    }

    /** beforeReady：主菜单出现之前也能调（/status 和 /quit）。 */
    private record Route(String method, Handler handler, boolean beforeReady) {
    }

    // 12 条，超过 Map.of 的 10 对，用 Map.ofEntries。
    private static final Map<String, Route> ROUTES = Map.ofEntries(
            Map.entry("/status", new Route("GET", ClientEndpoints::status, true)),
            Map.entry("/world/open", new Route("POST", ClientEndpoints::worldOpen, false)),
            Map.entry("/world/reopen", new Route("POST", ClientEndpoints::worldReopen, false)),
            Map.entry("/pick", new Route("POST", ServerEndpoints::pick, false)),
            Map.entry("/world/leave", new Route("POST", ClientEndpoints::worldLeave, false)),
            Map.entry("/command", new Route("POST", ServerEndpoints::command, false)),
            Map.entry("/block", new Route("GET", ServerEndpoints::block, false)),
            Map.entry("/use", new Route("POST", ServerEndpoints::use, false)),
            Map.entry("/region", new Route("POST", ServerEndpoints::region, false)),
            Map.entry("/shapes", new Route("POST", ServerEndpoints::shapes, false)),
            Map.entry("/screenshot", new Route("POST", ClientEndpoints::screenshot, false)),
            Map.entry("/screen", new Route("POST", ScreenEndpoints::screen, false)),
            Map.entry("/input", new Route("POST", InputLock::input, true)),
            Map.entry("/quit", new Route("POST", ClientEndpoints::quit, true)));

    private final HttpServer http;
    private final ExecutorService executor;
    private final String token;
    private final byte[] tokenBytes;
    private final Path infoFile;
    private final AtomicBoolean stopped = new AtomicBoolean();

    private ProbeServer(HttpServer http, ExecutorService executor, String token, Path infoFile) {
        this.http = http;
        this.executor = executor;
        this.token = token;
        this.tokenBytes = token.getBytes(StandardCharsets.UTF_8);
        this.infoFile = infoFile;
    }

    /** 起服务，然后写 xjyprobe.json（文件出现时端口已经在听了）。port=0 表示随机端口。 */
    static ProbeServer start(int port, Path infoFile) throws IOException {
        byte[] raw = new byte[32];
        new SecureRandom().nextBytes(raw);
        String token = HexFormat.of().formatHex(raw);

        InetAddress loopback = InetAddress.getByAddress(new byte[] {127, 0, 0, 1});
        HttpServer http = HttpServer.create(new InetSocketAddress(loopback, port), 0);
        ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "xjyprobe-http");
            t.setDaemon(true);
            return t;
        });
        http.setExecutor(executor);
        ProbeServer s = new ProbeServer(http, executor, token, infoFile.toAbsolutePath().normalize());
        http.createContext("/", s::handle);
        http.start();
        try {
            s.writeInfoFile();
        } catch (IOException | RuntimeException e) {
            s.stop(false);
            throw e;
        }
        return s;
    }

    int port() {
        return http.getAddress().getPort();
    }

    Path infoFile() {
        return infoFile;
    }

    private void writeInfoFile() throws IOException {
        JsonObject o = new JsonObject();
        o.addProperty("v", 1);
        o.addProperty("port", port());
        o.addProperty("token", token);
        o.addProperty("pid", ProcessHandle.current().pid());
        o.addProperty("startedAt", OffsetDateTime.now().truncatedTo(ChronoUnit.SECONDS)
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
        Files.createDirectories(infoFile.getParent());
        // 先写临时文件再改名，runner 不会读到写了一半的文件。
        Path tmp = infoFile.resolveSibling(infoFile.getFileName() + ".tmp");
        Files.writeString(tmp, GSON.toJson(o) + "\n", StandardCharsets.UTF_8);
        try {
            Files.move(tmp, infoFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, infoFile, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /**
     * 关服务、删 xjyprobe.json（只删还是自己 token 的那份）。可以重复调用，只有第一次生效。
     * 正常退出时在 Render thread 上调（GameShuttingDownEvent），JVM shutdown hook 里再兜底调一次（log=false）。
     */
    void stop(boolean log) {
        if (!stopped.compareAndSet(false, true)) {
            return;
        }
        try {
            if (Files.isRegularFile(infoFile) && Files.readString(infoFile, StandardCharsets.UTF_8).contains(token)) {
                Files.deleteIfExists(infoFile);
            }
        } catch (IOException | RuntimeException e) {
            if (log) {
                ProbeMod.LOGGER.warn("[xjyprobe] could not delete {}: {}", infoFile, e.toString());
            }
        }
        try {
            http.stop(0);
        } catch (RuntimeException e) {
            if (log) {
                ProbeMod.LOGGER.warn("[xjyprobe] stopping the HTTP server failed: {}", e.toString());
            }
        }
        executor.shutdownNow();
        if (log) {
            ProbeMod.LOGGER.info("[xjyprobe] HTTP server stopped");
        }
    }

    // ---------------------------------------------------------------- 请求处理（在 xjyprobe-http 线程上）

    private void handle(HttpExchange ex) {
        long t0 = System.nanoTime();
        String path = ex.getRequestURI().getRawPath();
        String allow = null;
        Reply reply;
        try {
            checkOriginAndHost(ex);
            checkToken(ex);
            Route route = ROUTES.get(path);
            if (route == null) {
                throw ProbeException.notFound("no such endpoint: " + path);
            }
            if (!route.method().equals(ex.getRequestMethod())) {
                allow = route.method();
                throw ProbeException.methodNotAllowed(path + " only accepts " + route.method());
            }
            JsonObject body = route.method().equals("POST") ? readBody(ex) : new JsonObject();
            Map<String, String> query = parseQuery(ex.getRequestURI().getRawQuery());
            if (!route.beforeReady() && !ProbeSnapshot.current().ready()) {
                throw ProbeException.busy("the game is not ready yet (title screen has not appeared)");
            }
            reply = route.handler().handle(new ProbeRequest(path, query, body));
        } catch (ProbeException e) {
            reply = Reply.error(e.status(), e.code(), e.getMessage());
        } catch (Throwable t) {
            ProbeMod.LOGGER.error("[xjyprobe] {} {} failed", ex.getRequestMethod(), path, t);
            reply = Reply.error(500, "internal", String.valueOf(t));
        }
        send(ex, reply, allow);
        if (!"/status".equals(path)) {
            ProbeMod.LOGGER.info("[xjyprobe] {} {} -> {} ({} ms)", ex.getRequestMethod(), path, reply.status(),
                    (System.nanoTime() - t0) / 1_000_000L);
        }
        Runnable after = reply.afterSend();
        if (after != null) {
            try {
                after.run();
            } catch (Throwable t) {
                ProbeMod.LOGGER.error("[xjyprobe] after-send action for {} failed", path, t);
            }
        }
    }

    private void checkOriginAndHost(HttpExchange ex) {
        if (ex.getRequestHeaders().containsKey("Origin")) {
            throw ProbeException.forbidden("requests with an Origin header are refused");
        }
        String host = ex.getRequestHeaders().getFirst("Host");
        int port = port();
        if (host == null
                || !(host.equalsIgnoreCase("127.0.0.1:" + port) || host.equalsIgnoreCase("localhost:" + port))) {
            throw ProbeException.forbidden("Host must be 127.0.0.1:" + port + " or localhost:" + port);
        }
    }

    private void checkToken(HttpExchange ex) {
        String auth = ex.getRequestHeaders().getFirst("Authorization");
        String prefix = "Bearer ";
        if (auth == null || auth.length() <= prefix.length()
                || !auth.regionMatches(true, 0, prefix, 0, prefix.length())) {
            throw ProbeException.unauthorized("missing 'Authorization: Bearer <token>' (token is in xjyprobe.json)");
        }
        byte[] given = auth.substring(prefix.length()).strip().getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(given, tokenBytes)) {
            throw ProbeException.unauthorized("wrong token");
        }
    }

    private static JsonObject readBody(HttpExchange ex) throws IOException {
        String len = ex.getRequestHeaders().getFirst("Content-Length");
        if (len != null) {
            long n;
            try {
                n = Long.parseLong(len.strip());
            } catch (NumberFormatException e) {
                throw ProbeException.badRequest("bad Content-Length");
            }
            if (n > MAX_BODY_BYTES) {
                throw ProbeException.tooLarge("request body is larger than " + MAX_BODY_BYTES + " bytes");
            }
        }
        byte[] bytes;
        try (InputStream in = ex.getRequestBody()) {
            bytes = in.readNBytes(MAX_BODY_BYTES + 1);
        }
        if (bytes.length > MAX_BODY_BYTES) {
            throw ProbeException.tooLarge("request body is larger than " + MAX_BODY_BYTES + " bytes");
        }
        String text = new String(bytes, StandardCharsets.UTF_8).strip();
        if (text.isEmpty()) {
            return new JsonObject();
        }
        JsonElement e;
        try {
            e = JsonParser.parseString(text);
        } catch (JsonParseException | IllegalStateException x) {
            throw ProbeException.badRequest("body is not valid JSON: " + x.getMessage());
        }
        if (!e.isJsonObject()) {
            throw ProbeException.badRequest("body must be a JSON object");
        }
        return e.getAsJsonObject();
    }

    private static Map<String, String> parseQuery(@Nullable String raw) {
        Map<String, String> m = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) {
            return m;
        }
        for (String part : raw.split("&")) {
            if (part.isEmpty()) {
                continue;
            }
            int eq = part.indexOf('=');
            String k = eq < 0 ? part : part.substring(0, eq);
            String v = eq < 0 ? "" : part.substring(eq + 1);
            try {
                m.put(URLDecoder.decode(k, StandardCharsets.UTF_8), URLDecoder.decode(v, StandardCharsets.UTF_8));
            } catch (IllegalArgumentException e) {
                throw ProbeException.badRequest("bad query string");
            }
        }
        return m;
    }

    private static void send(HttpExchange ex, Reply reply, @Nullable String allow) {
        byte[] bytes = GSON.toJson(reply.body()).getBytes(StandardCharsets.UTF_8);
        try {
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            ex.getResponseHeaders().set("Cache-Control", "no-store");
            if (allow != null) {
                ex.getResponseHeaders().set("Allow", allow);
            }
            ex.sendResponseHeaders(reply.status(), bytes.length);
            try (OutputStream out = ex.getResponseBody()) {
                out.write(bytes);
            }
        } catch (IOException e) {
            ProbeMod.LOGGER.warn("[xjyprobe] could not send the reply: {}", e.toString());
        } finally {
            ex.close();
        }
    }
}
