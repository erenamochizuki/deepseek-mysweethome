package com.xiaojingyu.probe.mixin;

import com.xiaojingyu.probe.InputLock;
import net.minecraft.client.KeyboardHandler;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.PreeditEvent;
import org.jspecify.annotations.Nullable;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 锁输入时（{@link InputLock#locked()}）跳过键盘的 GLFW 回调：所有按键（Esc、F1、F3、T、WASD、数字键……）、
 * 输入文字、输入法候选。只在开发游戏的 probe 源码集里，不进发布 jar。
 *
 * <p>keyPress 里世界中的按键（KeyMapping.set/click）没有能取消的事件，NeoForge 的 onKeyInput
 * 在最后才发、不能取消，所以只能在入口拦。这些回调都在 Render thread 上执行（KeyboardHandler.setup）。
 */
@Mixin(KeyboardHandler.class)
public abstract class KeyboardHandlerMixin {
    @Inject(method = "keyPress", at = @At("HEAD"), cancellable = true)
    private void xjyprobe$keyPress(long handle, int action, KeyEvent event, CallbackInfo ci) {
        if (InputLock.locked()) {
            ci.cancel();
        }
    }

    @Inject(method = "charTyped", at = @At("HEAD"), cancellable = true)
    private void xjyprobe$charTyped(long handle, CharacterEvent event, CallbackInfo ci) {
        if (InputLock.locked()) {
            ci.cancel();
        }
    }

    @Inject(method = "preeditCallback", at = @At("HEAD"), cancellable = true)
    private void xjyprobe$preedit(long handle, @Nullable PreeditEvent event, CallbackInfo ci) {
        if (InputLock.locked()) {
            ci.cancel();
        }
    }
}
