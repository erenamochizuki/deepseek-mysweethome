package com.xiaojingyu.probe.mixin;

import net.minecraft.client.gui.Gui;
import net.minecraft.network.chat.Component;
import org.jspecify.annotations.Nullable;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/**
 * 读动作栏（物品栏上面那一行字）现在显示的文字，给 {@code POST /use} 回给卡片看（2026-11-08 mod7 加）。
 * Gui 里这个字段是 private，没有 getter。只在开发游戏的 probe 源码集里。
 */
@Mixin(Gui.class)
public interface GuiAccessor {
    @Accessor("overlayMessageString")
    @Nullable Component xjyprobe$overlayMessage();
}
