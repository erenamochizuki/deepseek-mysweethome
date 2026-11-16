package com.xiaojingyu.command;

import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;

import com.xiaojingyu.build.CaptureFilter;
import com.xiaojingyu.build.Frame;
import com.xiaojingyu.build.PngWriter;
import com.xiaojingyu.build.PreviewImage;
import com.xiaojingyu.share.ShareModel;

import net.minecraft.commands.arguments.blocks.BlockStateParser;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.LiquidBlock;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.material.MapColor;

/**
 * Reads a world box into a ShareModel plus its top-down preview picture (COMMANDS.md §2, §5).
 * Blocks on the capture blacklist and liquids become air, waterlogged blocks lose the water
 * ({@link CaptureFilter}); the counts, the preview and the block entities follow the changed blocks.
 */
final class Capture {
    /**
     * The model (offset, metadata not set yet), the preview PNG and the counts for chat. {@code blacklisted},
     * {@code liquids}: cells written as air because of the blacklist / because they were liquid;
     * {@code dried}: waterlogged cells written without the water.
     */
    record Result(ShareModel model, byte[] preview, int nonAir, int blockEntities, int blacklisted, int liquids,
                  int dried) {
    }

    /** What one world state turns into: the palette id and the state used for colour and block entity. */
    private record Cell(int paletteId, BlockState used, CaptureFilter.Kind kind) {
    }

    private Capture() {
    }

    /** box = {minX, minY, minZ, maxX, maxY, maxZ}; the chunks must be loaded. blacklist = block ids. */
    static Result read(ServerLevel level, int[] box, Set<String> blacklist) {
        return read(level, box[3] - box[0] + 1, box[4] - box[1] + 1, box[5] - box[2] + 1, 0,
            box[0], box[1], box[2], blacklist);
    }

    /**
     * Reads a w × h × l model whose cell (x, y, z) is the world block {@code base + rot_k(x, y, z)}, each state
     * turned back by k ({@code state.rotate(rotation(−k))}): a box that {@code /xjy place} filled turned k comes
     * back in the file's own orientation (COMMANDS.md §2b). k = 0 with base = the min corner is the plain capture.
     * The preview is drawn in model coordinates (the file's north is up). The chunks must be loaded.
     */
    static Result read(ServerLevel level, int w, int h, int l, int k, int baseX, int baseY, int baseZ,
                       Set<String> blacklist) {
        Rotation back = Frame.rotation(Frame.back(k));
        ShareModel model = new ShareModel(w, h, l);
        int[] cells = model.cells();
        Map<BlockState, Cell> seen = new IdentityHashMap<>();
        MapColor[] colors = new MapColor[w * l];
        int[] heights = new int[w * l];
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        int nonAir = 0;
        int blockEntities = 0;
        int[] byKind = new int[CaptureFilter.Kind.values().length];
        int i = 0;
        for (int y = 0; y < h; y++) {
            for (int z = 0; z < l; z++) {
                for (int x = 0; x < w; x++, i++) {
                    pos.set(baseX + Frame.rotX(k, x, z), baseY + y, baseZ + Frame.rotZ(k, x, z));
                    BlockState world = level.getBlockState(pos);
                    Cell cell = seen.get(world);
                    if (cell == null) {
                        cell = cell(model, world.rotate(back), blacklist);
                        seen.put(world, cell);
                    }
                    cells[i] = cell.paletteId();
                    byKind[cell.kind().ordinal()]++;
                    BlockState state = cell.used();
                    if (!state.isAir()) {
                        nonAir++;
                    }
                    MapColor color = state.getMapColor(level, pos);
                    if (color != MapColor.NONE) {
                        // Ascending y: the last colour seen in a column is the top one.
                        colors[x + z * w] = color;
                        heights[x + z * w] = y;
                    }
                    if (state.hasBlockEntity()) {
                        BlockEntity be = level.getBlockEntity(pos);
                        Identifier type = be == null ? null : BuiltInRegistries.BLOCK_ENTITY_TYPE.getKey(be.getType());
                        if (type != null) {
                            model.putBlockEntity(x, y, z, type.toString(), be.saveWithoutMetadata(level.registryAccess()));
                            blockEntities++;
                        }
                    }
                }
            }
        }
        int s = PreviewImage.scale(w, l);
        byte[] preview = PngWriter.encode(w * s, l * s, PreviewImage.render(w, l, colors, heights, s));
        return new Result(model, preview, nonAir, blockEntities, byKind[CaptureFilter.Kind.BLACKLISTED.ordinal()],
            byKind[CaptureFilter.Kind.LIQUID.ordinal()], byKind[CaptureFilter.Kind.DRY.ordinal()]);
    }

    private static Cell cell(ShareModel model, BlockState world, Set<String> blacklist) {
        String serialized = BlockStateParser.serialize(world);
        CaptureFilter.Kind kind = CaptureFilter.kind(serialized, isLiquid(world), blacklist);
        BlockState used = switch (kind) {
            case KEEP -> world;
            case BLACKLISTED, LIQUID -> Blocks.AIR.defaultBlockState();
            case DRY -> world.hasProperty(BlockStateProperties.WATERLOGGED)
                ? world.setValue(BlockStateProperties.WATERLOGGED, false) : world;
        };
        String written = used == world ? serialized : BlockStateParser.serialize(used);
        return new Cell(model.paletteId(written), used, kind);
    }

    /** Water and lava (flowing or source, and any other LiquidBlock) and bubble columns. */
    static boolean isLiquid(BlockState state) {
        return state.getBlock() instanceof LiquidBlock || state.is(Blocks.BUBBLE_COLUMN);
    }
}
