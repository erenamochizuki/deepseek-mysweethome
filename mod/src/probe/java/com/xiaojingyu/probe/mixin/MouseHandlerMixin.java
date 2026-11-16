package com.xiaojingyu.probe.mixin;

import com.xiaojingyu.probe.InputLock;
import java.nio.file.Path;
import java.util.List;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 锁输入时（{@link InputLock#locked()}）跳过鼠标的 GLFW 回调，也不让游戏接管鼠标。
 * 只在开发游戏的 probe 源码集里，不进发布 jar。为什么不用 NeoForge 事件：见 tmp/mod-2/INPUT-LOCK-DESIGN.md。
 *
 * <p>这些回调都在 Render thread 上执行（MouseHandler.setup 用 minecraft.execute 转过去）。
 */
@Mixin(MouseHandler.class)
public abstract class MouseHandlerMixin {
    /** 鼠标按键；也包括「点一下窗口就接管鼠标」（onButton 里调 grabMouse）。 */
    @Inject(method = "onButton", at = @At("HEAD"), cancellable = true)
    private void xjyprobe$onButton(long handle, MouseButtonInfo rawButtonInfo, int action, CallbackInfo ci) {
        if (InputLock.locked()) {
            ci.cancel();
        }
    }

    /** 滚轮：世界里会换物品栏格子，界面里会滚动列表。 */
    @Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
    private void xjyprobe$onScroll(long handle, double xoffset, double yoffset, CallbackInfo ci) {
        if (InputLock.locked()) {
            ci.cancel();
        }
    }

    /** 动鼠标：鼠标被接管时转视角，界面里是悬停。解锁后点进窗口时 grabMouse 会设 ignoreFirstMove。 */
    @Inject(method = "onMove", at = @At("HEAD"), cancellable = true)
    private void xjyprobe$onMove(long handle, double xpos, double ypos, CallbackInfo ci) {
        if (InputLock.locked()) {
            ci.cancel();
        }
    }

    /** 往窗口里拖文件（比如资源包界面）。 */
    @Inject(method = "onDrop", at = @At("HEAD"), cancellable = true)
    private void xjyprobe$onDrop(long handle, List<Path> files, int failedCount, CallbackInfo ci) {
        if (InputLock.locked()) {
            ci.cancel();
        }
    }

    /** 所有接管鼠标的路径都走这里：setScreen(null)（进世界、关界面）和点窗口。 */
    @Inject(method = "grabMouse", at = @At("HEAD"), cancellable = true)
    private void xjyprobe$grabMouse(CallbackInfo ci) {
        if (InputLock.locked()) {
            ci.cancel();
        }
    }
}
