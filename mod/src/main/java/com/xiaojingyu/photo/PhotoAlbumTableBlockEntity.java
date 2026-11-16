package com.xiaojingyu.photo;

import java.util.List;

import net.minecraft.core.BlockPos;
import net.minecraft.nbt.Tag;
import net.minecraft.util.ExtraCodecs;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jspecify.annotations.Nullable;

/**
 * The album table's album (docs/PHOTOS.md §2): {@code Album}, a list of up to 64 photos in album order. Frames
 * within 16 blocks page through it (PhotoActions). Never sent to clients: the update tag stays empty (the
 * BlockEntity default), so a full album (up to 64 × 48 KB) never goes into a chunk packet.
 */
public final class PhotoAlbumTableBlockEntity extends PhotoBlockEntity {
    public static final String KEY = "Album";

    /** {@code Album} as loaded, saved back unchanged; null when there was no such key. */
    private @Nullable Tag raw;
    private List<Photo> album = List.of();

    public PhotoAlbumTableBlockEntity(BlockPos pos, BlockState state) {
        super(PhotoBlockEntities.ALBUM_TABLE.get(), pos, state);
    }

    @Override
    protected void loadAdditional(ValueInput input) {
        super.loadAdditional(input);
        raw = input.read(KEY, ExtraCodecs.NBT).orElse(null);
        album = Photo.readList(raw, Photos.MAX_ALBUM, where());
    }

    @Override
    protected void saveAdditional(ValueOutput output) {
        super.saveAdditional(output);
        if (raw != null) {
            output.store(KEY, ExtraCodecs.NBT, raw);
        }
    }

    /** Empty albums stay ordinary stackable items. Preserve malformed nonempty raw data as well. */
    public @Nullable String carryReference() {
        if (!(level instanceof net.minecraft.server.level.ServerLevel server) || raw == null
            || raw instanceof net.minecraft.nbt.ListTag list && list.isEmpty()) {
            return null;
        }
        return AlbumSnapshot.store(server, raw);
    }

    @Override
    protected void collectImplicitComponents(net.minecraft.core.component.DataComponentMap.Builder components) {
        super.collectImplicitComponents(components);
        String reference = carryReference();
        if (reference != null) {
            components.set(PhotoBlockEntities.ALBUM_REFERENCE.get(), reference);
        }
    }

    @Override
    protected void applyImplicitComponents(net.minecraft.core.component.DataComponentGetter components) {
        super.applyImplicitComponents(components);
        String reference = components.get(PhotoBlockEntities.ALBUM_REFERENCE.get());
        if (reference != null && level instanceof net.minecraft.server.level.ServerLevel server) {
            // Placement checks existence before changing the world or consuming the item.
            AlbumSnapshot snapshot = AlbumSnapshot.find(server, reference);
            if (snapshot != null) {
                raw = snapshot.copyAlbum();
                album = Photo.readList(raw, Photos.MAX_ALBUM, where());
                setChanged();
            }
        }
    }

    @Override
    public void removeComponentsFromTag(ValueOutput output) {
        super.removeComponentsFromTag(output);
        // Vanilla Ctrl+pick invokes this before sending block_entity_data to the inventory.
        output.discard(KEY);
    }

    /** The usable photos, in album order (bad ones skipped, at most 64). */
    public List<Photo> album() {
        return album;
    }
}
