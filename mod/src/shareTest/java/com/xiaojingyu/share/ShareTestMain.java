package com.xiaojingyu.share;

import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Plain main for the share-format checks (docs/FORMAT.md). Run through Gradle:
 * <pre>
 *   gradlew shareTest [-Prequire-cross]   test --fixtures DIR --format-doc FILE [--require-cross]
 *   gradlew shareFixtures                 fixtures --fixtures DIR
 *   gradlew shareDump -Pfile=F [-Pout=O]  dump --file F [--out O]
 * </pre>
 * Console output is ASCII only (other characters as \\uXXXX) so it reads the same under any code page.
 * Exit code: 0 ok, 1 a check failed, 2 bad command line.
 */
public final class ShareTestMain {
    private ShareTestMain() {
    }

    public static void main(String[] args) {
        int code;
        try {
            code = run(args);
        } catch (UsageException e) {
            System.err.println("usage error: " + e.getMessage());
            System.err.println("usage: test --fixtures DIR [--format-doc FILE] [--require-cross]");
            System.err.println("       fixtures --fixtures DIR");
            System.err.println("       dump --file FILE [--out FILE]");
            code = 2;
        } catch (Exception e) {
            System.err.println(TestKit.ascii(TestKit.stackTrace(e)));
            code = 1;
        }
        System.out.flush();
        System.exit(code);
    }

    private static int run(String[] args) throws Exception {
        if (args.length == 0) {
            throw new UsageException("no command");
        }
        Options o = new Options(args);
        return switch (args[0]) {
            case "test" -> test(o.only("--fixtures", "--format-doc", "--require-cross"));
            case "fixtures" -> fixtures(o.only("--fixtures"));
            case "dump" -> dump(o.only("--file", "--out"));
            default -> throw new UsageException("unknown command " + args[0]);
        };
    }

    private static int test(Options o) throws UsageException {
        long start = System.nanoTime();
        TestKit t = new TestKit();
        Path fixtures = o.path("--fixtures");
        boolean requireCross = o.flag("--require-cross");
        t.note("fixtures: " + fixtures + (requireCross ? "  (--require-cross: missing cross-read files fail)" : ""));
        ShareNbtTests.run(t);
        ShareTagTests.run(t);
        SharePngTests.run(t);
        ShareCodecTests.run(t, o.pathOrNull("--format-doc"));
        ShareFixtureTests.run(t, fixtures, requireCross);
        return t.finish(start);
    }

    private static int fixtures(Options o) throws Exception {
        return ShareFixtureTests.writeFixtures(o.path("--fixtures"));
    }

    /** Prints {"dump": …} or {"error": "code"}: the same shape as odd/*.expect.json. */
    private static int dump(Options o) throws IOException, UsageException {
        Path file = o.path("--file");
        byte[] bytes = Files.readAllBytes(file);
        JsonObject result = new JsonObject();
        try {
            result.add("dump", ShareDump.dump(ShareFiles.read(bytes)));
        } catch (ShareException e) {
            result.add("error", new JsonPrimitive(e.code()));
            System.err.println(TestKit.ascii(e.code() + ": " + e.detail()));
        }
        if (o.has("--out")) {
            Path out = o.path("--out");
            Files.writeString(out, ShareDump.print(result, false), StandardCharsets.UTF_8);
            System.out.println("wrote " + out);
        } else {
            System.out.print(ShareDump.print(result, true));
        }
        return 0;
    }

    static final class UsageException extends Exception {
        UsageException(String message) {
            super(message);
        }
    }

    /** --name VALUE options and --flag switches after the command word. */
    private static final class Options {
        private static final Set<String> FLAGS = Set.of("--require-cross");
        private final Map<String, String> values = new HashMap<>();

        Options(String[] args) throws UsageException {
            for (int i = 1; i < args.length; i++) {
                String key = args[i];
                if (!key.startsWith("--")) {
                    throw new UsageException("unexpected " + key);
                }
                if (FLAGS.contains(key)) {
                    values.put(key, "");
                } else if (i + 1 < args.length) {
                    values.put(key, args[++i]);
                } else {
                    throw new UsageException(key + " needs a value");
                }
            }
        }

        Options only(String... allowed) throws UsageException {
            Set<String> ok = Set.of(allowed);
            for (String key : values.keySet()) {
                if (!ok.contains(key)) {
                    throw new UsageException("option " + key + " does not fit this command");
                }
            }
            return this;
        }

        boolean has(String key) {
            return values.containsKey(key) && !values.get(key).isEmpty();
        }

        boolean flag(String key) {
            return values.containsKey(key);
        }

        Path path(String key) throws UsageException {
            if (!has(key)) {
                throw new UsageException(key + " is required");
            }
            return Path.of(values.get(key)).toAbsolutePath().normalize();
        }

        Path pathOrNull(String key) throws UsageException {
            return has(key) ? path(key) : null;
        }
    }
}
