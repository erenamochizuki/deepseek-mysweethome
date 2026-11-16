package com.xiaojingyu.furniture;

import com.mojang.serialization.Codec;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import com.xiaojingyu.photo.PhotoActions;
import com.xiaojingyu.photo.PhotoAlbumTableBlockEntity;
import com.xiaojingyu.photo.PhotoBlockEntities;
import com.xiaojingyu.photo.PhotoFrameBlockEntity;
import com.xiaojingyu.photo.PictureFramesBlockEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.EntityBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import org.jspecify.annotations.Nullable;

/**
 * The three furniture pieces with photos (docs/PHOTOS.md §4): the album table, the new photo frame and the picture
 * frames wall. Same shapes, states and placing as every other piece ({@link FurnitureBlock}), plus a block entity
 * (the picture frames only in part 0) and a right click:
 * <ul>
 *   <li>empty hand, or holding something that is not a block: {@link PhotoActions#use} (next photo; sneaking:
 *       previous). Vanilla skips the block when the player sneaks with anything in either hand, so sneaking
 *       works with empty hands only;</li>
 *   <li>holding a block: nothing here, the block is placed as usual.</li>
 * </ul>
 * The photo frame hangs on the face you click, like an item frame: clicking the side of a wall makes it face away
 * from that wall; clicking a floor or ceiling falls back to facing the player like the other pieces.
 */
public final class PhotoFurnitureBlock extends FurnitureBlock implements EntityBlock {
    public static final MapCodec<FurnitureBlock> CODEC = RecordCodecBuilder.mapCodec(i -> i.group(
            Codec.STRING.fieldOf("furniture").forGetter(b -> b.spec().id()),
            propertiesCodec()
    ).apply(i, (id, p) -> new PhotoFurnitureBlock(FurnitureSpecs.get(id), p)));

    public PhotoFurnitureBlock(FurnitureSpec spec, Properties properties) {
        super(spec, properties);
    }

    @Override
    protected MapCodec<FurnitureBlock> codec() {
        return CODEC;
    }

    @Override
    public @Nullable BlockEntity newBlockEntity(BlockPos pos, BlockState state) {
        return switch (spec().id()) {
            case PhotoBlockEntities.ALBUM_TABLE_ID -> new PhotoAlbumTableBlockEntity(pos, state);
            case PhotoBlockEntities.FRAME_ID -> new PhotoFrameBlockEntity(pos, state);
            case PhotoBlockEntities.PICTURE_FRAMES_ID -> partOf(state) == 0 ? new PictureFramesBlockEntity(pos, state) : null;
            default -> null;
        };
    }

    @Override
    protected java.util.List<ItemStack> getDrops(BlockState state, net.minecraft.world.level.storage.loot.LootParams.Builder params) {
        java.util.List<ItemStack> drops = super.getDrops(state, params);
        if (params.getOptionalParameter(net.minecraft.world.level.storage.loot.parameters.LootContextParams.BLOCK_ENTITY)
            instanceof PhotoAlbumTableBlockEntity table) {
            String reference = table.carryReference();
            if (reference != null) {
                for (ItemStack drop : drops) {
                    if (drop.is(asItem())) {
                        drop.set(PhotoBlockEntities.ALBUM_REFERENCE.get(), reference);
                    }
                }
            }
        }
        return drops;
    }

    @Override
    public @Nullable BlockState getStateForPlacement(BlockPlaceContext context) {
        if (spec().id().equals(PhotoBlockEntities.ALBUM_TABLE_ID)
            && context.getLevel() instanceof net.minecraft.server.level.ServerLevel server) {
            String reference = context.getItemInHand().get(PhotoBlockEntities.ALBUM_REFERENCE.get());
            if (reference != null && com.xiaojingyu.photo.AlbumSnapshot.find(server, reference) == null) {
                if (context.getPlayer() != null) {
                    context.getPlayer().sendOverlayMessage(
                        net.minecraft.network.chat.Component.translatable("photo.xiaojingyu.album_missing"));
                }
                return null;
            }
        }
        Direction face = context.getClickedFace();
        if (spec().id().equals(PhotoBlockEntities.FRAME_ID) && face.getAxis().isHorizontal()) {
            return defaultBlockState().setValue(FACING, face);
        }
        return super.getStateForPlacement(context);
    }

    @Override
    protected InteractionResult useItemOn(
        ItemStack stack, BlockState state, Level level, BlockPos pos, Player player, InteractionHand hand, BlockHitResult hit
    ) {
        // A block in hand is for building (placing against the frame); anything else changes the photo.
        return stack.getItem() instanceof BlockItem ? InteractionResult.PASS : InteractionResult.TRY_WITH_EMPTY_HAND;
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
        return PhotoActions.use(level, mainPos(pos, state), state, spec().id(), player, hit);
    }
}
