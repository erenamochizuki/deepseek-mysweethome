package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * A dedicated server has no client classes, and loading a class that names one crashes it. The mod's
 * client-only code (the blacklist screen) is in {@code com/xiaojingyu/client/}, loaded only through the
 * {@code dist = CLIENT} entry point. This scans the compiled main classes: outside that package no class may
 * name {@code net/minecraft/client/}, {@code net/neoforged/neoforge/client/}, {@code com/mojang/blaze3d/}
 * or our own client package (class constants, descriptors, signatures all live in the constant pool).
 */
final class ClientSplitTests {
    private static final String[] CLIENT_ONLY = {
        "net/minecraft/client/", "net/neoforged/neoforge/client/", "com/mojang/blaze3d/", "com/xiaojingyu/client/"};
    private static final String CLIENT_PACKAGE = "com/xiaojingyu/client/";

    private ClientSplitTests() {
    }

    static void run(Path classesDir) throws IOException {
        List<Path> files;
        try (Stream<Path> s = Files.walk(classesDir)) {
            files = s.filter(p -> p.toString().endsWith(".class")).toList();
        }
        check(files.size() > 30, "found the compiled main classes in " + classesDir + " (" + files.size() + ")");
        int clientClasses = 0;
        boolean clientUsesClient = false;
        for (Path f : files) {
            String rel = classesDir.relativize(f).toString().replace('\\', '/');
            List<String> strings = utf8Constants(Files.readAllBytes(f));
            if (rel.startsWith(CLIENT_PACKAGE)) {
                clientClasses++;
                clientUsesClient |= strings.stream().anyMatch(s -> s.contains("net/minecraft/client/"));
                continue;
            }
            List<String> bad = strings.stream()
                .filter(s -> java.util.Arrays.stream(CLIENT_ONLY).anyMatch(s::contains)).toList();
            check(bad.isEmpty(), rel + " (loaded on dedicated servers) refers to client-only classes: " + bad);
        }
        check(clientClasses >= 2, "the client package has its classes (" + clientClasses + ")");
        check(clientUsesClient, "the scan sees client references where they are allowed (self-check)");
    }

    /** Every CONSTANT_Utf8 of a class file (JVMS §4.4). */
    static List<String> utf8Constants(byte[] bytes) throws IOException {
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(bytes));
        if (in.readInt() != 0xCAFEBABE) {
            throw new IOException("not a class file");
        }
        in.readUnsignedShort();
        in.readUnsignedShort();
        int count = in.readUnsignedShort();
        List<String> out = new ArrayList<>();
        for (int i = 1; i < count; i++) {
            int tag = in.readUnsignedByte();
            switch (tag) {
                case 1 -> out.add(in.readUTF());
                case 3, 4, 9, 10, 11, 12, 17, 18 -> in.skipBytes(4);
                case 5, 6 -> {
                    in.skipBytes(8);
                    i++;
                }
                case 7, 8, 16, 19, 20 -> in.skipBytes(2);
                case 15 -> in.skipBytes(3);
                default -> throw new IOException("unknown constant pool tag " + tag);
            }
        }
        return out;
    }
}
