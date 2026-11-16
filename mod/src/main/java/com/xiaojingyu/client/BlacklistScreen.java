package com.xiaojingyu.client;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import org.jspecify.annotations.Nullable;

import com.xiaojingyu.blacklist.BlacklistActions;
import com.xiaojingyu.blacklist.BlacklistFile;
import com.xiaojingyu.blacklist.BlacklistNet;
import com.xiaojingyu.command.Msg;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.neoforged.neoforge.client.network.ClientPacketDistributor;

/**
 * {@code /xjy blacklist} without arguments (COMMANDS.md §2a). Top: the list (icon, name, id); click an entry
 * to remove it. Bottom left: the player's inventory; click a block to add it. Bottom right: a box to add a
 * block by id (Tab completes, Enter adds). The list comes from the server ({@link BlacklistNet.Sync}); every
 * click only asks the server ({@link BlacklistNet.Edit}), and the screen shows what the server sends back.
 */
public final class BlacklistScreen extends Screen {
    private static final Identifier SLOT_SPRITE = Identifier.withDefaultNamespace("container/slot");
    private static final int SLOT = 18;
    private static final int ROW_H = 20;
    private static final int GAP = 8;
    private static final int WHITE = 0xFFFFFFFF;
    private static final int GRAY = 0xFFA8A8A8;
    private static final int GREEN = 0xFF66E07A;
    private static final int RED = 0xFFFF6A6A;
    private static final int YELLOW = 0xFFFFD24A;
    private static @Nullable List<String> completions;

    private final List<String> ids = new ArrayList<>();
    private Component status = Component.empty();
    private boolean statusOk = true;
    private int scroll;
    private @Nullable String suggestion;

    // Layout (init)
    private int left;
    private int panelW;
    private int colW;
    private int listTop;
    private int listRows;
    private int statusY;
    private int labelY;
    private int invX;
    private int invY;
    private int sideX;
    private int sideW;
    private List<FormattedCharSequence> hintLines = List.of();
    private @Nullable EditBox idBox;
    /** The mod config page this was opened from (its 抓取黑名单 button); 完成 / Esc go back there. Null: back to the game. */
    private final @Nullable Screen parent;

    public BlacklistScreen(List<String> ids, @Nullable Screen parent) {
        super(Msg.t("blacklist.gui.title"));
        this.ids.addAll(ids);
        this.parent = parent;
    }

    /** The client handler of {@link BlacklistNet.Sync} (main thread). */
    public static void onSync(BlacklistNet.Sync sync) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null) {
            return;
        }
        if (mc.screen instanceof BlacklistScreen open) {
            open.update(sync);
        } else if (sync.open()) {
            // Asked for by the config page's button: come back to that page afterwards.
            Screen parent = CaptureConfigScreen.isOpen(mc.screen) ? mc.screen : null;
            BlacklistScreen screen = new BlacklistScreen(sync.ids(), parent);
            mc.setScreen(screen);
            screen.update(sync);
        }
    }

    private void update(BlacklistNet.Sync sync) {
        ids.clear();
        ids.addAll(sync.ids());
        if (!sync.message().getString().isEmpty()) {
            status = sync.message();
            statusOk = sync.ok();
        }
        if (idBox != null) {
            String typed = BlacklistFile.normalize(idBox.getValue());
            if (typed != null && ids.contains(typed)) {
                idBox.setValue("");
            }
        }
        clampScroll();
    }

    @Override
    protected void init() {
        panelW = Math.min(width - 16, 340);
        left = (width - panelW) / 2;
        colW = (panelW - GAP) / 2;
        hintLines = font.split(Msg.t("blacklist.gui.hint"), panelW);
        if (hintLines.size() > 3) {   // 3 行放得下整句说明（窄窗口里再多就截掉，名单框往下让）
            hintLines = hintLines.subList(0, 3);
        }
        listTop = 19 + hintLines.size() * 10 + 4;
        int invH = 3 * SLOT + 4 + SLOT;
        invY = height - 6 - invH;
        labelY = invY - 11;
        statusY = labelY - 13;
        listRows = Math.max(1, (statusY - 3 - listTop) / ROW_H);
        invX = left;
        sideX = left + 9 * SLOT + 10;
        sideW = left + panelW - sideX;

        EditBox box = new EditBox(font, sideX, invY, sideW, 18, Msg.t("blacklist.gui.by_id"));
        box.setMaxLength(BlacklistFile.MAX_ID_LENGTH);
        box.setHint(Msg.t("blacklist.gui.id_hint").withStyle(ChatFormatting.DARK_GRAY));
        box.setResponder(this::onTyped);
        idBox = addRenderableWidget(box);
        addRenderableWidget(Button.builder(Msg.t("blacklist.gui.add"), b -> submit())
            .bounds(sideX, invY + 22, sideW, 20).build());
        addRenderableWidget(Button.builder(CommonComponents.GUI_DONE, b -> onClose())
            .bounds(sideX, invY + invH - 20, sideW, 20).build());
        clampScroll();
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    @Override
    public void onClose() {
        if (parent != null && minecraft.player != null) {
            minecraft.setScreen(parent);
        } else {
            super.onClose();
        }
    }

    @Override
    public boolean isInGameUi() {
        return true;
    }

    // ---- drawing ----

    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float a) {
        super.extractRenderState(g, mouseX, mouseY, a);
        g.centeredText(font, Msg.t("blacklist.gui.title_count", ids.size()), width / 2, 6, WHITE);
        for (int i = 0; i < hintLines.size(); i++) {
            g.centeredText(font, hintLines.get(i), width / 2, 19 + i * 10, GRAY);
        }
        drawList(g, mouseX, mouseY);
        drawStatus(g, mouseX, mouseY);
        g.text(font, Msg.t("blacklist.gui.inventory"), invX, labelY, GRAY);
        g.text(font, Msg.t("blacklist.gui.by_id"), sideX, labelY, GRAY);
        drawInventory(g, mouseX, mouseY);
    }

    private void drawList(GuiGraphicsExtractor g, int mouseX, int mouseY) {
        int bottom = listTop + listRows * ROW_H;
        g.fill(left - 3, listTop - 3, left + panelW + 3, bottom + 3, 0x70000000);
        if (ids.isEmpty()) {
            List<FormattedCharSequence> lines = font.split(Msg.t("blacklist.gui.empty"), panelW - 20);
            int y = listTop + (listRows * ROW_H - lines.size() * 10) / 2;
            for (FormattedCharSequence line : lines) {
                g.centeredText(font, line, width / 2, y, GRAY);
                y += 10;
            }
            return;
        }
        int hovered = entryAt(mouseX, mouseY);
        for (int r = 0; r < listRows; r++) {
            for (int c = 0; c < 2; c++) {
                int index = (scroll + r) * 2 + c;
                if (index >= ids.size()) {
                    break;
                }
                int x = left + c * (colW + GAP);
                int y = listTop + r * ROW_H;
                drawEntry(g, ids.get(index), x, y, index == hovered);
            }
        }
        int rows = totalRows();
        if (rows > listRows) {
            int trackH = listRows * ROW_H;
            int thumbH = Math.max(8, trackH * listRows / rows);
            int thumbY = listTop + (trackH - thumbH) * scroll / (rows - listRows);
            int x = left + panelW + 1;
            g.fill(x, listTop, x + 2, bottom, 0x60FFFFFF);
            g.fill(x, thumbY, x + 2, thumbY + thumbH, 0xFFE0E0E0);
        }
        if (hovered >= 0) {
            String id = ids.get(hovered);
            g.setComponentTooltipForNextFrame(font, List.of(nameOf(id),
                Component.literal(id).withStyle(ChatFormatting.DARK_GRAY),
                Msg.t("blacklist.gui.remove_tip").withStyle(ChatFormatting.GRAY)), mouseX, mouseY);
        }
    }

    private void drawEntry(GuiGraphicsExtractor g, String id, int x, int y, boolean hovered) {
        if (hovered) {
            g.fill(x - 1, y, x + colW + 1, y + ROW_H, 0x40FFFFFF);
        }
        Optional<Block> block = BlacklistActions.block(id);
        ItemStack icon = block.map(b -> new ItemStack(b.asItem())).orElse(ItemStack.EMPTY);
        if (icon.isEmpty()) {
            g.fill(x + 2, y + 2, x + 18, y + 18, 0xFF3A3A3A);
            g.centeredText(font, "?", x + 10, y + 6, GRAY);
        } else {
            g.fakeItem(icon, x + 2, y + 2);
        }
        int textW = colW - 24;
        g.text(font, fit(nameOf(id).getString(), textW), x + 21, y + 1, block.isPresent() ? WHITE : RED);
        g.text(font, fit(id, textW), x + 21, y + 11, GRAY);
        if (hovered) {
            g.text(font, "×", x + colW - 6, y + 6, RED);
        }
    }

    private void drawStatus(GuiGraphicsExtractor g, int mouseX, int mouseY) {
        String text = status.getString();
        if (text.isEmpty()) {
            return;
        }
        String shown = fit(text, panelW);
        g.text(font, shown, left, statusY, statusOk ? GREEN : RED);
        if (!shown.equals(text) && mouseY >= statusY && mouseY < statusY + 9 && mouseX >= left && mouseX < left + panelW) {
            g.setTooltipForNextFrame(font, status, mouseX, mouseY);
        }
    }

    private void drawInventory(GuiGraphicsExtractor g, int mouseX, int mouseY) {
        Inventory inv = inventory();
        int hovered = slotAt(mouseX, mouseY);
        for (int slot = 0; slot < Inventory.INVENTORY_SIZE; slot++) {
            int[] p = slotPos(slot);
            g.blitSprite(RenderPipelines.GUI_TEXTURED, SLOT_SPRITE, p[0], p[1], SLOT, SLOT);
            ItemStack stack = inv == null ? ItemStack.EMPTY : inv.getItem(slot);
            if (stack.isEmpty()) {
                continue;
            }
            g.item(stack, p[0] + 1, p[1] + 1);
            g.itemDecorations(font, stack, p[0] + 1, p[1] + 1);
            String id = blockIdOf(stack);
            if (id == null) {
                g.fill(p[0] + 1, p[1] + 1, p[0] + 17, p[1] + 17, 0xA0202020);
            } else if (ids.contains(id)) {
                // Inside the slot's own frame, so two marked neighbours do not make the slot between them look marked.
                g.outline(p[0] + 1, p[1] + 1, SLOT - 2, SLOT - 2, YELLOW);
            }
            if (slot == hovered) {
                g.fill(p[0] + 1, p[1] + 1, p[0] + 17, p[1] + 17, 0x60FFFFFF);
                Component tip = id == null ? Msg.t("blacklist.gui.not_block_tip")
                    : ids.contains(id) ? Msg.t("blacklist.gui.in_list_tip") : Msg.t("blacklist.gui.add_tip");
                g.setComponentTooltipForNextFrame(font, List.of(stack.getHoverName(),
                    tip.copy().withStyle(id != null && !ids.contains(id) ? ChatFormatting.GRAY : ChatFormatting.GOLD)),
                    mouseX, mouseY);
            }
        }
    }

    // ---- input ----

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        if (super.mouseClicked(event, doubleClick)) {
            return true;
        }
        if (event.button() != 0) {
            return false;
        }
        int mx = (int) event.x();
        int my = (int) event.y();
        int entry = entryAt(mx, my);
        if (entry >= 0) {
            send(BlacklistNet.REMOVE, ids.get(entry));
            return true;
        }
        int slot = slotAt(mx, my);
        Inventory inv = inventory();
        if (slot >= 0 && inv != null) {
            String id = blockIdOf(inv.getItem(slot));
            if (id != null && !ids.contains(id)) {
                send(BlacklistNet.ADD, id);
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean mouseScrolled(double x, double y, double scrollX, double scrollY) {
        if (x >= left - 3 && x < left + panelW + 4 && y >= listTop - 3 && y < listTop + listRows * ROW_H + 3) {
            scroll -= (int) Math.signum(scrollY);
            clampScroll();
            return true;
        }
        return super.mouseScrolled(x, y, scrollX, scrollY);
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        if (idBox != null && idBox.isFocused()) {
            if (event.isConfirmation()) {
                submit();
                return true;
            }
            if (event.isCycleFocus() && suggestion != null) {
                idBox.setValue(idBox.getValue() + suggestion);
                return true;
            }
        }
        return super.keyPressed(event);
    }

    private void submit() {
        if (idBox != null && !idBox.getValue().isBlank()) {
            send(BlacklistNet.ADD, idBox.getValue().strip());
        }
    }

    private void send(int action, String id) {
        AbstractWidget.playButtonClickSound(minecraft.getSoundManager());
        ClientPacketDistributor.sendToServer(new BlacklistNet.Edit(action, id));
    }

    /** Grey completion after the cursor: the rest of the first block id that starts with what was typed. */
    private void onTyped(String text) {
        suggestion = completion(text);
        if (idBox != null) {
            idBox.setSuggestion(suggestion);
        }
    }

    private static @Nullable String completion(String typed) {
        if (typed.isEmpty() || !typed.equals(typed.toLowerCase(Locale.ROOT)) || typed.isBlank()) {
            return null;
        }
        boolean full = typed.indexOf(':') >= 0;
        for (String id : completions()) {
            String key = full ? id : id.startsWith("minecraft:") ? id.substring("minecraft:".length()) : null;
            if (key != null && key.startsWith(typed) && key.length() > typed.length()) {
                return key.substring(typed.length());
            }
        }
        if (!full) {
            for (String id : completions()) {
                if (id.startsWith(typed) && id.length() > typed.length()) {
                    return id.substring(typed.length());
                }
            }
        }
        return null;
    }

    /** Block ids that may be added, minecraft: first, then the others; sorted. */
    private static List<String> completions() {
        if (completions == null) {
            List<String> all = new ArrayList<>();
            for (Block b : BuiltInRegistries.BLOCK) {
                if (!BlacklistActions.alwaysAir(b)) {
                    all.add(BuiltInRegistries.BLOCK.getKey(b).toString());
                }
            }
            all.sort(Comparator.comparing((String id) -> !id.startsWith("minecraft:")).thenComparing(id -> id));
            completions = List.copyOf(all);
        }
        return completions;
    }

    // ---- geometry ----

    private int totalRows() {
        return (ids.size() + 1) / 2;
    }

    private void clampScroll() {
        scroll = Math.max(0, Math.min(scroll, totalRows() - listRows));
    }

    /** The list index under the mouse, or -1. */
    private int entryAt(int mx, int my) {
        if (my < listTop || my >= listTop + listRows * ROW_H || mx < left) {
            return -1;
        }
        int c = mx < left + colW ? 0 : mx >= left + colW + GAP && mx < left + 2 * colW + GAP ? 1 : -1;
        if (c < 0) {
            return -1;
        }
        int index = (scroll + (my - listTop) / ROW_H) * 2 + c;
        return index < ids.size() ? index : -1;
    }

    /** Inventory slots 9–35 in three rows, the hotbar 0–8 below them (like the inventory screen). */
    private int[] slotPos(int slot) {
        if (slot < 9) {
            return new int[] {invX + slot * SLOT, invY + 3 * SLOT + 4};
        }
        int i = slot - 9;
        return new int[] {invX + (i % 9) * SLOT, invY + (i / 9) * SLOT};
    }

    private int slotAt(int mx, int my) {
        for (int slot = 0; slot < Inventory.INVENTORY_SIZE; slot++) {
            int[] p = slotPos(slot);
            if (mx >= p[0] && mx < p[0] + SLOT && my >= p[1] && my < p[1] + SLOT) {
                return slot;
            }
        }
        return -1;
    }

    private @Nullable Inventory inventory() {
        return minecraft.player == null ? null : minecraft.player.getInventory();
    }

    private static @Nullable String blockIdOf(ItemStack stack) {
        if (stack.getItem() instanceof BlockItem item) {
            return BuiltInRegistries.BLOCK.getKey(item.getBlock()).toString();
        }
        return null;
    }

    private static Component nameOf(String id) {
        return BlacklistActions.block(id).<Component>map(Block::getName).orElse(Msg.t("blacklist.list_unknown"));
    }

    private String fit(String text, int w) {
        if (font.width(text) <= w) {
            return text;
        }
        return font.plainSubstrByWidth(text, w - font.width("…")) + "…";
    }
}
