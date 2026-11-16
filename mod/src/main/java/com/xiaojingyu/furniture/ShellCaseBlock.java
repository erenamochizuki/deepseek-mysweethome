package com.xiaojingyu.furniture;

import java.util.Map;

import com.mojang.serialization.MapCodec;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * {@code xiaojingyu:shell_case[facing, part=left|right]} (docs/FURNITURE.md §2): {@code facing} is the
 * way the front looks; left / right as seen standing in front of it; right = left + facing turned
 * 90° counter-clockwise. The front faces the player who places it; the clicked cell becomes the left
 * cell and the right cell goes to the player's right. Only for looks: right click does nothing.
 */
public class ShellCaseBlock extends TwoCellFurnitureBlock {
    public static final MapCodec<ShellCaseBlock> CODEC = simpleCodec(ShellCaseBlock::new);
    public static final EnumProperty<ShellCasePart> PART = EnumProperty.create("part", ShellCasePart.class);

    private final Map<Direction, VoxelShape> leftShapes = FurnitureCollision.byFacing("shell_case", "left");
    private final Map<Direction, VoxelShape> rightShapes = FurnitureCollision.byFacing("shell_case", "right");

    public ShellCaseBlock(Properties properties) {
        super(properties);
        registerDefaultState(stateDefinition.any().setValue(FACING, Direction.NORTH).setValue(PART, ShellCasePart.LEFT));
    }

    @Override
    protected MapCodec<ShellCaseBlock> codec() {
        return CODEC;
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(FACING, PART);
    }

    @Override
    protected Direction towardOther(BlockState state) {
        Direction facing = state.getValue(FACING);
        return state.getValue(PART) == ShellCasePart.LEFT ? facing.getCounterClockWise() : facing.getClockWise();
    }

    @Override
    protected BlockState otherCell(BlockState state) {
        return state.setValue(PART, state.getValue(PART).other());
    }

    @Override
    protected boolean isMainCell(BlockState state) {
        return state.getValue(PART) == ShellCasePart.LEFT;
    }

    @Override
    protected BlockState placedCell(BlockPlaceContext context) {
        return defaultBlockState().setValue(FACING, context.getHorizontalDirection().getOpposite()).setValue(PART, ShellCasePart.LEFT);
    }

    /** A mirror swaps left and right (the same fix NeoForge makes for double chests, MC-134110). */
    @Override
    protected BlockState mirror(BlockState state, Mirror mirror) {
        BlockState turned = super.mirror(state, mirror);
        return mirror == Mirror.NONE ? turned : turned.setValue(PART, turned.getValue(PART).other());
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return (state.getValue(PART) == ShellCasePart.LEFT ? leftShapes : rightShapes).get(state.getValue(FACING));
    }
}
