package com.xiaojingyu.photo;

import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientGamePacketListener;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import org.jspecify.annotations.Nullable;

/**
 * A block entity that shows photos: the new photo frame (1 slot) and the picture frames wall (6 slots). Clients
 * get the photos (only Id and Png of the usable ones) so they can draw them:
 * <ul>
 *   <li>when the chunk is sent ({@link #getUpdateTag}): photo bytes count against a budget per chunk
 *       ({@link PhotoSync}); a block entity past the budget goes out empty in the chunk packet and right after
 *       it in its own block entity packet, so a wall full of photos never makes one packet too big;</li>
 *   <li>when a photo changes ({@link #setPhoto}) or {@code /xjy place} / {@code /setblock} writes the block
 *       ({@link #getUpdatePacket}, always everything).</li>
 * </ul>
 * The client reads the update tag with the same {@code loadAdditional}, checking every photo again.
 */
public abstract class PhotoDisplayBlockEntity extends PhotoBlockEntity {
    protected PhotoDisplayBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state) {
        super(type, pos, state);
    }

    /** Number of slots (1 for a frame, 6 for the picture frames). */
    public abstract int slotCount();

    /** The usable photo in a slot, or null (empty, or a photo that failed the check). */
    public abstract @Nullable Photo photo(int slot);

    /** Puts a photo (or nothing) into a slot: changes the saved data, nothing else. */
    protected abstract void store(int slot, @Nullable Photo photo);

    /** Everything a client needs: the usable photos as {Id, Png}; {} if there are none. */
    public abstract CompoundTag syncTag();

    /** Changes a slot, saves the chunk and sends the new photos to everyone who sees this block. */
    public void setPhoto(int slot, @Nullable Photo photo) {
        store(slot, photo);
        setChanged();
        if (level != null && !level.isClientSide()) {
            BlockState state = getBlockState();
            level.sendBlockUpdated(worldPosition, state, state, Block.UPDATE_CLIENTS);
        }
    }

    /** PNG bytes the client gets for this block entity (the chunk budget counts these). */
    public int syncBytes() {
        int n = 0;
        for (int i = 0; i < slotCount(); i++) {
            Photo p = photo(i);
            if (p != null) {
                n += p.png().length;
            }
        }
        return n;
    }

    /** For the chunk packet: the photos while the chunk's budget lasts, else nothing (they follow, PhotoSync). */
    @Override
    public CompoundTag getUpdateTag(HolderLookup.Provider registries) {
        return PhotoSync.inChunkPacket(this) ? syncTag() : new CompoundTag();
    }

    /** For changes: always all the photos (one block entity is at most 6 × 48 KB). */
    @Override
    public @Nullable Packet<ClientGamePacketListener> getUpdatePacket() {
        return ClientboundBlockEntityDataPacket.create(this, (be, registries) -> ((PhotoDisplayBlockEntity) be).syncTag());
    }
}
