package com.xiaojingyu.photo;

import java.util.Set;

import com.xiaojingyu.XiaojingyuMod;
import com.xiaojingyu.furniture.FurnitureBlock;
import com.xiaojingyu.furniture.ModFurniture;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.level.ChunkWatchEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * The three photo block entity types (docs/PHOTOS.md §2; ids = block ids) and the chunk-sent listener of
 * {@link PhotoSync}. The blocks themselves are furniture blocks made by ModFurniture ({@code PhotoFurnitureBlock}).
 */
public final class PhotoBlockEntities {
    public static final String ALBUM_TABLE_ID = "photo_album_table";
    public static final String FRAME_ID = "photo_frame";
    public static final String PICTURE_FRAMES_ID = "picture_frames";

    private static final DeferredRegister<net.minecraft.core.component.DataComponentType<?>> COMPONENTS =
        DeferredRegister.create(Registries.DATA_COMPONENT_TYPE, XiaojingyuMod.MOD_ID);
    public static final DeferredHolder<net.minecraft.core.component.DataComponentType<?>, net.minecraft.core.component.DataComponentType<String>> ALBUM_REFERENCE =
        COMPONENTS.register("album_reference", () -> net.minecraft.core.component.DataComponentType.<String>builder()
            .persistent(AlbumSnapshot.REFERENCE_CODEC)
            .networkSynchronized(net.minecraft.network.codec.ByteBufCodecs.stringUtf8(64)).build());

    private static final DeferredRegister<BlockEntityType<?>> TYPES =
        DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, XiaojingyuMod.MOD_ID);

    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<PhotoAlbumTableBlockEntity>> ALBUM_TABLE =
        type(ALBUM_TABLE_ID, PhotoAlbumTableBlockEntity::new);
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<PhotoFrameBlockEntity>> FRAME =
        type(FRAME_ID, PhotoFrameBlockEntity::new);
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<PictureFramesBlockEntity>> PICTURE_FRAMES =
        type(PICTURE_FRAMES_ID, PictureFramesBlockEntity::new);

    private PhotoBlockEntities() {
    }

    /** Is this furniture id one of the three photo blocks? */
    public static boolean isPhotoBlock(String id) {
        return id.equals(ALBUM_TABLE_ID) || id.equals(FRAME_ID) || id.equals(PICTURE_FRAMES_ID);
    }

    /** Called from ModFurniture.register with the mod event bus. */
    public static void register(IEventBus modEventBus) {
        COMPONENTS.register(modEventBus);
        TYPES.register(modEventBus);
        NeoForge.EVENT_BUS.addListener(ChunkWatchEvent.Sent.class, PhotoSync::onChunkSent);
    }

    /**
     * A type whose valid block is the furniture block of the same id. Until web7's export adds the photo frame to
     * FurnitureShapes the frame type has no block (and is never made); the other two always have theirs.
     */
    private static <T extends BlockEntity> DeferredHolder<BlockEntityType<?>, BlockEntityType<T>> type(
        String id, BlockEntityType.BlockEntitySupplier<T> factory
    ) {
        return TYPES.register(id, () -> {
            DeferredBlock<FurnitureBlock> block = ModFurniture.ROUND2_BLOCKS.get(id);
            Set<Block> valid = block == null ? Set.of() : Set.of(block.get());
            if (valid.isEmpty()) {
                XiaojingyuMod.LOGGER.warn("[xiaojingyu] block entity type {} has no block yet (furniture kind missing)", id);
            }
            return new BlockEntityType<>(factory, valid);
        });
    }
}
