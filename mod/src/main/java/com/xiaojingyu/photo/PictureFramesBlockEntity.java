package com.xiaojingyu.photo;

import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.util.ExtraCodecs;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jspecify.annotations.Nullable;

/**
 * The picture frames wall (docs/PHOTOS.md §2), only in its {@code part=0} cell: {@code Slots}, a list of 6, each a
 * photo or an empty compound (empty = the small painting of the model). Slot i = row i of the photoSlots =
 * canvas i of the web page. No {@code Slots} key = all six show their painting.
 */
public final class PictureFramesBlockEntity extends PhotoDisplayBlockEntity {
    public static final String KEY = "Slots";
    public static final int SLOTS = 6;

    /** {@code Slots} as loaded or last set, saved back unchanged; null = no key. */
    private @Nullable Tag raw;
    private final Photo[] photos = new Photo[SLOTS];

    public PictureFramesBlockEntity(BlockPos pos, BlockState state) {
        super(PhotoBlockEntities.PICTURE_FRAMES.get(), pos, state);
    }

    @Override
    protected void loadAdditional(ValueInput input) {
        super.loadAdditional(input);
        raw = input.read(KEY, ExtraCodecs.NBT).orElse(null);
        parse();
    }

    private void parse() {
        java.util.Arrays.fill(photos, null);
        if (raw == null) {
            return;
        }
        if (!(raw instanceof ListTag list)) {
            com.mojang.logging.LogUtils.getLogger().warn("[xiaojingyu] {}: Slots skipped (not a list)", where());
            return;
        }
        for (int i = 0; i < Math.min(SLOTS, list.size()); i++) {
            photos[i] = Photo.read(list.get(i), where() + " slot " + i);
        }
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
        return SLOTS;
    }

    @Override
    public @Nullable Photo photo(int slot) {
        return slot >= 0 && slot < SLOTS ? photos[slot] : null;
    }

    /** Writes the slot into the list (made, or padded to 6 with empty compounds, when needed). */
    @Override
    protected void store(int slot, @Nullable Photo p) {
        if (slot < 0 || slot >= SLOTS) {
            throw new IndexOutOfBoundsException(slot);
        }
        ListTag list = raw instanceof ListTag l ? l.copy() : new ListTag();
        while (list.size() < SLOTS) {
            list.add(new CompoundTag());
        }
        list.set(slot, p == null ? new CompoundTag() : p.tag().copy());
        raw = list;
        parse();
    }

    @Override
    public CompoundTag syncTag() {
        CompoundTag t = new CompoundTag();
        boolean any = false;
        ListTag list = new ListTag();
        for (Photo p : photos) {
            list.add(p == null ? new CompoundTag() : p.syncTag());
            any |= p != null;
        }
        if (any) {
            t.put(KEY, list);
        }
        return t;
    }
}
