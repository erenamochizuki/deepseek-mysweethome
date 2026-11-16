package com.xiaojingyu.furniture;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.ScheduledTickAccess;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.level.block.LevelEvent;
import net.minecraft.world.level.block.state.BlockState;
import org.jspecify.annotations.Nullable;

/**
 * A piece of furniture that takes two cells side by side (docs/FURNITURE.md §2), done the way the
 * vanilla bed does it (BedBlock):
 * <ul>
 *   <li>placing: the player places one cell; if the other cell is not free nothing is placed;
 *       {@link #setPlacedBy} then puts down the other cell ({@link TwoCellBlockItem} places the first
 *       cell without shape updates, like BedItem);</li>
 *   <li>a cell whose other cell is not exactly right (another block, another facing, the same part)
 *       turns into air in {@link #updateShape}, so the probe's /shapes reports a wrong pair;</li>
 *   <li>breaking either cell removes the other one; only the main cell has loot (loot table
 *       condition on {@code part}), so one item drops; in creative, breaking the other cell
 *       removes the main cell without drops ({@link #playerWillDestroy}).</li>
 * </ul>
 */
public abstract class TwoCellFurnitureBlock extends HorizontalDirectionalBlock {
    protected TwoCellFurnitureBlock(Properties properties) {
        super(properties);
    }

    /** Direction from this cell to the other cell of the same piece. */
    protected abstract Direction towardOther(BlockState state);

    /** The exact state the other cell must have: this block, the same facing, the other part. */
    protected abstract BlockState otherCell(BlockState state);

    /** The cell that drops the item (bed: head, like vanilla; shell case: left). */
    protected abstract boolean isMainCell(BlockState state);

    /** The cell the player places (bed: foot; shell case: left), with its facing. */
    protected abstract BlockState placedCell(BlockPlaceContext context);

    @Override
    public @Nullable BlockState getStateForPlacement(BlockPlaceContext context) {
        BlockState state = placedCell(context);
        BlockPos other = context.getClickedPos().relative(towardOther(state));
        Level level = context.getLevel();
        return level.getBlockState(other).canBeReplaced(context) && level.getWorldBorder().isWithinBounds(other) ? state : null;
    }

    @Override
    public void setPlacedBy(Level level, BlockPos pos, BlockState state, @Nullable LivingEntity by, ItemStack itemStack) {
        super.setPlacedBy(level, pos, state, by, itemStack);
        if (!level.isClientSide()) {
            level.setBlock(pos.relative(towardOther(state)), otherCell(state), Block.UPDATE_ALL);
            // TwoCellBlockItem placed this cell without updates; do them now that the pair is complete.
            level.updateNeighborsAt(pos, Blocks.AIR);
            state.updateNeighbourShapes(level, pos, Block.UPDATE_ALL);
        }
    }

    @Override
    protected BlockState updateShape(
        BlockState state,
        LevelReader level,
        ScheduledTickAccess ticks,
        BlockPos pos,
        Direction directionToNeighbour,
        BlockPos neighbourPos,
        BlockState neighbourState,
        RandomSource random
    ) {
        if (directionToNeighbour == towardOther(state)) {
            // Each BlockState exists once, so == checks block, facing and part together.
            return neighbourState == otherCell(state) ? state : Blocks.AIR.defaultBlockState();
        }
        return super.updateShape(state, level, ticks, pos, directionToNeighbour, neighbourPos, neighbourState, random);
    }

    @Override
    public BlockState playerWillDestroy(Level level, BlockPos pos, BlockState state, Player player) {
        if (!level.isClientSide() && player.preventsBlockDrops() && !isMainCell(state)) {
            BlockPos mainPos = pos.relative(towardOther(state));
            BlockState mainState = level.getBlockState(mainPos);
            if (mainState == otherCell(state)) {
                level.setBlock(mainPos, Blocks.AIR.defaultBlockState(), Block.UPDATE_ALL | Block.UPDATE_SUPPRESS_DROPS);
                level.levelEvent(player, LevelEvent.PARTICLES_DESTROY_BLOCK, mainPos, Block.getId(mainState));
            }
        }
        return super.playerWillDestroy(level, pos, state, player);
    }
}
