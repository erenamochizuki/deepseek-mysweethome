package com.xiaojingyu.furniture;

import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Item of a round-2 piece with more than one cell. Like the vanilla BedItem it places the clicked
 * cell without neighbour and shape updates (flags 2 | 8 | 16 = 26); {@link FurnitureBlock#setPlacedBy}
 * then places the other cells and does the updates, so no cell ever sees the piece half-built.
 */
public class FurnitureBlockItem extends BlockItem {
    public FurnitureBlockItem(Block block, Properties properties) {
        super(block, properties);
    }

    @Override
    protected boolean placeBlock(BlockPlaceContext context, BlockState placementState) {
        return context.getLevel().setBlock(context.getClickedPos(), placementState,
                Block.UPDATE_CLIENTS | Block.UPDATE_IMMEDIATE | Block.UPDATE_KNOWN_SHAPE);
    }
}
