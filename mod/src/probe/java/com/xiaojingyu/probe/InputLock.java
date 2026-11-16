package com.xiaojingyu.probe;

import com.google.gson.JsonObject;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;

/**
 * 锁输入（docs/PROBE.md 接口 9）：锁上时游戏不理会这台电脑上的键盘和鼠标。
 *
 * <p>真正拦输入的是 mixin 包里的 MouseHandlerMixin、KeyboardHandlerMixin：它们在 GLFW 回调的入口和
 * grabMouse() 开头看 {@link #locked()}，锁着就整个跳过（为什么要用 mixin 见 tmp/mod-2/INPUT-LOCK-DESIGN.md）。
 * 这里只管状态，以及每帧在 Render thread 上收尾：刚锁上时松开所有按键，锁着时鼠标还被接管就放开。
 *
 * <p>状态只在内存里，不写 options.txt。解锁时不主动接管鼠标，要等人点进窗口。
 */
public final class InputLock {
    private static volatile boolean locked;

    /** 只在 Render thread 上读写：上一帧看到的 locked。 */
    private static boolean lockedLastFrame;

    private InputLock() {
    }

    /** mixin 在 Render thread 上调用；HTTP 线程改了以后马上生效。 */
    public static boolean locked() {
        return locked;
    }

    /** 模组构造函数里调用：这时游戏窗口的输入回调还没装上，所以一启动就是锁上的。 */
    static void lockFromStart(boolean value) {
        locked = value;
    }

    /** POST /input（HTTP 线程）：直接改状态，不等 Render thread，ready 之前也能用。 */
    static Reply input(ProbeRequest req) {
        boolean value = req.requireBool("locked");
        boolean was = locked;
        locked = value;
        if (was != value) {
            ProbeMod.LOGGER.info("[xjyprobe] input {}", value ? "locked" : "unlocked");
        }
        JsonObject o = Reply.newBody();
        o.addProperty("locked", value);
        return Reply.ok(o);
    }

    /** RenderFrameEvent.Pre（Render thread）。 */
    static void onFrame() {
        boolean now = locked;
        if (now && !lockedLastFrame) {
            // 锁之前按着的键：松开的回调会被拦掉，不手动松开就会一直算按着（比如一直往前走）。
            KeyMapping.releaseAll();
        }
        lockedLastFrame = now;
        if (now) {
            Minecraft mc = Minecraft.getInstance();
            if (mc != null && mc.mouseHandler.isMouseGrabbed()) {
                mc.mouseHandler.releaseMouse();
                ProbeMod.LOGGER.info("[xjyprobe] input locked: released the mouse");
            }
        }
    }
}
