package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.xiaojingyu.share.ShareException;

/** The translation files (COMMANDS.md §6): same keys in both, every key the code uses exists, FORMAT.md §5 texts. */
final class LangTests {
    private static final String PREFIX = "xiaojingyu.command.";
    private static final Pattern CALL = Pattern.compile("\\bMsg\\.(t|fail)\\(");
    private static final Pattern LITERAL = Pattern.compile("\"((?:[^\"\\\\]|\\\\.)*)\"");
    private static final Pattern KEY = Pattern.compile("[a-z_]+\\.[a-z_.]+");
    private static final Pattern ROW = Pattern.compile("^\\| `([a-z_]+)` \\| [^|]* \\| (.*) \\|$");
    private static final Pattern PLACEHOLDER = Pattern.compile("%(?:%|s|\\d+\\$s)");

    private LangTests() {
    }

    static void run(Path langDir, Path srcDir, Path formatDoc) throws Exception {
        Map<String, String> zh = load(langDir.resolve("zh_cn.json"));
        Map<String, String> en = load(langDir.resolve("en_us.json"));
        eq(new TreeSet<>(zh.keySet()), new TreeSet<>(en.keySet()), "zh_cn and en_us have the same keys");
        eq(zh.size(), en.size(), "zh_cn and en_us have the same number of keys");

        TreeSet<String> used = usedKeys(srcDir);
        check(used.size() > 25, "found the keys the code uses (" + used.size() + ")");
        List<String> codes = shareCodes();
        for (String code : codes) {
            used.add("share." + code);
        }
        used.add("share.unknown");
        for (String key : used) {
            check(zh.containsKey(PREFIX + key), "zh_cn has " + PREFIX + key);
            check(en.containsKey(PREFIX + key), "en_us has " + PREFIX + key);
        }
        for (String key : zh.keySet()) {
            if (key.startsWith(PREFIX)) {
                check(used.contains(key.substring(PREFIX.length())), key + " is used by the code");
            }
        }
        placeholders(zh, "zh_cn");
        placeholders(en, "en_us");
        formatTable(zh, formatDoc, codes);
        check(zh.getOrDefault(PREFIX + "share.no_data", "").contains("原图"), "zh_cn no_data asks for the original picture (原图)");
    }

    /** Gson refuses repeated keys in a map, so a key written twice fails here too. */
    private static Map<String, String> load(Path file) throws IOException {
        String text = Files.readString(file, StandardCharsets.UTF_8);
        return new Gson().fromJson(text, new TypeToken<LinkedHashMap<String, String>>() { }.getType());
    }

    /** Every string literal that looks like a key inside a Msg.t(…) or Msg.fail(…) call (both sides of a ?:). */
    private static TreeSet<String> usedKeys(Path srcDir) throws IOException {
        TreeSet<String> keys = new TreeSet<>();
        List<Path> files;
        try (Stream<Path> s = Files.walk(srcDir)) {
            files = s.filter(p -> p.toString().endsWith(".java")).toList();
        }
        for (Path file : files) {
            String text = Files.readString(file, StandardCharsets.UTF_8);
            Matcher call = CALL.matcher(text);
            while (call.find()) {
                int depth = 1;
                int i = call.end();
                while (i < text.length() && depth > 0) {
                    char c = text.charAt(i);
                    if (c == '"') {
                        Matcher lit = LITERAL.matcher(text).region(i, text.length());
                        if (!lit.lookingAt()) {
                            break;
                        }
                        if (KEY.matcher(lit.group(1)).matches()) {
                            keys.add(lit.group(1));
                        }
                        i = lit.end();
                        continue;
                    }
                    depth += c == '(' ? 1 : c == ')' ? -1 : 0;
                    i++;
                }
            }
        }
        return keys;
    }

    /** The error codes: ShareException's public static final String fields. */
    private static List<String> shareCodes() throws IllegalAccessException {
        List<String> codes = new ArrayList<>();
        for (Field f : ShareException.class.getFields()) {
            int m = f.getModifiers();
            if (Modifier.isStatic(m) && Modifier.isFinal(m) && f.getType() == String.class) {
                codes.add((String) f.get(null));
            }
        }
        eq(10, codes.size(), "ShareException has 10 codes");
        return codes;
    }

    /** Minecraft only understands %s, %1$s … and %% in translations; anything else shows the raw key. */
    private static void placeholders(Map<String, String> lang, String name) {
        for (Map.Entry<String, String> e : lang.entrySet()) {
            String v = e.getValue();
            int bad = 0;
            for (int i = v.indexOf('%'); i >= 0; i = v.indexOf('%', i)) {
                Matcher m = PLACEHOLDER.matcher(v).region(i, v.length());
                if (m.lookingAt()) {
                    i = m.end();
                } else {
                    bad++;
                    i++;
                }
            }
            check(bad == 0, name + " " + e.getKey() + ": only %s, %1$s and %% placeholders");
        }
    }

    /** zh_cn share.<code> are the texts of FORMAT.md §5 (N and the "where" part are arguments). */
    private static void formatTable(Map<String, String> zh, Path formatDoc, List<String> codes) throws IOException {
        Map<String, String> table = new LinkedHashMap<>();
        boolean inTable = false;
        for (String line : Files.readAllLines(formatDoc, StandardCharsets.UTF_8)) {
            if (line.startsWith("| 代码 |")) {
                inTable = true;
            } else if (inTable && line.isBlank()) {
                break;
            }
            Matcher row = ROW.matcher(line);
            if (inTable && row.matches()) {
                table.put(row.group(1), row.group(2).strip());
            }
        }
        eq(new TreeSet<>(codes), new TreeSet<>(table.keySet()), "FORMAT.md §5 lists the ShareException codes");
        for (Map.Entry<String, String> e : table.entrySet()) {
            String code = e.getKey();
            String text = zh.getOrDefault(PREFIX + "share." + code, "");
            switch (code) {
                case "unsupported_version" -> eq(e.getValue().replace("第 N 版", "第 %1$s 版"), text, "zh_cn share." + code);
                case "bad_schematic" -> check(text.startsWith("方块数据不完整：%1$s"), "zh_cn share.bad_schematic says where");
                default -> eq(e.getValue(), text, "zh_cn share." + code + " is the FORMAT.md §5 text");
            }
        }
    }
}
