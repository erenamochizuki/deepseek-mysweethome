package com.xiaojingyu.blacklist;

import java.io.IOException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

import com.mojang.logging.LogUtils;

/**
 * The capture blacklist (COMMANDS.md §2a): one list for the whole game directory, shared by every world,
 * kept in {@code config/xiaojingyu-blacklist.json}. Only the server side uses it (single player: the
 * built-in server); clients get the list over the network.
 *
 * <ul>
 *   <li>Missing file = empty list (that is how it starts). The file is written on the first change.</li>
 *   <li>Before every use the file's size and time are compared with what was last read or written; if
 *       someone changed it (Notepad), it is read again, so edits count right away.</li>
 *   <li>A file that cannot be read never crashes anything: the list counts as empty and {@link
 *       Snapshot#problem()} says why. The next change first copies the bad file to
 *       {@code xiaojingyu-blacklist.json.bak}, so nothing a person wrote is lost.</li>
 *   <li>Changes are written to a temporary file that then replaces the real one. If writing fails the
 *       change is undone and the caller gets the IOException.</li>
 * </ul>
 *
 * Thread-safe (synchronized), though in practice only the server thread calls it.
 */
public final class Blacklist {
    public static final String FILE_NAME = "xiaojingyu-blacklist.json";
    public static final String BACKUP_SUFFIX = ".bak";
    private static final Logger LOGGER = LogUtils.getLogger();
    private static @Nullable Blacklist instance;

    private final Path file;
    private final LinkedHashSet<String> ids = new LinkedHashSet<>();
    private BlacklistFile.@Nullable Problem problem;
    private List<String> skipped = List.of();
    private @Nullable Stamp stamp;
    private boolean loaded;

    /** What the list looks like now. {@code ids} in file order; {@code skipped}: entries that were not ids. */
    public record Snapshot(List<String> ids, BlacklistFile.@Nullable Problem problem, List<String> skipped) {
        public Set<String> idSet() {
            return Set.copyOf(ids);
        }
    }

    /**
     * The result of a change. {@code changed}: something was added or removed; {@code size}: entries now;
     * {@code removed}: entries removed by clear; {@code backup}: where the unreadable old file was copied
     * to (null if there was none).
     */
    public record Change(boolean changed, int size, int removed, @Nullable Path backup) {
    }

    /** File size and modification time, to notice changes made outside the game. */
    private record Stamp(boolean exists, long size, long modified) {
    }

    public Blacklist(Path file) {
        this.file = file;
    }

    /** The list of this game: {@code <game dir>/config/xiaojingyu-blacklist.json}. */
    public static synchronized Blacklist get() {
        if (instance == null) {
            instance = new Blacklist(net.neoforged.fml.loading.FMLPaths.CONFIGDIR.get().resolve(FILE_NAME));
        }
        return instance;
    }

    public Path file() {
        return file;
    }

    public synchronized Snapshot snapshot() {
        refresh();
        return new Snapshot(List.copyOf(ids), problem, skipped);
    }

    /** Adds a normalized block id (BlacklistFile.normalize). Nothing changes if it is already there. */
    public synchronized Change add(String id) throws IOException {
        refresh();
        if (ids.contains(id)) {
            return new Change(false, ids.size(), 0, null);
        }
        ids.add(id);
        try {
            Path backup = save();
            return new Change(true, ids.size(), 0, backup);
        } catch (IOException e) {
            ids.remove(id);
            throw e;
        }
    }

    public synchronized Change remove(String id) throws IOException {
        refresh();
        if (!ids.contains(id)) {
            return new Change(false, ids.size(), 0, null);
        }
        List<String> before = List.copyOf(ids);
        ids.remove(id);
        try {
            Path backup = save();
            return new Change(true, ids.size(), 0, backup);
        } catch (IOException e) {
            restore(before);
            throw e;
        }
    }

    /** Empties the list. Also rewrites an unreadable file (after backing it up), so clear fixes it. */
    public synchronized Change clear() throws IOException {
        refresh();
        int n = ids.size();
        if (n == 0 && problem == null) {
            return new Change(false, 0, 0, null);
        }
        List<String> before = List.copyOf(ids);
        ids.clear();
        try {
            Path backup = save();
            return new Change(n > 0, 0, n, backup);
        } catch (IOException e) {
            restore(before);
            throw e;
        }
    }

    private void restore(List<String> before) {
        ids.clear();
        ids.addAll(before);
    }

    /** Reads the file again when it is new to us or changed since we last read or wrote it. */
    private void refresh() {
        Stamp now = stampOf(file);
        if (loaded && Objects.equals(now, stamp)) {
            return;
        }
        loaded = true;
        stamp = now;
        ids.clear();
        problem = null;
        skipped = List.of();
        if (!now.exists()) {
            return;
        }
        String text;
        try {
            text = decode(Files.readAllBytes(file));
        } catch (IOException e) {
            problem = new BlacklistFile.Problem("io", 0, 0, e.toString());
            LOGGER.warn("[xiaojingyu] capture blacklist {} could not be read, using an empty list: {}", file, e.toString());
            return;
        }
        BlacklistFile.Parsed p = BlacklistFile.parse(text);
        problem = p.problem();
        if (problem != null) {
            LOGGER.warn("[xiaojingyu] capture blacklist {} is not usable ({}), using an empty list: {}", file, problem.code(),
                problem.detail());
            return;
        }
        ids.addAll(p.ids());
        skipped = p.skipped();
        if (!skipped.isEmpty()) {
            LOGGER.warn("[xiaojingyu] capture blacklist {}: skipped {} entries that are not block ids: {}", file,
                skipped.size(), skipped);
        }
        if (p.duplicates() > 0) {
            LOGGER.info("[xiaojingyu] capture blacklist {}: {} repeated entries counted once", file, p.duplicates());
        }
        LOGGER.info("[xiaojingyu] capture blacklist read from {}: {} blocks", file, ids.size());
    }

    /** UTF-8; a file saved in the local code page (GBK) is not UTF-8, read it leniently so ASCII ids still work. */
    private static String decode(byte[] bytes) {
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    /** Writes the list; returns where an unreadable old file was copied to, or null. */
    private @Nullable Path save() throws IOException {
        Path dir = file.toAbsolutePath().getParent();
        Files.createDirectories(dir);
        Path backup = null;
        if (problem != null && Files.isRegularFile(file)) {
            backup = file.resolveSibling(file.getFileName() + BACKUP_SUFFIX);
            Files.copy(file, backup, StandardCopyOption.REPLACE_EXISTING);
            LOGGER.warn("[xiaojingyu] capture blacklist: the unreadable file was copied to {}", backup);
        }
        String text = BlacklistFile.format(new ArrayList<>(ids));
        Path tmp = Files.createTempFile(dir, FILE_NAME, ".tmp");
        try {
            Files.writeString(tmp, text, StandardCharsets.UTF_8);
            replace(tmp, text);
        } finally {
            Files.deleteIfExists(tmp);
        }
        problem = null;
        skipped = List.of();
        stamp = stampOf(file);
        LOGGER.info("[xiaojingyu] capture blacklist saved to {}: {} blocks", file, ids.size());
        return backup;
    }

    /**
     * Moves the written temporary file over the list file. On Windows the replace can be refused for a
     * moment (AccessDeniedException) while another program, e.g. a virus scanner, still has the file open
     * (seen in cmdTest, 2026-11-07); so try a few times, then write the file in place (not atomic, but the
     * file is small). A folder in the way is not retried.
     */
    private void replace(Path tmp, String text) throws IOException {
        IOException last = null;
        for (int attempt = 1; attempt <= 8; attempt++) {
            try {
                try {
                    Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException e) {
                    Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
                }
                return;
            } catch (AccessDeniedException e) {
                last = e;
                if (Files.isDirectory(file) || !pause(10L * attempt)) {
                    break;
                }
            }
        }
        if (!Files.isDirectory(file)) {
            try {
                Files.writeString(file, text, StandardCharsets.UTF_8);
                LOGGER.warn("[xiaojingyu] capture blacklist: could not replace {} ({}), wrote it in place", file, String.valueOf(last));
                return;
            } catch (IOException e) {
                last.addSuppressed(e);
            }
        }
        throw last;
    }

    private static boolean pause(long millis) {
        try {
            Thread.sleep(millis);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static Stamp stampOf(Path file) {
        try {
            BasicFileAttributes a = Files.readAttributes(file, BasicFileAttributes.class);
            return new Stamp(true, a.size(), a.lastModifiedTime().toMillis());
        } catch (IOException e) {
            return new Stamp(false, -1, 0);
        }
    }
}
