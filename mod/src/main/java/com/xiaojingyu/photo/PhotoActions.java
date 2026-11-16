package com.xiaojingyu.photo;

import java.util.List;

import com.xiaojingyu.command.Msg;
import com.xiaojingyu.furniture.FurnitureShapes;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;

/**
 * Right click on a photo block (docs/PHOTOS.md §4), on the server. The client only answers "used" so the arm
 * swings; the server changes the block entity, which sends the new photos to everyone who sees it.
 * <ul>
 *   <li>a frame or one of the picture frames (found from where the click hit): the next photo of the album,
 *       sneaking the one before ({@link AlbumPaging}). The album is the {@code Album} of the nearest album table in
 *       the same dimension, at most 16 blocks away (centre to centre), in loaded chunks;</li>
 *   <li>the album table: says how many photos the album has.</li>
 * </ul>
 * What happened goes to the action bar (above the hotbar), never into chat.
 */
public final class PhotoActions {
    /** How far a frame looks for an album table (blocks, centre to centre). */
    public static final int ALBUM_RANGE = 16;

    private PhotoActions() {
    }

    /**
     * Handles the click. {@code main}: the cell with the block entity (part 0); {@code id}: the furniture id.
     */
    public static InteractionResult use(Level level, BlockPos main, BlockState state, String id, Player player, BlockHitResult hit) {
        if (level.isClientSide()) {
            return InteractionResult.SUCCESS;
        }
        if (!(level instanceof ServerLevel server)) {
            return InteractionResult.PASS;
        }
        BlockEntity be = level.getBlockEntity(main);
        if (be instanceof PhotoAlbumTableBlockEntity table) {
            int n = table.album().size();
            player.sendOverlayMessage(n == 0 ? Msg.t("photo.album_empty") : Msg.t("photo.album_count", n));
            return InteractionResult.SUCCESS;
        }
        if (!(be instanceof PhotoDisplayBlockEntity display)) {
            return InteractionResult.PASS;
        }
        int slot = 0;
        if (display.slotCount() > 1) {
            int q = FurnitureShapes.quarterTurns(state.getValue(HorizontalDirectionalBlock.FACING).getSerializedName());
            Vec3 at = hit.getLocation();
            slot = Math.max(0, PhotoSlots.find(id, q, at.x - main.getX(), at.y - main.getY(), at.z - main.getZ()));
        }
        PhotoAlbumTableBlockEntity table = nearestAlbum(server, main, ALBUM_RANGE);
        if (table == null) {
            player.sendOverlayMessage(Msg.t("photo.no_album", ALBUM_RANGE));
            return InteractionResult.SUCCESS;
        }
        List<Photo> album = table.album();
        if (album.isEmpty()) {
            player.sendOverlayMessage(Msg.t("photo.album_empty"));
            return InteractionResult.SUCCESS;
        }
        Photo current = display.photo(slot);
        List<String> ids = album.stream().map(Photo::id).toList();
        int next = AlbumPaging.step(ids, current == null ? null : current.id(), player.isSecondaryUseActive());
        Component text;
        if (next == AlbumPaging.EMPTY) {
            display.setPhoto(slot, null);
            text = Msg.t(display.slotCount() > 1 ? "photo.cleared_painting" : "photo.cleared");
        } else {
            Photo p = album.get(next);
            display.setPhoto(slot, p);
            text = p.name().isBlank()
                ? Msg.t("photo.shown", next + 1, album.size())
                : Msg.t("photo.shown_named", next + 1, album.size(), p.name());
        }
        player.sendOverlayMessage(text);
        level.playSound(null, main, SoundEvents.ITEM_FRAME_ROTATE_ITEM, SoundSource.BLOCKS, 1.0F, 1.0F);
        return InteractionResult.SUCCESS;
    }

    /**
     * The album table nearest to {@code from} (block centres, at most {@code range} blocks), only in chunks that
     * are loaded; equal distances go to the smaller BlockPos (y, then z, then x). Null if there is none.
     */
    public static @Nullable PhotoAlbumTableBlockEntity nearestAlbum(ServerLevel level, BlockPos from, int range) {
        PhotoAlbumTableBlockEntity best = null;
        double bestDist = (double) range * range;
        for (int cx = (from.getX() - range) >> 4; cx <= (from.getX() + range) >> 4; cx++) {
            for (int cz = (from.getZ() - range) >> 4; cz <= (from.getZ() + range) >> 4; cz++) {
                LevelChunk chunk = level.getChunkSource().getChunkNow(cx, cz);
                if (chunk == null) {
                    continue;
                }
                for (BlockEntity be : chunk.getBlockEntities().values()) {
                    if (!(be instanceof PhotoAlbumTableBlockEntity t) || be.isRemoved()) {
                        continue;
                    }
                    double d = be.getBlockPos().distSqr(from);
                    if (d < bestDist || d == bestDist && (best == null || be.getBlockPos().compareTo(best.getBlockPos()) < 0)) {
                        best = t;
                        bestDist = d;
                    }
                }
            }
        }
        return best;
    }
}
