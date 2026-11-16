package com.xiaojingyu.furniture;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import com.xiaojingyu.XiaojingyuMod;
import net.minecraft.core.BlockPos;
import net.minecraft.core.SectionPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.storage.CommandStorage;
import net.minecraft.world.phys.AABB;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import org.jspecify.annotations.Nullable;

/**
 * The shell wind chime ({@code xiaojingyu:wind_chime}) rings when something alive walks in under it
 * (docs/FURNITURE.md §9.3, asked by the user on 2026-11-07): a player, an animal or a monster whose box
 * reaches into the 3 cells straight below a chime. It rings once when the creature comes in (not again
 * while it stays), at most once a second per chime: 2–3 amethyst chimes ({@link SoundEvents#AMETHYST_BLOCK_CHIME},
 * no sound files of our own) a few ticks apart, each at a slightly random pitch, played at the chime.
 *
 * <p>How: the server looks from the creatures' side. Every {@link #CHECK_EVERY} ticks it goes through the
 * living entities of each level and looks up the few cells above each one; a chime found there that was not
 * above the same entity at the last look means "just came in". So the chime block stays a plain
 * {@link FurnitureBlock}: no extra block state (the 鲸图 stays the same), no block entity (a block entity
 * would be captured into 鲸图 files and differ from the generated ones), no scheduled tick (those start in
 * {@code onPlace}, which /xjy place skips with its flags, and random ticks are rare and off in the cards).
 * Every chime works however it got into the world: placed by a player, /setblock, /xjy place, old saves.
 * Nothing is saved; after a restart a creature already standing under a chime does not ring it.
 *
 * <p>For the check cards, and only in the development game (not in a released game): every series and every
 * chime sound is counted in the command storage {@code xiaojingyu:dev}, readable with
 * {@code /data get storage xiaojingyu:dev wind_chime.rings} (series), {@code … wind_chime.hits} (sounds) and
 * {@code … wind_chime.last} (where the last series rang, {x, y, z}).
 */
public final class WindChimes {
    static final String ID = "wind_chime";
    /** How often the server looks for creatures under chimes, in ticks (a sprinting player moves about 0.6 cells). */
    static final int CHECK_EVERY = 2;
    /** How many cells below the chime count as "under it". */
    static final int BELOW = 3;
    /** The same chime does not start another series for this many ticks (1 second). */
    static final int COOLDOWN = 20;
    static final Identifier DEV_STORAGE = Identifier.fromNamespaceAndPath(XiaojingyuMod.MOD_ID, "dev");

    /** Per level: what was under which chime at the last look, when each chime last rang, sounds still to play. */
    private static final Map<ResourceKey<Level>, LevelState> LEVELS = new HashMap<>();

    private static final class LevelState {
        /** entity id → packed positions of the chimes above it at the last look (only entities under a chime) */
        Map<Integer, long[]> under = new HashMap<>();
        /** packed chime position → server tick of its last series (dropped after the cooldown) */
        final Map<Long, Integer> lastRing = new HashMap<>();
        final List<Hit> hits = new ArrayList<>();
        /** false until the first look: creatures already standing there when the world starts do not ring */
        boolean primed;
    }

    /** One chime sound still to play: packed position, server tick. */
    private record Hit(long pos, int at) {
    }

    private WindChimes() {
    }

    /** Called from {@link ModFurniture#register}: listens on the game event bus (server side only). */
    static void register() {
        NeoForge.EVENT_BUS.addListener(ServerTickEvent.Post.class, e -> tick(e.getServer()));
        NeoForge.EVENT_BUS.addListener(ServerStoppedEvent.class, e -> LEVELS.clear());
    }

    private static void tick(MinecraftServer server) {
        DeferredBlock<FurnitureBlock> holder = ModFurniture.ROUND2_BLOCKS.get(ID);
        if (holder == null) {
            return;   // the chime is not registered (FurnitureShapes.KINDS without wind_chime)
        }
        Block chime = holder.get();
        int now = server.getTickCount();
        boolean look = now % CHECK_EVERY == 0;
        for (ServerLevel level : server.getAllLevels()) {
            LevelState st = LEVELS.get(level.dimension());
            if (look) {
                if (st == null) {
                    st = new LevelState();
                    LEVELS.put(level.dimension(), st);
                }
                look(server, level, st, chime, now);
            }
            if (st != null && !st.hits.isEmpty()) {
                play(server, level, st, chime, now);
            }
        }
    }

    /** One look at a level: who is under which chime now, and who has just come in. */
    private static void look(MinecraftServer server, ServerLevel level, LevelState st, Block chime, int now) {
        st.lastRing.values().removeIf(t -> now - t >= COOLDOWN);
        Map<Integer, long[]> under = new HashMap<>();
        BlockPos.MutableBlockPos at = new BlockPos.MutableBlockPos();
        long[] found = new long[8];
        for (Entity e : level.getAllEntities()) {
            if (!(e instanceof LivingEntity) || e instanceof ArmorStand || !e.isAlive() || e.isSpectator()) {
                continue;
            }
            // A chime at (cx, cy, cz) hears the box [cx, cx+1) × [cy−BELOW, cy) × [cz, cz+1).
            AABB b = e.getBoundingBox();
            int x0 = Mth.floor(b.minX), x1 = Mth.ceil(b.maxX) - 1;
            int z0 = Mth.floor(b.minZ), z1 = Mth.ceil(b.maxZ) - 1;
            int y0 = Mth.floor(b.minY) + 1, y1 = Mth.ceil(b.maxY) + BELOW - 1;
            int n = 0;
            for (int x = x0; x <= x1; x++) {
                for (int z = z0; z <= z1; z++) {
                    if (!level.hasChunk(SectionPos.blockToSectionCoord(x), SectionPos.blockToSectionCoord(z))) {
                        continue;   // never load a chunk just to look
                    }
                    for (int y = y0; y <= y1; y++) {
                        if (level.getBlockState(at.set(x, y, z)).is(chime)) {
                            if (n == found.length) {
                                found = Arrays.copyOf(found, n * 2);
                            }
                            found[n++] = at.asLong();
                        }
                    }
                }
            }
            if (n == 0) {
                continue;
            }
            long[] mine = Arrays.copyOf(found, n);
            under.put(e.getId(), mine);
            if (st.primed) {
                long[] before = st.under.get(e.getId());
                for (long p : mine) {
                    if (before == null || !contains(before, p)) {
                        cameIn(server, level, st, p, now);
                    }
                }
            }
        }
        st.under = under;
        st.primed = true;
    }

    private static boolean contains(long[] a, long v) {
        for (long x : a) {
            if (x == v) {
                return true;
            }
        }
        return false;
    }

    /** Something has just come in under the chime at {@code pos}: start a series unless it rang less than a second ago. */
    private static void cameIn(MinecraftServer server, ServerLevel level, LevelState st, long pos, int now) {
        Integer last = st.lastRing.get(pos);
        if (last != null && now - last < COOLDOWN) {
            return;
        }
        st.lastRing.put(pos, now);
        RandomSource random = level.getRandom();
        int count = 2 + random.nextInt(2);
        int t = now;
        for (int i = 0; i < count; i++) {
            st.hits.add(new Hit(pos, t));
            t += 3 + random.nextInt(3);
        }
        devCount(server, "rings", BlockPos.of(pos));
    }

    /** Plays the chime sounds that are due (the chime must still be there). */
    private static void play(MinecraftServer server, ServerLevel level, LevelState st, Block chime, int now) {
        for (Iterator<Hit> it = st.hits.iterator(); it.hasNext(); ) {
            Hit h = it.next();
            if (h.at() > now) {
                continue;
            }
            it.remove();
            BlockPos pos = BlockPos.of(h.pos());
            if (!level.isLoaded(pos) || !level.getBlockState(pos).is(chime)) {
                continue;
            }
            float pitch = 0.8F + level.getRandom().nextFloat() * 0.8F;
            level.playSound(null, pos, SoundEvents.AMETHYST_BLOCK_CHIME, SoundSource.BLOCKS, 1.0F, pitch);
            devCount(server, "hits", null);
        }
    }

    /** Development game only: count in the command storage xiaojingyu:dev (see the class comment). */
    private static void devCount(MinecraftServer server, String key, @Nullable BlockPos pos) {
        if (FMLEnvironment.isProduction()) {
            return;
        }
        CommandStorage storage = server.getCommandStorage();
        CompoundTag all = storage.get(DEV_STORAGE).copy();
        CompoundTag c = all.getCompoundOrEmpty(ID);
        c.putInt(key, c.getIntOr(key, 0) + 1);
        if (pos != null) {
            c.putIntArray("last", new int[] {pos.getX(), pos.getY(), pos.getZ()});
        }
        all.put(ID, c);
        storage.set(DEV_STORAGE, all);
    }
}
