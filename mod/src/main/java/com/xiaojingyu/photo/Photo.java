package com.xiaojingyu.photo;

import java.util.ArrayList;
import java.util.List;

import com.mojang.logging.LogUtils;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

/**
 * One photo as stored in NBT (docs/PHOTOS.md §1): a compound with {@code Id}, {@code Png} and the optional
 * {@code Name} and {@code Added}. Only photos that pass {@link Photos#problem} become a Photo; the compound is
 * kept whole (with any other keys) so a photo copied from the album into a frame is the same data.
 * Immutable: never change {@link #tag()} or {@link #png()}.
 */
public final class Photo {
    private static final Logger LOGGER = LogUtils.getLogger();

    private final CompoundTag tag;
    private final String id;
    private final byte[] png;
    private final String name;
    /** SHA-1 Id of the bytes, worked out when first needed (the client keys its textures by it). */
    private volatile @Nullable String hash;

    private Photo(CompoundTag tag, String id, byte[] png, String name) {
        this.tag = tag;
        this.id = id;
        this.png = png;
        this.name = name;
    }

    /**
     * Reads one photo. An empty compound (an empty slot) and null give null quietly; anything else that is not a
     * usable photo gives null and one log line naming {@code where}. A missing or empty Id is worked out from the
     * PNG bytes (the stored compound stays as it was).
     */
    public static @Nullable Photo read(@Nullable Tag t, String where) {
        if (t == null || t instanceof CompoundTag c && c.isEmpty()) {
            return null;
        }
        if (!(t instanceof CompoundTag c)) {
            LOGGER.warn("[xiaojingyu] {}: photo skipped (not a compound)", where);
            return null;
        }
        byte[] png = c.getByteArray("Png").orElse(null);
        Photos.Problem problem = Photos.problem(png);
        if (problem != null) {
            String size = png == null ? "" : png.length + " bytes"
                + (problem == Photos.Problem.WRONG_SIZE ? ", " + Photos.width(png) + "×" + Photos.height(png) : "");
            LOGGER.warn("[xiaojingyu] {}: photo {} skipped ({}{})", where, c.getStringOr("Id", "?"),
                problem.name().toLowerCase(java.util.Locale.ROOT), size.isEmpty() ? "" : ", " + size);
            return null;
        }
        String id = c.getStringOr("Id", "");
        if (id.isBlank()) {
            id = Photos.id(png);
        }
        return new Photo(c, id, png, c.getStringOr("Name", ""));
    }

    /**
     * The usable photos of a list (an album): bad ones are skipped (logged), at most {@code max} are read
     * (one log line if there are more). Null or a tag that is not a list gives an empty list.
     */
    public static List<Photo> readList(@Nullable Tag t, int max, String where) {
        if (t == null) {
            return List.of();
        }
        if (!(t instanceof ListTag list)) {
            LOGGER.warn("[xiaojingyu] {}: photo list skipped (not a list)", where);
            return List.of();
        }
        if (list.size() > max) {
            LOGGER.warn("[xiaojingyu] {}: {} photos, only the first {} are used", where, list.size(), max);
        }
        List<Photo> out = new ArrayList<>();
        for (int i = 0; i < Math.min(max, list.size()); i++) {
            Photo p = read(list.get(i), where + " #" + i);
            if (p != null) {
                out.add(p);
            }
        }
        return List.copyOf(out);
    }

    /** The stored compound (Id, Png, Name, Added, …). Do not change it; copy it to store it elsewhere. */
    public CompoundTag tag() {
        return tag;
    }

    /** The Id: the stored one, or worked out from the bytes when none was stored. */
    public String id() {
        return id;
    }

    /** The PNG bytes (checked: signature, 128 × 128, ≤ 48 KB). Do not change them. */
    public byte[] png() {
        return png;
    }

    /** The name, or "" if it has none. */
    public String name() {
        return name;
    }

    /** What the client gets: only Id and Png. */
    public CompoundTag syncTag() {
        CompoundTag t = new CompoundTag();
        t.putString("Id", id);
        t.putByteArray("Png", png);
        return t;
    }

    /** SHA-1 Id of the actual bytes (same as {@link #id()} for photos made by the web page). */
    public String hash() {
        String h = hash;
        if (h == null) {
            h = Photos.id(png);
            hash = h;
        }
        return h;
    }
}
