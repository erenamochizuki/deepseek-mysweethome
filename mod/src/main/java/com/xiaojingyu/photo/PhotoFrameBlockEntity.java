package com.xiaojingyu.photo;

import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.util.ExtraCodecs;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jspecify.annotations.Nullable;

/** The new single photo frame (docs/PHOTOS.md §2): {@code Photo}, one photo; no such key = an empty frame (mat). */
public final class PhotoFrameBlockEntity extends PhotoDisplayBlockEntity {
    public static final String KEY = "Photo";

    /** {@code Photo} as loaded or last set, saved back unchanged; null = no key. */
    private @Nullable Tag raw;
    private @Nullable Photo photo;

    public PhotoFrameBlockEntity(BlockPos pos, BlockState state) {
        super(PhotoBlockEntities.FRAME.get(), pos, state);
    }

    @Override
    protected void loadAdditional(ValueInput input) {
        super.loadAdditional(input);
        raw = input.read(KEY, ExtraCodecs.NBT).orElse(null);
        photo = Photo.read(raw, where());
    }

    @Override
    protected void saveAdditional(ValueOutput output) {
        super.saveAdditional(output);
        if (raw != null) {
            output.store(KEY, ExtraCodecs.NBT, raw);
        }
    }

    @Override
    public int slotCount() {
        return 1;
    }

    @Override
    public @Nullable Photo photo(int slot) {
        return slot == 0 ? photo : null;
    }

    @Override
    protected void store(int slot, @Nullable Photo p) {
        if (slot != 0) {
            throw new IndexOutOfBoundsException(slot);
        }
        raw = p == null ? null : p.tag().copy();
        photo = p == null ? null : Photo.read(raw, where());
    }

    @Override
    public CompoundTag syncTag() {
        CompoundTag t = new CompoundTag();
        if (photo != null) {
            t.put(KEY, photo.syncTag());
        }
        return t;
    }
}
