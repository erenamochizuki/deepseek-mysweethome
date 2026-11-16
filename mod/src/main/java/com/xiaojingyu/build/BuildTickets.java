package com.xiaojingyu.build;

import net.minecraft.core.registries.Registries;
import net.minecraft.server.level.TicketType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

import com.xiaojingyu.XiaojingyuMod;

/** The chunk ticket that keeps a build's chunks loaded while it is being placed (COMMANDS.md §3). */
public final class BuildTickets {
    private static final DeferredRegister<TicketType> TICKET_TYPES =
        DeferredRegister.create(Registries.TICKET_TYPE, XiaojingyuMod.MOD_ID);

    /**
     * Keeps a chunk loaded (radius 0 = FULL), never times out and is not saved, so a server
     * restart drops it. (0, LOADING | KEEP_DIMENSION_ACTIVE) differs from every vanilla type,
     * which matters because TicketType is a record compared by value.
     */
    public static final DeferredHolder<TicketType, TicketType> BUILD = TICKET_TYPES.register("build",
        () -> new TicketType(0L, TicketType.FLAG_LOADING | TicketType.FLAG_KEEP_DIMENSION_ACTIVE));

    private BuildTickets() {
    }

    public static void register(IEventBus modEventBus) {
        TICKET_TYPES.register(modEventBus);
    }
}
