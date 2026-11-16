package com.xiaojingyu.furniture;

import java.util.HashMap;
import java.util.Map;
import java.util.function.ToIntFunction;

import com.mojang.serialization.Codec;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.ScheduledTickAccess;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.level.block.LevelEvent;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;
import org.jspecify.annotations.Nullable;

/**
 * One kind of round-2 furniture (docs/FURNITURE.md §8.1): {@code xiaojingyu:<id>[facing]} for one cell,
 * {@code xiaojingyu:<id>[facing, part=0..N−1]} for N = w × d × h cells. Only for looks: right click
 * does nothing. Works like the two-cell pieces of round 1 (and the vanilla bed), for any box of cells:
 * <ul>
 *   <li>placing: the front faces the player; the clicked cell is local (w−1, 0, 0), the front-left
 *       bottom cell as seen from the front, and the piece grows to the player's right, away from the
 *       player and up. If any cell is not free nothing is placed. {@link FurnitureBlockItem} places the
 *       clicked cell without updates, {@link #setPlacedBy} the rest;</li>
 *   <li>a cell whose neighbour inside the piece is not exactly right (another block, another facing,
 *       another part) turns into air in {@link #updateShape}, which goes on through the whole piece;</li>
 *   <li>only part 0 has loot, so breaking any cell drops one item; in creative, breaking another
 *       cell first removes part 0 without drops ({@link #playerWillDestroy}).</li>
 * </ul>
 * Shapes: the outline is always the model box of the cell (FurnitureShapes.Kind.outlines); the collision
 * is the model box for {@code box}, a 1/16 high layer for {@code thin}, nothing for {@code none}.
 */
public class FurnitureBlock extends HorizontalDirectionalBlock {
    public static final MapCodec<FurnitureBlock> CODEC = RecordCodecBuilder.mapCodec(i -> i.group(
            Codec.STRING.fieldOf("furniture").forGetter(b -> b.spec.id()),
            propertiesCodec()
    ).apply(i, (id, p) -> new FurnitureBlock(FurnitureSpecs.get(id), p)));

    private static final VoxelShape THIN = Block.box(0, 0, 0, 16, 1, 16);
    /** One "part" property per cell count, shared by the blocks of that size. */
    private static final Map<Integer, IntegerProperty> PART_BY_COUNT = new HashMap<>();
    /** The spec of the block being made: createBlockStateDefinition runs inside Block's constructor. */
    private static final ThreadLocal<FurnitureSpec> MAKING = new ThreadLocal<>();

    private final FurnitureSpec spec;
    private final @Nullable IntegerProperty part;
    /** [Direction.get2DDataValue()][part] */
    private final VoxelShape[][] outline;
    private final VoxelShape[][] collision;

    public FurnitureBlock(FurnitureSpec spec, Properties properties) {
        super(making(spec, properties));
        MAKING.remove();
        this.spec = spec;
        this.part = spec.count() > 1 ? partProperty(spec.count()) : null;
        BlockState def = stateDefinition.any().setValue(FACING, Direction.NORTH);
        registerDefaultState(part == null ? def : def.setValue(part, 0));
        outline = new VoxelShape[4][spec.count()];
        collision = new VoxelShape[4][spec.count()];
        for (int p = 0; p < spec.count(); p++) {
            FurnitureSpec.Cell cell = spec.cells()[p];
            String partName = part == null ? null : Integer.toString(p);
            // Outline: the model box of the cell for every kind (a full block, with a warning, if it is missing).
            Map<Direction, VoxelShape> outlines = FurnitureCollision.byFacing(spec.id(), partName, cell.outlines());
            Map<Direction, VoxelShape> boxes = cell.collide() == FurnitureSpec.Collide.BOX && cell.boxes().length > 0
                    ? FurnitureCollision.byFacing(spec.id(), partName, cell.boxes()) : outlines;
            for (Direction facing : Direction.Plane.HORIZONTAL) {
                int f = facing.get2DDataValue();
                outline[f][p] = outlines.get(facing);
                collision[f][p] = switch (cell.collide()) {
                    case BOX -> boxes.get(facing);
                    case THIN -> THIN;
                    case NONE -> Shapes.empty();
                };
            }
        }
    }

    private static Properties making(FurnitureSpec spec, Properties properties) {
        MAKING.set(spec);
        return properties;
    }

    /** The "part" property for pieces of {@code count} cells: 0..count−1. */
    public static synchronized IntegerProperty partProperty(int count) {
        return PART_BY_COUNT.computeIfAbsent(count, n -> IntegerProperty.create("part", 0, n - 1));
    }

    public FurnitureSpec spec() {
        return spec;
    }

    /** Part of a state of this block (0 for one-cell pieces). */
    public int partOf(BlockState state) {
        return part == null ? 0 : state.getValue(part);
    }

    /**
     * The Properties.lightLevel function for a kind. It is called while Block's constructor builds the
     * states, before this block's fields are set, so it must not use the block: it reads the part from the
     * shared "part" property and the light from the spec it was made with.
     */
    public static ToIntFunction<BlockState> lightFunction(FurnitureSpec spec) {
        IntegerProperty partProperty = spec.count() > 1 ? partProperty(spec.count()) : null;
        return state -> spec.cells()[partProperty == null ? 0 : state.getValue(partProperty)].light();
    }

    @Override
    protected MapCodec<FurnitureBlock> codec() {
        return CODEC;
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        FurnitureSpec s = MAKING.get();
        if (s == null) {
            throw new IllegalStateException("FurnitureBlock made without its spec");
        }
        builder.add(FACING);
        if (s.count() > 1) {
            builder.add(partProperty(s.count()));
        }
    }

    // ---- cells ----

    /** World offset from part 0 to a local cell, for a facing (FURNITURE.md §8.1: the cells turn with the model). */
    static BlockPos offset(Direction facing, int cx, int cy, int cz) {
        return switch (facing) {
            case EAST -> new BlockPos(-cz, cy, cx);
            case SOUTH -> new BlockPos(-cx, cy, -cz);
            case WEST -> new BlockPos(cz, cy, -cx);
            default -> new BlockPos(cx, cy, cz);
        };
    }

    /** The other way: a world step (x, z) as a local step {cx, cz}, for a facing. */
    static int[] toLocal(Direction facing, int x, int z) {
        return switch (facing) {
            case EAST -> new int[] {z, -x};
            case SOUTH -> new int[] {-x, -z};
            case WEST -> new int[] {-z, x};
            default -> new int[] {x, z};
        };
    }

    private BlockState withPart(BlockState state, int p) {
        return part == null ? state : state.setValue(part, p);
    }

    /** Where part {@code p} is, for a piece whose part 0 is at {@code main}. */
    private BlockPos cellPos(BlockPos main, Direction facing, int p) {
        int[] l = spec.local(p);
        return main.offset(offset(facing, l[0], l[1], l[2]));
    }

    /** Where part 0 of the piece that has this cell is. */
    BlockPos mainPos(BlockPos pos, BlockState state) {
        int[] l = spec.local(partOf(state));
        return pos.subtract(offset(state.getValue(FACING), l[0], l[1], l[2]));
    }

    // ---- placing ----

    /** The part the player places: local (w−1, 0, 0). */
    int clickedPart() {
        return spec.part(spec.w() - 1, 0, 0);
    }

    @Override
    public @Nullable BlockState getStateForPlacement(BlockPlaceContext context) {
        Direction facing = context.getHorizontalDirection().getOpposite();
        BlockState state = withPart(defaultBlockState().setValue(FACING, facing), clickedPart());
        BlockPos clicked = context.getClickedPos();
        BlockPos main = mainPos(clicked, state);
        Level level = context.getLevel();
        for (int p = 0; p < spec.count(); p++) {
            BlockPos at = cellPos(main, facing, p);
            if (at.equals(clicked)) {
                continue;
            }
            if (!level.isInWorldBounds(at) || !level.getWorldBorder().isWithinBounds(at) || !level.getBlockState(at).canBeReplaced(context)) {
                return null;
            }
        }
        return state;
    }

    @Override
    public void setPlacedBy(Level level, BlockPos pos, BlockState state, @Nullable LivingEntity by, ItemStack itemStack) {
        super.setPlacedBy(level, pos, state, by, itemStack);
        if (!level.isClientSide() && part != null) {
            Direction facing = state.getValue(FACING);
            BlockPos main = mainPos(pos, state);
            for (int p = 0; p < spec.count(); p++) {
                BlockPos at = cellPos(main, facing, p);
                if (!at.equals(pos)) {
                    // Each new cell only makes its neighbours look at it; the ones already there are right.
                    level.setBlock(at, withPart(state, p), Block.UPDATE_ALL);
                }
            }
            // FurnitureBlockItem placed this cell without updates; do them now that the piece is complete.
            level.updateNeighborsAt(pos, Blocks.AIR);
            state.updateNeighbourShapes(level, pos, Block.UPDATE_ALL);
        }
    }

    // ---- keeping the piece whole ----

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
        if (part != null) {
            Direction facing = state.getValue(FACING);
            int[] l = spec.local(partOf(state));
            int[] step = toLocal(facing, directionToNeighbour.getStepX(), directionToNeighbour.getStepZ());
            int other = spec.part(l[0] + step[0], l[1] + directionToNeighbour.getStepY(), l[2] + step[1]);
            if (other >= 0) {
                // Each BlockState exists once, so == checks block, facing and part together.
                return neighbourState == withPart(state, other) ? state : Blocks.AIR.defaultBlockState();
            }
        }
        return super.updateShape(state, level, ticks, pos, directionToNeighbour, neighbourPos, neighbourState, random);
    }

    @Override
    public BlockState playerWillDestroy(Level level, BlockPos pos, BlockState state, Player player) {
        if (!level.isClientSide() && player.preventsBlockDrops() && partOf(state) != 0) {
            BlockPos mainPos = mainPos(pos, state);
            BlockState mainState = level.getBlockState(mainPos);
            if (mainState == withPart(state, 0)) {
                level.setBlock(mainPos, Blocks.AIR.defaultBlockState(), Block.UPDATE_ALL | Block.UPDATE_SUPPRESS_DROPS);
                level.levelEvent(player, LevelEvent.PARTICLES_DESTROY_BLOCK, mainPos, Block.getId(mainState));
            }
        }
        return super.playerWillDestroy(level, pos, state, player);
    }

    /**
     * A mirror keeps the front where it was and swaps left and right, so cx becomes w−1−cx
     * (the facing changes as for any HorizontalDirectionalBlock).
     */
    @Override
    protected BlockState mirror(BlockState state, Mirror mirror) {
        BlockState turned = super.mirror(state, mirror);
        if (mirror == Mirror.NONE || part == null) {
            return turned;
        }
        int[] l = spec.local(partOf(state));
        return withPart(turned, spec.part(spec.w() - 1 - l[0], l[1], l[2]));
    }

    // ---- shapes ----

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return outline[state.getValue(FACING).get2DDataValue()][partOf(state)];
    }

    @Override
    protected VoxelShape getCollisionShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return collision[state.getValue(FACING).get2DDataValue()][partOf(state)];
    }
}
