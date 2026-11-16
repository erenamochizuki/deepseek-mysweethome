package com.xiaojingyu.probe;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.commands.CommandSource;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.blocks.BlockStateParser;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.ScheduledTickAccess;
import net.minecraft.world.level.block.BeehiveBlock;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.material.Fluid;
import net.minecraft.world.ticks.BlackholeTickAccess;
import net.minecraft.world.ticks.LevelTickAccess;
import net.minecraft.world.ticks.ScheduledTick;
import net.minecraft.world.ticks.TickPriority;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import com.xiaojingyu.probe.mixin.GuiAccessor;
import org.jspecify.annotations.Nullable;

/**
 * 在内置服务器线程上做事的接口：/command、/block、/use、/region、/shapes。
 * 读写世界只在服务器线程上做（别的线程 getBlockEntity 会返回 null，getBlockState 可能卡住）。
 */
final class ServerEndpoints {
    private static final int MAX_REGION = 64;

    private ServerEndpoints() {
    }

    /** 当前世界：服务器 + 玩家 UUID。不在世界里（或正在建/退世界）抛 409 not_in_world。 */
    private record Target(IntegratedServer server, UUID playerId) {
        static Target require() {
            ProbeSnapshot s = ProbeSnapshot.current();
            IntegratedServer server = s.server();
            UUID id = s.playerId();
            if (!s.inWorld() || server == null || id == null || ClientEndpoints.transitioning()) {
                throw ProbeException.notInWorld("not in a world");
            }
            return new Target(server, id);
        }

        /** 在服务器线程上调用。 */
        ServerPlayer player() {
            ServerPlayer p = server.getPlayerList().getPlayer(playerId);
            if (p == null) {
                throw ProbeException.notInWorld("player is not on the integrated server (yet)");
            }
            return p;
        }
    }

    // ---------------------------------------------------------------- POST /command

    static Reply command(ProbeRequest req) {
        String cmd = req.requireString("command").strip();
        if (cmd.startsWith("/")) {
            cmd = cmd.substring(1).strip();
        }
        if (cmd.isEmpty()) {
            throw ProbeException.badRequest("command is empty");
        }
        String as = req.string("as", "player");
        if (!as.equals("player") && !as.equals("server")) {
            throw ProbeException.badRequest("'as' must be \"player\" or \"server\"");
        }
        final String command = cmd;
        final boolean asPlayer = as.equals("player");
        Target t = Target.require();
        return ProbeThreads.onServer(t.server(), ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            CommandSourceStack base = asPlayer
                    ? t.player().createCommandSourceStack()
                    : t.server().createCommandSourceStack();
            Capture cap = new Capture();
            // 换掉输出对象（收集文字，不发到聊天栏）并挂上结果回调。语法错时回调不会被调用。
            CommandSourceStack stack = base.withSource(cap).withCallback((success, result) -> {
                if (success) {
                    cap.success = true;
                    cap.result += result;
                }
            });
            t.server().getCommands().performPrefixedCommand(stack, command);
            JsonObject o = Reply.newBody();
            o.addProperty("success", cap.success);
            o.addProperty("result", cap.result);
            JsonArray out = new JsonArray();
            cap.lines.forEach(out::add);
            o.add("output", out);
            return Reply.ok(o);
        });
    }

    /** 收集命令输出的 CommandSource。只在服务器线程上用。 */
    private static final class Capture implements CommandSource {
        final List<String> lines = new ArrayList<>();
        boolean success;
        int result;

        @Override
        public void sendSystemMessage(Component message) {
            lines.add(message.getString());
        }

        @Override
        public boolean acceptsSuccess() {
            return true;
        }

        @Override
        public boolean acceptsFailure() {
            return true;
        }

        @Override
        public boolean shouldInformAdmins() {
            return false;
        }
    }

    // ---------------------------------------------------------------- GET /block

    static Reply block(ProbeRequest req) {
        BlockPos pos = req.pos();
        String dim = req.string("dim", null);
        Target t = Target.require();
        return ProbeThreads.onServer(t.server(), ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            ServerLevel level = resolveLevel(t, dim);
            checkHeight(level, pos.getY(), pos.getY());
            if (!level.getChunkSource().hasChunk(pos.getX() >> 4, pos.getZ() >> 4)) {
                throw ProbeException.chunkNotLoaded("chunk " + (pos.getX() >> 4) + "," + (pos.getZ() >> 4)
                        + " of " + level.dimension().identifier() + " is not loaded");
            }
            BlockState state = level.getBlockState(pos);
            JsonObject o = Reply.newBody();
            o.add("pos", posJson(pos));
            o.addProperty("state", BlockStateParser.serialize(state));
            o.addProperty("block", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
            JsonObject props = new JsonObject();
            for (Property<?> p : state.getProperties()) { // 已按名字排好
                props.addProperty(p.getName(), valueName(p, state));
            }
            o.add("properties", props);
            o.addProperty("blockEntity", blockEntitySnbt(level, pos, state));
            return Reply.ok(o);
        });
    }

    // ---------------------------------------------------------------- POST /pick

    static Reply pick(ProbeRequest req) {
        BlockPos pos = req.pos("pos");
        boolean includeData = req.bool("includeData", true);
        Target t = Target.require();
        return ProbeThreads.onServer(t.server(), ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            ServerPlayer player = t.player();
            if (!player.hasInfiniteMaterials() || !player.isWithinBlockInteractionRange(pos, 1.0)) {
                throw ProbeException.badRequest("pick requires creative mode and a block within interaction range");
            }
            player.connection.handlePickItemFromBlock(
                new net.minecraft.network.protocol.game.ServerboundPickItemFromBlockPacket(pos, includeData));
            var item = player.getMainHandItem();
            var tag = net.minecraft.world.item.ItemStack.CODEC.encodeStart(
                player.level().registryAccess().createSerializationContext(net.minecraft.nbt.NbtOps.INSTANCE), item).getOrThrow();
            String snbt = tag.toString();
            JsonObject o = Reply.newBody();
            o.addProperty("item", BuiltInRegistries.ITEM.getKey(item.getItem()).toString());
            o.addProperty("reference", item.get(com.xiaojingyu.photo.PhotoBlockEntities.ALBUM_REFERENCE.get()));
            o.addProperty("hasAlbum", snbt.contains("Album"));
            o.addProperty("encodedBytes", snbt.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
            return Reply.ok(o);
        });
    }

    // ---------------------------------------------------------------- POST /use

    /**
     * 模拟玩家右键一个方块（2026-11-08 mod7 加，卡片换照片用）：在服务器线程上走和真右键一样的
     * {@code ServerPlayerGameMode.useItemOn}（主手、玩家手里拿的东西、NeoForge 的 RightClickBlock 事件都照常），
     * 不发真实键鼠。{@code sneak} 时临时把玩家设成潜行，做完改回去。之后等最多 2 秒，读动作栏有没有新的字。
     * 不检查够不够得着（真右键创造模式要 5 格以内，这里不管）。
     */
    static Reply use(ProbeRequest req) {
        BlockPos pos = req.pos("pos");
        String faceName = req.string("face", "up");
        Direction face = Direction.byName(faceName);
        if (face == null) {
            throw ProbeException.badRequest("face must be one of down, up, north, south, west, east");
        }
        double[] hitArg = req.doubles("hit", 3);
        boolean sneak = req.bool("sneak", false);
        Vec3 hit = hitArg != null ? new Vec3(hitArg[0], hitArg[1], hitArg[2])
                : Vec3.atCenterOf(pos).add(face.getStepX() * 0.5, face.getStepY() * 0.5, face.getStepZ() * 0.5);
        Target t = Target.require();
        Object before = ProbeThreads.onClient(ProbeThreads.DEFAULT_TIMEOUT_MS, ServerEndpoints::actionBar);
        JsonObject o = ProbeThreads.onServer(t.server(), ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            ServerPlayer player = t.player();
            ServerLevel level = player.level();
            checkHeight(level, pos.getY(), pos.getY());
            if (!level.getChunkSource().hasChunk(pos.getX() >> 4, pos.getZ() >> 4)) {
                throw ProbeException.chunkNotLoaded("chunk " + (pos.getX() >> 4) + "," + (pos.getZ() >> 4) + " is not loaded");
            }
            boolean wasSneaking = player.isShiftKeyDown();
            InteractionResult r;
            try {
                player.setShiftKeyDown(sneak);
                r = player.gameMode.useItemOn(player, level, player.getMainHandItem(), InteractionHand.MAIN_HAND,
                        new BlockHitResult(hit, face, pos, false));
            } finally {
                player.setShiftKeyDown(wasSneaking);
            }
            JsonObject body = Reply.newBody();
            body.addProperty("result", r.getClass().getSimpleName().toLowerCase(java.util.Locale.ROOT));
            body.addProperty("consumed", r.consumesAction());
            return body;
        });
        // 动作栏的字由服务器发包，客户端下一帧才收到：等它变（换成新的 Component 对象），最多 2 秒。
        long until = System.nanoTime() + 2_000_000_000L;
        Object now = before;
        while (System.nanoTime() < until) {
            now = ProbeThreads.onClient(ProbeThreads.DEFAULT_TIMEOUT_MS, ServerEndpoints::actionBar);
            if (now != before) {
                break;
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        o.addProperty("actionBar", now != before && now instanceof Component c ? c.getString() : null);
        return Reply.ok(o);
    }

    /** 客户端动作栏现在的 Component（同一句话再发一次也是新对象），没有是 null。Render thread 上调。 */
    private static @Nullable Component actionBar() {
        return ((GuiAccessor) ProbeThreads.minecraft().gui).xjyprobe$overlayMessage();
    }

    // ---------------------------------------------------------------- POST /region

    static Reply region(ProbeRequest req) {
        BlockPos a = req.pos("from");
        BlockPos b = req.pos("to");
        String dim = req.string("dim", null);
        final int x0 = Math.min(a.getX(), b.getX());
        final int y0 = Math.min(a.getY(), b.getY());
        final int z0 = Math.min(a.getZ(), b.getZ());
        final int x1 = Math.max(a.getX(), b.getX());
        final int y1 = Math.max(a.getY(), b.getY());
        final int z1 = Math.max(a.getZ(), b.getZ());
        long sx = (long) x1 - x0 + 1;
        long sy = (long) y1 - y0 + 1;
        long sz = (long) z1 - z0 + 1;
        if (sx > MAX_REGION || sy > MAX_REGION || sz > MAX_REGION) {
            throw ProbeException.tooLarge("region is " + sx + "x" + sy + "x" + sz + ", at most "
                    + MAX_REGION + "x" + MAX_REGION + "x" + MAX_REGION + " blocks");
        }
        final int w = (int) sx;
        final int h = (int) sy;
        final int l = (int) sz;
        Target t = Target.require();
        return ProbeThreads.onServer(t.server(), ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            ServerLevel level = resolveLevel(t, dim);
            checkHeight(level, y0, y1);
            for (int cx = x0 >> 4; cx <= x1 >> 4; cx++) {
                for (int cz = z0 >> 4; cz <= z1 >> 4; cz++) {
                    if (!level.getChunkSource().hasChunk(cx, cz)) {
                        throw ProbeException.chunkNotLoaded("chunk " + cx + "," + cz + " of "
                                + level.dimension().identifier() + " is not loaded");
                    }
                }
            }
            Map<BlockState, Integer> index = new LinkedHashMap<>();
            JsonArray palette = new JsonArray();
            JsonArray blocks = new JsonArray();
            JsonArray entities = new JsonArray();
            BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
            // i = x + z*宽 + y*宽*长：x 变得最快，然后 z，然后 y。
            for (int dy = 0; dy < h; dy++) {
                for (int dz = 0; dz < l; dz++) {
                    for (int dx = 0; dx < w; dx++) {
                        pos.set(x0 + dx, y0 + dy, z0 + dz);
                        BlockState state = level.getBlockState(pos);
                        Integer i = index.get(state);
                        if (i == null) {
                            i = index.size();
                            index.put(state, i);
                            palette.add(BlockStateParser.serialize(state));
                        }
                        blocks.add(i);
                        String nbt = blockEntitySnbt(level, pos, state);
                        if (nbt != null) {
                            JsonObject e = new JsonObject();
                            e.add("pos", posJson(pos));
                            e.addProperty("nbt", nbt);
                            entities.add(e);
                        }
                    }
                }
            }
            JsonObject o = Reply.newBody();
            o.add("origin", posJson(new BlockPos(x0, y0, z0)));
            JsonArray size = new JsonArray();
            size.add(w);
            size.add(h);
            size.add(l);
            o.add("size", size);
            o.add("palette", palette);
            o.add("blocks", blocks);
            o.add("blockEntities", entities);
            return Reply.ok(o);
        });
    }

    // ---------------------------------------------------------------- POST /shapes

    /** /shapes 最多回多少条 diffs，多了 truncated 为 true（changed 还是总数）。 */
    private static final int MAX_SHAPE_DIFFS = 256;

    /** 照抄 BlockBehaviour.UPDATE_SHAPE_ORDER（protected，拿不到）：西、东、北、南、下、上。顺序会影响结果。 */
    private static final Direction[] UPDATE_SHAPE_ORDER = {
        Direction.WEST, Direction.EAST, Direction.NORTH, Direction.SOUTH, Direction.DOWN, Direction.UP
    };

    /**
     * 只读：对区域里每个不是空气的格子，照 Block.updateFromNeighbourShapes 算一遍「游戏按邻居会算成什么」，
     * 和现在的状态比。不改世界、不通知邻居、不排计划刻、不动世界的随机数。
     */
    static Reply shapes(ProbeRequest req) {
        BlockPos a = req.pos("from");
        BlockPos b = req.pos("to");
        String dim = req.string("dim", null);
        final int x0 = Math.min(a.getX(), b.getX());
        final int y0 = Math.min(a.getY(), b.getY());
        final int z0 = Math.min(a.getZ(), b.getZ());
        final int x1 = Math.max(a.getX(), b.getX());
        final int y1 = Math.max(a.getY(), b.getY());
        final int z1 = Math.max(a.getZ(), b.getZ());
        long sx = (long) x1 - x0 + 1;
        long sy = (long) y1 - y0 + 1;
        long sz = (long) z1 - z0 + 1;
        if (sx > MAX_REGION || sy > MAX_REGION || sz > MAX_REGION) {
            throw ProbeException.tooLarge("region is " + sx + "x" + sy + "x" + sz + ", at most "
                    + MAX_REGION + "x" + MAX_REGION + "x" + MAX_REGION + " blocks");
        }
        final int w = (int) sx;
        final int h = (int) sy;
        final int l = (int) sz;
        Target t = Target.require();
        return ProbeThreads.onServer(t.server(), ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            ServerLevel level = resolveLevel(t, dim);
            checkHeight(level, y0, y1);
            checkLoadedWithRing(level, x0, y0, z0, x1, z1);
            // 每次请求一个新的、固定种子的随机数：不碰 level.getRandom()，结果也每次一样。
            RandomSource random = RandomSource.create(0);
            BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
            BlockPos.MutableBlockPos neighbour = new BlockPos.MutableBlockPos();
            JsonArray diffs = new JsonArray();
            int checked = 0;
            int changed = 0;
            // 和 /region 一样的顺序：x 变得最快，然后 z，然后 y，diffs 就是按格子下标排的。
            for (int dy = 0; dy < h; dy++) {
                for (int dz = 0; dz < l; dz++) {
                    for (int dx = 0; dx < w; dx++) {
                        pos.set(x0 + dx, y0 + dy, z0 + dz);
                        BlockState state = level.getBlockState(pos);
                        if (state.isAir()) {
                            continue;
                        }
                        checked++;
                        BlockState game = shapeFromNeighbours(level, state, pos, neighbour, random);
                        if (game == state) {
                            continue;
                        }
                        changed++;
                        if (diffs.size() < MAX_SHAPE_DIFFS) {
                            JsonObject d = new JsonObject();
                            d.add("pos", posJson(pos));
                            d.addProperty("state", BlockStateParser.serialize(state));
                            d.addProperty("game", BlockStateParser.serialize(game));
                            diffs.add(d);
                        }
                    }
                }
            }
            JsonObject o = Reply.newBody();
            o.add("origin", posJson(new BlockPos(x0, y0, z0)));
            JsonArray size = new JsonArray();
            size.add(w);
            size.add(h);
            size.add(l);
            o.add("size", size);
            o.addProperty("checked", checked);
            o.addProperty("changed", changed);
            o.add("diffs", diffs);
            o.addProperty("truncated", changed > diffs.size());
            return Reply.ok(o);
        });
    }

    /**
     * Block.updateFromNeighbourShapes 的只读版：同样的六个方向、同样用邻居现在的状态调 updateShape，
     * 只是计划刻交给 NOOP_TICKS（丢掉），随机数用请求自己的。
     */
    private static BlockState shapeFromNeighbours(ServerLevel level, BlockState state, BlockPos pos,
            BlockPos.MutableBlockPos neighbour, RandomSource random) {
        // 原版里只有蜂巢的 updateShape 会动世界：旁边有火时把蜜蜂放出来。它算出来的状态永远不变
        // （BeehiveBlock 和它的父类都没有改 BlockBehaviour.updateShape 的「原样返回」），所以直接跳过。
        // 只认这个类本身：别的模组继承它、自己改了 updateShape 的，照常算。
        if (state.getBlock().getClass() == BeehiveBlock.class) {
            return state;
        }
        BlockState newState = state;
        for (Direction direction : UPDATE_SHAPE_ORDER) {
            neighbour.setWithOffset(pos, direction);
            newState = newState.updateShape(level, NOOP_TICKS, pos, direction, neighbour,
                    level.getBlockState(neighbour), random);
        }
        return newState;
    }

    /** 什么都不排的计划刻：updateShape 想排的刻（比如含水方块的水）都丢掉。 */
    private static final ScheduledTickAccess NOOP_TICKS = new ScheduledTickAccess() {
        @Override
        public <T> ScheduledTick<T> createTick(BlockPos pos, T type, int tickDelay, TickPriority priority) {
            return new ScheduledTick<>(type, pos, tickDelay, priority, 0L);
        }

        @Override
        public <T> ScheduledTick<T> createTick(BlockPos pos, T type, int tickDelay) {
            return new ScheduledTick<>(type, pos, tickDelay, TickPriority.NORMAL, 0L);
        }

        @Override
        public LevelTickAccess<Block> getBlockTicks() {
            return BlackholeTickAccess.emptyLevelList();
        }

        @Override
        public LevelTickAccess<Fluid> getFluidTicks() {
            return BlackholeTickAccess.emptyLevelList();
        }
    };

    /**
     * 区域本身和外面一圈（updateShape 会读区域外的邻居）都要已经加载。只用 isLoaded 查，绝不同步加载区块。
     * y 用已经查过高度的 y0：isLoaded 对高度范围外的 y 一律回 false，而区块是否加载只看 x、z。
     */
    private static void checkLoadedWithRing(ServerLevel level, int x0, int y0, int z0, int x1, int z1) {
        long ax = (long) x0 - 1;
        long az = (long) z0 - 1;
        long bx = (long) x1 + 1;
        long bz = (long) z1 + 1;
        BlockPos.MutableBlockPos probe = new BlockPos.MutableBlockPos();
        for (long cx = ax >> 4; cx <= bx >> 4; cx++) {
            for (long cz = az >> 4; cz <= bz >> 4; cz++) {
                // 这个区块里、而且在「区域 + 一圈」范围里的一格。
                probe.set((int) Math.max(cx << 4, ax), y0, (int) Math.max(cz << 4, az));
                if (!level.isLoaded(probe)) {
                    boolean ring = cx < (x0 >> 4) || cx > (x1 >> 4) || cz < (z0 >> 4) || cz > (z1 >> 4);
                    throw ProbeException.chunkNotLoaded("chunk " + cx + "," + cz + " of "
                            + level.dimension().identifier() + " is not loaded"
                            + (ring ? " (it holds neighbours of the region; /shapes reads them too)" : ""));
                }
            }
        }
    }

    // ---------------------------------------------------------------- helpers（都在服务器线程上调用）

    /** dim 不写就用玩家所在的维度。写了不认识的维度回 400。 */
    private static ServerLevel resolveLevel(Target t, @Nullable String dim) {
        if (dim == null || dim.isBlank()) {
            return t.player().level();
        }
        Identifier id = Identifier.tryParse(dim.strip());
        if (id == null) {
            throw ProbeException.badRequest("bad dimension id '" + dim + "'");
        }
        ResourceKey<Level> key = ResourceKey.create(Registries.DIMENSION, id);
        ServerLevel level = t.server().getLevel(key);
        if (level == null) {
            throw ProbeException.badRequest("unknown dimension '" + id + "'");
        }
        return level;
    }

    private static void checkHeight(ServerLevel level, int minY, int maxY) {
        if (minY < level.getMinY() || maxY > level.getMaxY()) {
            throw ProbeException.badRequest("y must be within " + level.getMinY() + ".." + level.getMaxY()
                    + " in " + level.dimension().identifier());
        }
    }

    private static @Nullable String blockEntitySnbt(ServerLevel level, BlockPos pos, BlockState state) {
        if (!state.hasBlockEntity()) {
            return null;
        }
        BlockEntity be = level.getBlockEntity(pos);
        return be == null ? null : be.saveWithFullMetadata(level.registryAccess()).toString();
    }

    private static <T extends Comparable<T>> String valueName(Property<T> p, BlockState state) {
        return p.getName(state.getValue(p));
    }

    private static JsonArray posJson(BlockPos p) {
        JsonArray a = new JsonArray();
        a.add(p.getX());
        a.add(p.getY());
        a.add(p.getZ());
        return a;
    }
}
