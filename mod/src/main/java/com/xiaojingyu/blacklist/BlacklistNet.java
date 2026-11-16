package com.xiaojingyu.blacklist;

import java.util.List;

import org.jspecify.annotations.Nullable;

import com.xiaojingyu.XiaojingyuMod;
import com.xiaojingyu.command.Msg;

import net.minecraft.commands.Commands;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;

/**
 * The two packets of the blacklist screen (COMMANDS.md §2a). The list lives on the server; the screen only
 * shows what the server sends and asks the server to change it, so it works the same on a dedicated server.
 *
 * <ul>
 *   <li>{@link Sync} (server → client): the whole list. {@code open} = open the screen ({@code /xjy
 *       blacklist}); otherwise only an already open screen updates. {@code message} is a short line for the
 *       screen (empty = none), {@code ok} picks its colour.</li>
 *   <li>{@link Edit} (client → server): add or remove one block id. The server checks the permission (same as
 *       {@code /xjy}) and the id, changes the list, and answers with a {@link Sync} (every player who may
 *       edit gets the new list, so all open screens stay right).</li>
 * </ul>
 *
 * The client handler of {@link Sync} is registered by the client-only {@code XiaojingyuClient}, so this class
 * (loaded on dedicated servers too) never touches client classes.
 */
public final class BlacklistNet {
    public static final String VERSION = "1";
    public static final int ADD = 0;
    public static final int REMOVE = 1;
    private static final int MAX_IDS = BlacklistFile.MAX_ENTRIES;

    private BlacklistNet() {
    }

    public record Sync(boolean open, List<String> ids, boolean ok, Component message) implements CustomPacketPayload {
        public static final Type<Sync> TYPE = new Type<>(Identifier.fromNamespaceAndPath(XiaojingyuMod.MOD_ID, "blacklist_sync"));
        public static final StreamCodec<RegistryFriendlyByteBuf, Sync> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.BOOL, Sync::open,
            ByteBufCodecs.stringUtf8(BlacklistFile.MAX_ID_LENGTH).apply(ByteBufCodecs.list(MAX_IDS)), Sync::ids,
            ByteBufCodecs.BOOL, Sync::ok,
            ComponentSerialization.TRUSTED_STREAM_CODEC, Sync::message,
            Sync::new);

        @Override
        public Type<Sync> type() {
            return TYPE;
        }
    }

    public record Edit(int action, String id) implements CustomPacketPayload {
        public static final Type<Edit> TYPE = new Type<>(Identifier.fromNamespaceAndPath(XiaojingyuMod.MOD_ID, "blacklist_edit"));
        public static final StreamCodec<RegistryFriendlyByteBuf, Edit> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.VAR_INT, Edit::action,
            ByteBufCodecs.stringUtf8(BlacklistFile.MAX_ID_LENGTH), Edit::id,
            Edit::new);

        @Override
        public Type<Edit> type() {
            return TYPE;
        }
    }

    /** Mod bus. The client side of {@link Sync} is registered in {@code XiaojingyuClient}. */
    public static void register(RegisterPayloadHandlersEvent event) {
        event.registrar(VERSION)
            .playToClient(Sync.TYPE, Sync.STREAM_CODEC)
            .playToServer(Edit.TYPE, Edit.STREAM_CODEC, BlacklistNet::onEdit);
    }

    /** True if this player's game has the screen (the mod is installed on their side). */
    public static boolean canOpen(ServerPlayer player) {
        return player.connection.hasChannel(Sync.TYPE);
    }

    public static boolean mayEdit(ServerPlayer player) {
        return Commands.LEVEL_GAMEMASTERS.check(player.permissions());
    }

    /** Opens the screen for this player. */
    public static void open(ServerPlayer player, Blacklist.Snapshot list, @Nullable Component message) {
        send(player, new Sync(true, list.ids(), message == null, message == null ? Component.empty() : message));
    }

    /**
     * After a command or a screen action: on a change every player who may edit gets the new list (only
     * {@code actor} gets the message); with no change only {@code actor} gets the message.
     */
    public static void afterAction(MinecraftServer server, @Nullable ServerPlayer actor, BlacklistActions.Outcome o) {
        List<String> ids = Blacklist.get().snapshot().ids();
        if (o.changed()) {
            for (ServerPlayer p : server.getPlayerList().getPlayers()) {
                if (p == actor || mayEdit(p)) {
                    send(p, new Sync(false, ids, o.ok(), p == actor ? o.gui() : Component.empty()));
                }
            }
        } else if (actor != null) {
            send(actor, new Sync(false, ids, o.ok(), o.gui()));
        }
    }

    private static void send(ServerPlayer player, Sync sync) {
        if (canOpen(player)) {
            PacketDistributor.sendToPlayer(player, sync);
        }
    }

    /** Server thread (the registrar wraps handlers to run on the main thread). */
    private static void onEdit(Edit edit, IPayloadContext context) {
        if (!(context.player() instanceof ServerPlayer player)) {
            return;
        }
        MinecraftServer server = player.level().getServer();
        if (!mayEdit(player)) {
            Component msg = Msg.t("blacklist.no_permission");
            send(player, new Sync(false, Blacklist.get().snapshot().ids(), false, msg));
            return;
        }
        BlacklistActions.Outcome o = switch (edit.action()) {
            case ADD -> BlacklistActions.add(player, edit.id());
            case REMOVE -> BlacklistActions.remove(player, edit.id());
            default -> null;
        };
        if (o == null) {
            return;
        }
        player.sendSystemMessage(o.chat());
        afterAction(server, player, o);
    }
}
