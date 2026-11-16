package com.xiaojingyu.command;

import java.io.IOException;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.logging.LogUtils;
import com.xiaojingyu.XiaojingyuMod;
import com.xiaojingyu.blacklist.Blacklist;
import com.xiaojingyu.blacklist.BlacklistActions;
import com.xiaojingyu.build.BuildManager;
import com.xiaojingyu.build.CaptureRange;
import com.xiaojingyu.build.FileNames;
import com.xiaojingyu.build.Frame;
import com.xiaojingyu.build.LastPlaceStore;
import com.xiaojingyu.build.PlaceRecord;
import com.xiaojingyu.share.ShareException;
import com.xiaojingyu.share.ShareFiles;
import com.xiaojingyu.share.ShareModel;

import net.minecraft.ChatFormatting;
import net.minecraft.SharedConstants;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.IntTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;

/**
 * {@code /xjy capture}, {@code /xjy capture <前> <左右> <高> [名字…]}, {@code /xjy capture 范围 <前> <后> <左右> <高>
 * [名字…]} (COMMANDS.md §2; numbers left out come from the mod config) and {@code /xjy capture 上次|last [名字…]} (§2b).
 */
final class CaptureCommand {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private CaptureCommand() {
    }

    /**
     * The box {@code range} reaches from where the player stands (behind too when {@code back} > 0); Offset = the
     * box's lowest corner − the standing point. Result = blocks in the box that are not air. Success means the file
     * is complete.
     */
    static int run(CommandSourceStack source, CaptureRange range, @Nullable String name) throws CommandSyntaxException {
        long t0 = System.nanoTime();
        ServerPlayer player = source.getPlayerOrException();
        ServerLevel level = player.level();
        BlockPos s = player.blockPosition();
        int facing = Frame.facingIndex(player.getDirection());
        int[] box = range.box(s.getX(), s.getY(), s.getZ(), facing);
        Checks.area(level, box);

        Blacklist.Snapshot blacklist = Blacklist.get().snapshot();
        Capture.Result r = Capture.read(level, box, blacklist.idSet());
        ShareModel model = r.model();
        model.setOffset(box[0] - s.getX(), box[1] - s.getY(), box[2] - s.getZ());
        String fallback = ShareModel.defaultName(LocalDateTime.now());
        String title = name == null || name.isBlank() ? fallback : name.strip();
        model.setMeta(ShareModel.newMeta(title, player.getName().getString(), System.currentTimeMillis(),
            Frame.name(facing), s.getX(), s.getY(), s.getZ(), level.dimension().identifier().toString(),
            "xiaojingyu-mod/" + XiaojingyuMod.version(), SharedConstants.getCurrentVersion().name()));
        return save(source, player, r, title, fallback, blacklist, t0, null);
    }

    /**
     * {@code /xjy capture 上次}: the box the player's last finished {@code /xjy place} filled, wherever the player is
     * now, read back in the placed file's own orientation (cells and block states turned back), with the file's
     * size, Offset and Facing (COMMANDS.md §2b). Origin is the standing point of that place. Result = non-air blocks.
     */
    static int runLast(CommandSourceStack source, @Nullable String name) throws CommandSyntaxException {
        long t0 = System.nanoTime();
        ServerPlayer player = source.getPlayerOrException();
        Checks.notBusy(player);
        PlaceRecord last = LastPlaceStore.latest(source.getServer(), player.getUUID());
        if (last == null) {
            throw Msg.fail("capture_last.none");
        }
        Identifier dimId = Identifier.tryParse(last.dimension());
        ServerLevel level = dimId == null ? null : source.getServer().getLevel(ResourceKey.create(Registries.DIMENSION, dimId));
        if (level == null) {
            throw Msg.fail("capture_last.no_level", last.dimension());
        }
        int[] box = last.box();
        int[] st = last.standing();
        if (!Checks.chunksLoaded(level, box)) {
            throw Msg.fail("capture_last.not_loaded", last.file(), where(st, last.dimension(), player.level().dimension()));
        }
        Checks.area(level, box);

        Blacklist.Snapshot blacklist = Blacklist.get().snapshot();
        int[] size = last.size();
        Capture.Result r = Capture.read(level, size[0], size[1], size[2], last.turns(),
            last.baseX(), last.baseY(), last.baseZ(), blacklist.idSet());
        ShareModel model = r.model();
        int[] off = last.offset();
        model.setOffset(off[0], off[1], off[2]);
        String fallback = FileNames.lastCaptureName(last.file(), LocalDateTime.now().format(STAMP));
        String title = name == null || name.isBlank() ? fallback : name.strip();
        // newMeta wants a facing; a file that had none (WorldEdit …) gets none back, so auto places it the same way.
        CompoundTag meta = ShareModel.newMeta(title, player.getName().getString(), System.currentTimeMillis(),
            Frame.name(Math.max(0, last.fileFacing())), st[0], st[1], st[2], last.dimension(),
            "xiaojingyu-mod/" + XiaojingyuMod.version(), SharedConstants.getCurrentVersion().name());
        CompoundTag xjy = meta.getCompoundOrEmpty("Xiaojingyu");
        if (last.fileFacing() < 0) {
            xjy.remove("Facing");
        }
        CompoundTag from = new CompoundTag();
        from.put("File", StringTag.valueOf(last.file()));
        from.put("Turn", IntTag.valueOf(last.degrees()));
        xjy.put("FromPlace", from);
        meta.put("Xiaojingyu", xjy);
        model.setMeta(meta);
        Component lastLine = Msg.t("capture_last.done", last.file(), where(st, last.dimension(), player.level().dimension()),
            last.degrees());
        return save(source, player, r, title, fallback, blacklist, t0, lastLine);
    }

    /** "x, y, z", plus the dimension when it is not the one the player is in. */
    static String where(int[] p, String dimension, ResourceKey<Level> playerDimension) {
        String xyz = p[0] + ", " + p[1] + ", " + p[2];
        return dimension.equals(playerDimension.identifier().toString()) ? xyz : xyz + " (" + dimension + ")";
    }

    /** Writes the file, tells the player, remembers it for /xjy status. Result = non-air blocks. */
    private static int save(CommandSourceStack source, ServerPlayer player, Capture.Result r, String title,
                            String fallback, Blacklist.Snapshot blacklist, long t0, @Nullable Component extra)
            throws CommandSyntaxException {
        ShareModel model = r.model();
        byte[] bytes;
        try {
            bytes = ShareFiles.writePng(model, r.preview());
        } catch (ShareException e) {
            LOGGER.warn("[xiaojingyu] capture not written: {} ({})", e.code(), e.detail());
            throw Msg.fail(Msg.shareError(e));
        }
        Path file;
        try {
            file = BuildFiles.saveNew(FileNames.sanitize(title, fallback), bytes);
        } catch (IOException e) {
            LOGGER.warn("[xiaojingyu] capture not written", e);
            throw Msg.fail("capture.write_failed", e.toString());
        }

        String fileName = file.getFileName().toString();
        String fullPath = file.toAbsolutePath().toString();
        MutableComponent link = Component.literal(fileName).withStyle(style -> style
            .withUnderlined(true)
            .withColor(ChatFormatting.AQUA)
            .withClickEvent(new ClickEvent.CopyToClipboard(fullPath))
            .withHoverEvent(new HoverEvent.ShowText(Msg.t("capture.copy_path"))));
        int w = model.width();
        int h = model.height();
        int l = model.length();
        int nonAir = r.nonAir();
        int blockEntities = r.blockEntities();
        source.sendSuccess(() -> Msg.t("capture.done", w, h, l, nonAir, blockEntities, link), false);
        if (extra != null) {
            source.sendSuccess(() -> extra, false);
        }
        if (r.blacklisted() + r.liquids() + r.dried() > 0) {
            source.sendSuccess(() -> Msg.t("capture.filtered", r.blacklisted(), r.liquids(), r.dried()), false);
        }
        Component problem = BlacklistActions.problem(blacklist);
        if (problem != null) {
            source.sendSuccess(() -> problem, false);
        }
        source.sendSuccess(() -> Msg.t("capture.send_hint"), false);
        BuildManager.setLastCapture(player.getUUID(), fileName);
        LOGGER.info("[xiaojingyu] capture{} {}x{}x{} -> {} ({} bytes) in {} ms; as air: {} blacklisted, {} liquid;"
            + " {} waterlogged written dry", extra == null ? "" : " of the last placement", w, h, l, fileName,
            bytes.length, (System.nanoTime() - t0) / 1_000_000, r.blacklisted(), r.liquids(), r.dried());
        return nonAir;
    }
}
