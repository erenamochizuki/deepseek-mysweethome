package com.xiaojingyu.build;

import java.util.UUID;

import org.jspecify.annotations.Nullable;

import com.xiaojingyu.XiaojingyuMod;

import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedDataType;

/**
 * Where {@link LastPlaces} lives: the server's own saved data ({@code MinecraftServer.getDataStorage()}, the world's
 * {@code data/} folder), one file for the whole world whatever the dimension: {@code data/xiaojingyu/last_place.dat}.
 * The game writes it on autosave and when the world closes, like its own saved data.
 */
public final class LastPlaceStore {
    static final SavedDataType<LastPlaces> TYPE = new SavedDataType<>(
        Identifier.fromNamespaceAndPath(XiaojingyuMod.MOD_ID, "last_place"), LastPlaces::new, LastPlaces.CODEC);

    private LastPlaceStore() {
    }

    /** This world's record (made empty the first time, which marks it to be written). Server thread only. */
    public static LastPlaces get(MinecraftServer server) {
        return server.getDataStorage().computeIfAbsent(TYPE);
    }

    /** The player's newest placement in this world, or null; only reads (no empty file is made). Server thread only. */
    public static @Nullable PlaceRecord latest(MinecraftServer server, UUID player) {
        LastPlaces data = server.getDataStorage().get(TYPE);
        return data == null ? null : data.latest(player);
    }
}
