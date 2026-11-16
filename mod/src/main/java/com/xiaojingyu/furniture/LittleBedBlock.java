package com.xiaojingyu.furniture;

import java.util.Map;

import com.mojang.serialization.MapCodec;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BedPart;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * {@code xiaojingyu:bed[facing, part=head|foot]} (docs/FURNITURE.md §2): like the vanilla bed,
 * {@code facing} points from the foot to the head, head = foot + facing, and the player places the
 * foot while looking the way the head should go. Only for looks: no sleeping, right click does nothing.
 */
public class LittleBedBlock extends TwoCellFurnitureBlock {
    public static final MapCodec<LittleBedBlock> CODEC = simpleCodec(LittleBedBlock::new);
    public static final EnumProperty<BedPart> PART = BlockStateProperties.BED_PART;

    private final Map<Direction, VoxelShape> headShapes = FurnitureCollision.byFacing("bed", "head");
    private final Map<Direction, VoxelShape> footShapes = FurnitureCollision.byFacing("bed", "foot");

    public LittleBedBlock(Properties properties) {
        super(properties);
        registerDefaultState(stateDefinition.any().setValue(FACING, Direction.NORTH).setValue(PART, BedPart.FOOT));
    }

    @Override
    protected MapCodec<LittleBedBlock> codec() {
        return CODEC;
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(FACING, PART);
    }

    @Override
    protected Direction towardOther(BlockState state) {
        Direction facing = state.getValue(FACING);
        return state.getValue(PART) == BedPart.FOOT ? facing : facing.getOpposite();
    }

    @Override
    protected BlockState otherCell(BlockState state) {
        return state.setValue(PART, state.getValue(PART) == BedPart.FOOT ? BedPart.HEAD : BedPart.FOOT);
    }

    @Override
    protected boolean isMainCell(BlockState state) {
        return state.getValue(PART) == BedPart.HEAD;
    }

    @Override
    protected BlockState placedCell(BlockPlaceContext context) {
        return defaultBlockState().setValue(FACING, context.getHorizontalDirection()).setValue(PART, BedPart.FOOT);
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return (state.getValue(PART) == BedPart.HEAD ? headShapes : footShapes).get(state.getValue(FACING));
    }
}
