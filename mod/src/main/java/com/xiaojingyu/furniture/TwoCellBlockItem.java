package com.xiaojingyu.furniture;

import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Item of a two-cell piece. Like the vanilla BedItem it places the first cell without neighbour and
 * shape updates (flags 2 | 8 | 16 = 26); {@link TwoCellFurnitureBlock#setPlacedBy} then places the
 * other cell and does the updates, so the first cell never sees itself without its partner.
 */
public class TwoCellBlockItem extends BlockItem {
    public TwoCellBlockItem(Block block, Properties properties) {
        super(block, properties);
    }

    @Override
    protected boolean placeBlock(BlockPlaceContext context, BlockState placementState) {
        return context.getLevel().setBlock(context.getClickedPos(), placementState,
                Block.UPDATE_CLIENTS | Block.UPDATE_IMMEDIATE | Block.UPDATE_KNOWN_SHAPE);
    }
}
