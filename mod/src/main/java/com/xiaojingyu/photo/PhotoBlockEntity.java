package com.xiaojingyu.photo;

import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponentMap;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueOutput;

/**
 * Common part of the three photo block entities (docs/PHOTOS.md §2). They keep the keys they were loaded with
 * exactly as they were (a bad photo is skipped for showing and paging but saved back unchanged), so
 * {@code /xjy capture} gives back what {@code /xjy place} or the web page put in.
 *
 * <p>Saving leaves out MC's empty {@code components} compound: an empty album table or frame saves as
 * {@code {}}, the same as the web page writes for the default house (lead, 2026-11-07).
 */
public abstract class PhotoBlockEntity extends BlockEntity {
    protected PhotoBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state) {
        super(type, pos, state);
    }

    @Override
    public void saveWithoutMetadata(ValueOutput output) {
        saveAdditional(output);
        DataComponentMap components = components();
        if (!components.isEmpty()) {
            output.store("components", DataComponentMap.CODEC, components);
        }
    }

    /** "xiaojingyu:photo_frame at 1, -60, 3" for log lines. */
    protected String where() {
        return BuiltInRegistries.BLOCK_ENTITY_TYPE.getKey(getType()) + " at " + worldPosition.toShortString()
            + (level != null && level.isClientSide() ? " (client)" : "");
    }
}
