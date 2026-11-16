package com.xiaojingyu.photo;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.ExtraCodecs;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import org.jspecify.annotations.Nullable;

/** Immutable, world-wide album snapshots. Items carry only the hash, never PNG bytes. */
public final class AlbumSnapshot extends SavedData {
    public static final Codec<String> REFERENCE_CODEC = Codec.STRING.validate(id -> validReference(id)
        ? DataResult.success(id) : DataResult.error(() -> "Invalid album reference"));
    public static final Codec<AlbumSnapshot> CODEC = ExtraCodecs.NBT.fieldOf("Album")
        .xmap(AlbumSnapshot::new, snapshot -> snapshot.album.copy()).codec();

    private final Tag album;

    public AlbumSnapshot(Tag album) {
        this.album = album.copy();
    }

    /** A new copy on every placement: editing one table never changes another table or its item. */
    public Tag copyAlbum() {
        return album.copy();
    }

    public static boolean validReference(String id) {
        return id.matches("[0-9a-f]{64}");
    }

    public static SavedDataType<AlbumSnapshot> type(String id) {
        if (!validReference(id)) {
            throw new IllegalArgumentException("Invalid album reference");
        }
        return new SavedDataType<>(Identifier.fromNamespaceAndPath("xiaojingyu", "albums/" + id),
            () -> { throw new IllegalStateException("Album snapshots must not be created for missing references"); }, CODEC);
    }

    /** SHA-256 of the entire raw Album, including order, metadata and unreadable entries. */
    public String reference() {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            writeCanonical(album, new DataOutputStream(bytes));
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Could not encode album snapshot", e);
        }
    }

    private static void writeCanonical(Tag tag, DataOutputStream out) throws IOException {
        out.writeByte(tag.getId());
        if (tag instanceof CompoundTag compound) {
            out.writeInt(compound.size());
            for (String key : compound.keySet().stream().sorted().toList()) {
                out.writeUTF(key);
                writeCanonical(compound.get(key), out);
            }
        } else if (tag instanceof net.minecraft.nbt.ListTag list) {
            out.writeInt(list.size());
            for (Tag entry : list) {
                writeCanonical(entry, out);
            }
        } else {
            tag.write(out);
        }
    }

    public static String store(ServerLevel level, Tag album) {
        return store(level.getServer().overworld().getDataStorage(), album);
    }

    /** Storage overload also permits cache behavior to be verified without a running Minecraft server. */
    public static String store(net.minecraft.world.level.storage.SavedDataStorage storage, Tag album) {
        AlbumSnapshot snapshot = new AlbumSnapshot(album);
        String id = snapshot.reference();
        AlbumSnapshot existing = storage.get(type(id));
        if (existing == null || !existing.reference().equals(id)) {
            storage.set(type(id), snapshot);
        }
        return id;
    }

    public static @Nullable AlbumSnapshot find(ServerLevel level, String id) {
        if (!validReference(id)) {
            return null;
        }
        AlbumSnapshot snapshot = level.getServer().overworld().getDataStorage().get(type(id));
        return snapshot != null && snapshot.reference().equals(id) ? snapshot : null;
    }
}
