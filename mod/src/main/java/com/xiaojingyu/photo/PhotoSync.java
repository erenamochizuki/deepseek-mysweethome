package com.xiaojingyu.photo;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientGamePacketListener;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.storage.CommandStorage;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.event.level.ChunkWatchEvent;

/**
 * Keeps chunk packets small enough with many photos (docs/PHOTOS.md §4 "照片发给客户端").
 *
 * <p>PNG bytes hardly compress, and a packet on the wire may be at most 2 MiB after compression (the 3-byte
 * length in front of each packet; NeoForge only splits packets over 8 MiB before compression). A chunk packet
 * carries every block entity's update tag, so 50 frames of 48 KB in one chunk would disconnect players on a
 * server. So per chunk only the first {@link #CHUNK_BUDGET} bytes of photos (block entities in position order)
 * go into the chunk packet; the rest go out empty there and are sent straight after it, each in its own block
 * entity packet (at most 6 × 48 KB), when NeoForge says the chunk was sent ({@link ChunkWatchEvent.Sent}).
 * In single player nothing is encoded at all, but the same rule keeps it simple and the same everywhere.
 *
 * <p>Development game only (card P5-004): the command storage {@code xiaojingyu:dev} key {@code photo_chunk_budget}
 * (an int above 0) replaces the budget, so a few small photos are enough to see the late sending work, and
 * {@code photo_late_sent} counts the block entity packets sent late. The released mod never touches it ({@link FMLEnvironment#isProduction()}).
 */
public final class PhotoSync {
    /** Photo bytes per chunk packet (1 MiB: about 21 photos of 48 KB, well under the 2 MiB per packet). */
    public static final int CHUNK_BUDGET = 1 << 20;
    private static final Identifier DEV_STORAGE = Identifier.fromNamespaceAndPath("xiaojingyu", "dev");

    private PhotoSync() {
    }

    /** True if this block entity's photos fit into its chunk packet (always true on the client side or alone). */
    static boolean inChunkPacket(PhotoDisplayBlockEntity be) {
        Level level = be.getLevel();
        if (!(level instanceof ServerLevel server)) {
            return true;
        }
        int own = be.syncBytes();
        if (own == 0) {
            return true;
        }
        BlockPos pos = be.getBlockPos();
        LevelChunk chunk = server.getChunkSource().getChunkNow(pos.getX() >> 4, pos.getZ() >> 4);
        if (chunk == null) {
            return true;
        }
        long before = 0;
        for (BlockEntity other : chunk.getBlockEntities().values()) {
            if (other != be && other instanceof PhotoDisplayBlockEntity d && order(other.getBlockPos(), pos) < 0) {
                before += d.syncBytes();
            }
        }
        return before + own <= budget(server.getServer());
    }

    /** {@link #CHUNK_BUDGET}, or in the development game the test value from the command storage. */
    private static long budget(MinecraftServer server) {
        if (FMLEnvironment.isProduction()) {
            return CHUNK_BUDGET;
        }
        int dev = server.getCommandStorage().get(DEV_STORAGE).getIntOr("photo_chunk_budget", 0);
        return dev > 0 ? dev : CHUNK_BUDGET;
    }

    /** Position order of the budget: by BlockPos.asLong (ties cannot happen, one block entity per position). */
    private static int order(BlockPos a, BlockPos b) {
        return Long.compare(a.asLong(), b.asLong());
    }

    /** After a chunk packet: sends the photos that did not fit into it. */
    static void onChunkSent(ChunkWatchEvent.Sent event) {
        List<PhotoDisplayBlockEntity> late = new ArrayList<>();
        for (BlockEntity be : event.getChunk().getBlockEntities().values()) {
            if (be instanceof PhotoDisplayBlockEntity d && !inChunkPacket(d)) {
                late.add(d);
            }
        }
        late.sort(Comparator.comparingLong(d -> d.getBlockPos().asLong()));
        for (PhotoDisplayBlockEntity d : late) {
            Packet<ClientGamePacketListener> packet = d.getUpdatePacket();
            if (packet != null) {
                event.getPlayer().connection.send(packet);
            }
        }
        if (!late.isEmpty() && !FMLEnvironment.isProduction()) {
            CommandStorage storage = event.getLevel().getServer().getCommandStorage();
            CompoundTag dev = storage.get(DEV_STORAGE).copy();
            dev.putInt("photo_late_sent", dev.getIntOr("photo_late_sent", 0) + late.size());
            storage.set(DEV_STORAGE, dev);
        }
    }
}
