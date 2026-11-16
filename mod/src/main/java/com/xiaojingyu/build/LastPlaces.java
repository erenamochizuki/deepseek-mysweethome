package com.xiaojingyu.build;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.jspecify.annotations.Nullable;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

import net.minecraft.core.UUIDUtil;
import net.minecraft.world.level.saveddata.SavedData;

/**
 * The last placements of every player in this world (COMMANDS.md §2b), newest first, at most {@link #KEEP} each.
 * Saved with the world ({@code <world>/data/xiaojingyu/last_place.dat}, see {@code LastPlaceStore}), so it is
 * still there after leaving and coming back. A place adds its record when it has finished; an undo of that
 * place takes it out again, so "上次" goes back to the placement before.
 *
 * <p>Server thread only. Kept free of game classes beyond NBT/codec ones so cmdTest can check it.
 */
public final class LastPlaces extends SavedData {
    /** Same as the undo list: only the last 5 placements can be undone, older ones are not needed. */
    public static final int KEEP = 5;

    public static final Codec<LastPlaces> CODEC = RecordCodecBuilder.<LastPlaces>create(i -> i.group(
            Codec.INT.optionalFieldOf("next_id", 1).forGetter((LastPlaces d) -> d.nextId),
            Codec.unboundedMap(UUIDUtil.STRING_CODEC, PlaceRecord.CODEC.listOf())
                .optionalFieldOf("players", Map.of()).forGetter((LastPlaces d) -> d.players))
        .apply(i, LastPlaces::new));

    private final Map<UUID, List<PlaceRecord>> players = new HashMap<>();
    private int nextId;

    public LastPlaces() {
        this(1, Map.of());
    }

    private LastPlaces(int nextId, Map<UUID, List<PlaceRecord>> players) {
        this.nextId = Math.max(1, nextId);
        players.forEach((uuid, list) -> {
            List<PlaceRecord> copy = new ArrayList<>(list.subList(0, Math.min(KEEP, list.size())));
            if (!copy.isEmpty()) {
                this.players.put(uuid, copy);
            }
            for (PlaceRecord r : copy) {
                this.nextId = Math.max(this.nextId, r.id() + 1);
            }
        });
    }

    /** The player's newest placement, or null when they have none in this world. */
    public @Nullable PlaceRecord latest(UUID player) {
        List<PlaceRecord> list = players.get(player);
        return list == null || list.isEmpty() ? null : list.getFirst();
    }

    /** Newest first; a copy. */
    public List<PlaceRecord> history(UUID player) {
        return List.copyOf(players.getOrDefault(player, List.of()));
    }

    /** Stores a finished placement as the player's newest under a new id, drops the oldest beyond KEEP. Returns the id. */
    public int add(UUID player, PlaceRecord record) {
        int id = nextId++;
        List<PlaceRecord> list = players.computeIfAbsent(player, k -> new ArrayList<>());
        list.addFirst(record.withId(id));
        while (list.size() > KEEP) {
            list.removeLast();
        }
        setDirty();
        return id;
    }

    /** Takes the placement with this id out (its undo ran). True if it was there. */
    public boolean remove(UUID player, int id) {
        List<PlaceRecord> list = players.get(player);
        if (list == null || !list.removeIf(r -> r.id() == id)) {
            return false;
        }
        if (list.isEmpty()) {
            players.remove(player);
        }
        setDirty();
        return true;
    }
}
