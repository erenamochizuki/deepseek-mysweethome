package com.xiaojingyu.command;

import java.io.IOException;
import java.nio.file.AccessDeniedException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.logging.LogUtils;
import com.xiaojingyu.build.FileNames;
import com.xiaojingyu.share.ShareException;
import com.xiaojingyu.share.ShareFiles;
import com.xiaojingyu.share.ShareModel;

import net.neoforged.fml.loading.FMLPaths;

/** The buildings folder {@code <game dir>/xiaojingyu/} and its files (COMMANDS.md §2, §3). */
final class BuildFiles {
    private static final Logger LOGGER = LogUtils.getLogger();
    /** Bigger files are refused without reading them (COMMANDS.md §3). */
    static final long MAX_FILE_BYTES = 64L * 1024 * 1024;

    private BuildFiles() {
    }

    static Path folder() {
        return FMLPaths.GAMEDIR.get().resolve("xiaojingyu");
    }

    /**
     * Writes a new {@code <base>.png} (or base-2, base-3 … if taken), never replacing a file:
     * temp file first, then a plain rename that fails if the target exists.
     */
    static Path saveNew(String base, byte[] bytes) throws IOException {
        Path dir = folder();
        Files.createDirectories(dir);
        Path tmp = Files.createTempFile(dir, ".capture-", ".tmp");
        try {
            Files.write(tmp, bytes);
            for (int attempt = 0; ; attempt++) {
                String name = FileNames.firstFree(base, FileNames.PNG, n -> Files.exists(dir.resolve(n)));
                Path target = dir.resolve(name);
                try {
                    return Files.move(tmp, target);
                } catch (FileAlreadyExistsException e) {
                    if (attempt >= 20) {
                        throw e;
                    }
                } catch (AccessDeniedException e) {
                    // Antivirus or the search indexer may hold a file we just wrote; try again shortly.
                    if (attempt >= 3) {
                        throw e;
                    }
                    sleepQuietly(50);
                }
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    /** The file a place argument names, or null. The argument must already pass isSafePlaceArg. */
    static @Nullable Path find(String arg) {
        return FileNames.findIn(folder(), arg);
    }

    /** Reads and decodes a building file; every failure becomes the chat message for it. */
    static ShareModel load(Path file) throws CommandSyntaxException {
        try {
            if (Files.size(file) > MAX_FILE_BYTES) {
                throw Msg.fail("share.too_large");
            }
            byte[] bytes = Files.readAllBytes(file);
            try {
                return ShareFiles.read(bytes);
            } catch (ShareException e) {
                LOGGER.info("[xiaojingyu] cannot read {}: {} ({})", file.getFileName(), e.code(), e.detail());
                throw Msg.fail(Msg.shareError(e));
            }
        } catch (IOException e) {
            LOGGER.warn("[xiaojingyu] cannot read {}", file, e);
            throw Msg.fail("place.read_failed", e.toString());
        }
    }

    /** Building files in the folder, sorted, for Tab completion. Empty if the folder is missing. */
    static List<String> list() {
        Path dir = folder();
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        List<String> names = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            s.filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS))
                .map(p -> p.getFileName().toString())
                .filter(FileNames::isBuildingFile)
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .limit(500)
                .forEach(names::add);
        } catch (IOException e) {
            LOGGER.warn("[xiaojingyu] cannot list {}", dir, e);
        }
        return names;
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
