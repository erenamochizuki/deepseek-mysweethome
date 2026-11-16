package com.xiaojingyu.command;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.xiaojingyu.build.BuildManager;
import com.xiaojingyu.build.BuildPlan;
import com.xiaojingyu.build.CaptureRange;
import com.xiaojingyu.build.FileNames;
import com.xiaojingyu.build.Frame;
import com.xiaojingyu.build.PlaceRecord;
import com.xiaojingyu.share.ShareModel;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.blocks.BlockStateParser;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.fml.ModList;

/** {@code /xjy place <文件> [auto|0|90|180|270]} (COMMANDS.md §3). */
final class PlaceCommand {
    /** At most this many cells per placement (COMMANDS.md §3): the biggest capture, 129 × 64 × 128 = 1,056,768. */
    static final int MAX_CELLS = CaptureRange.MAX_VOLUME;

    private PlaceCommand() {
    }

    /**
     * Every check happens here, before anything is placed. Result = cells to place.
     *
     * @param degrees 0/90/180/270 clockwise relative to the file, or −1 for auto
     */
    static int run(CommandSourceStack source, String fileArg, int degrees) throws CommandSyntaxException {
        ServerPlayer player = source.getPlayerOrException();
        ServerLevel level = player.level();
        Checks.notBusy(player);
        if (!FileNames.isSafePlaceArg(fileArg)) {
            throw Msg.fail("place.bad_name", fileArg);
        }
        Path file = BuildFiles.find(fileArg);
        if (file == null) {
            throw Msg.fail("place.not_found", fileArg, BuildFiles.folder().toAbsolutePath().toString());
        }
        ShareModel model = BuildFiles.load(file);
        BlockState[] palette = parsePalette(level, model.palette());
        if (model.volume() > MAX_CELLS) {
            throw Msg.fail("place.too_many", model.volume(), MAX_CELLS);
        }
        int fileFacing = fileFacing(model);
        int playerFacing = Frame.facingIndex(player.getDirection());
        int k = degrees < 0 ? Frame.autoTurns(fileFacing, playerFacing) : Frame.turnsFromDegrees(degrees);
        BlockPos s = player.blockPosition();
        int w = model.width();
        int h = model.height();
        int l = model.length();
        // What goes into the world's last placements once this has finished (COMMANDS.md §2b); its box and
        // base are the ones used here, so /xjy capture 上次 reads back exactly these cells.
        PlaceRecord placed = new PlaceRecord(0, file.getFileName().toString(), level.dimension().identifier().toString(),
            new int[] {s.getX(), s.getY(), s.getZ()}, playerFacing, k, PlaceRecord.mode(degrees), model.offset(),
            new int[] {w, h, l}, fileFacing, System.currentTimeMillis());
        int[] box = placed.box();
        Checks.area(level, box);

        for (int i = 0; i < palette.length; i++) {
            palette[i] = palette[i].rotate(Frame.rotation(k));
        }
        int[] cells = model.cells();
        Map<Integer, CompoundTag> blockEntities = new HashMap<>();
        for (ShareModel.BlockEntityEntry e : model.blockEntities()) {
            int i = model.index(e.x(), e.y(), e.z());
            if (e.data() != null && palette[cells[i]].hasBlockEntity()) {
                blockEntities.put(i, e.data());
            }
        }
        BuildPlan plan = new BuildPlan(level.dimension(), w, h, l, k, placed.baseX(), placed.baseY(), placed.baseZ(),
            palette, cells, blockEntities);
        int volume = model.volume();
        int bw = box[3] - box[0] + 1;
        int bh = box[4] - box[1] + 1;
        int bl = box[5] - box[2] + 1;
        int turned = k * 90;
        source.sendSuccess(() -> Msg.t("place.started", volume, bw, bh, bl, turned), false);
        if (model.warnings().contains(ShareModel.WARN_DATA_VERSION)) {
            int fileVersion = model.dataVersion();
            source.sendSuccess(() -> Msg.t("place.warn_data_version", fileVersion, ShareModel.CURRENT_DATA_VERSION), false);
        }
        if (model.warnings().contains(ShareModel.WARN_NEWER_FORMAT)) {
            source.sendSuccess(() -> Msg.t("place.warn_newer_format"), false);
        }
        BuildManager.startPlace(source.getServer(), player.getUUID(), level, plan, placed);
        return volume;
    }

    /** The file's Metadata.Xiaojingyu.Facing as 0–3, or −1 when it has none. */
    private static int fileFacing(ShareModel model) {
        CompoundTag meta = model.meta();
        if (meta == null) {
            return -1;
        }
        return meta.getCompound("Xiaojingyu").flatMap(x -> x.getString("Facing")).map(Frame::facingIndex).orElse(-1);
    }

    /** Every palette entry must be a block state of this game, or nothing is placed. */
    private static BlockState[] parsePalette(ServerLevel level, List<String> palette) throws CommandSyntaxException {
        HolderLookup<Block> blocks = level.registryAccess().lookupOrThrow(Registries.BLOCK);
        BlockState[] states = new BlockState[palette.size()];
        List<String> bad = new ArrayList<>();
        TreeSet<String> missingMods = new TreeSet<>();
        for (int i = 0; i < states.length; i++) {
            String s = palette.get(i);
            try {
                states[i] = BlockStateParser.parseForBlock(blocks, s, false).blockState();
            } catch (CommandSyntaxException | RuntimeException e) {
                bad.add(s);
                int bracket = s.indexOf('[');
                Identifier id = Identifier.tryParse(bracket < 0 ? s : s.substring(0, bracket));
                if (id != null && !ModList.get().isLoaded(id.getNamespace())) {
                    missingMods.add(id.getNamespace());
                }
            }
        }
        if (bad.isEmpty()) {
            return states;
        }
        String examples = String.join(", ", bad.subList(0, Math.min(3, bad.size()))) + (bad.size() > 3 ? ", …" : "");
        MutableComponent message = Msg.t("place.unknown_blocks", bad.size(), examples);
        if (!missingMods.isEmpty()) {
            message.append("\n").append(Msg.t("place.missing_mods", String.join(", ", missingMods)));
        }
        throw Msg.fail(message);
    }
}
