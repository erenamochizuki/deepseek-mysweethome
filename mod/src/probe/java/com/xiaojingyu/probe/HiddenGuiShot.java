package com.xiaojingyu.probe;

import com.google.gson.JsonObject;
import com.mojang.blaze3d.platform.NativeImage;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import org.jspecify.annotations.Nullable;

/**
 * /screenshot 的 {@code hideGui: true}：截一张不带界面的画面，和按 F1 一样
 * （不画手、物品栏、准星、方块描边、聊天栏、提示框和暗角）。
 *
 * <p>步骤：在 Render thread 上记下 {@code options.hideGui} 原来的值，设成 true（{@link #arm}）；
 * 用 RenderFrameEvent 数帧（不用 tick，无人值守时只有约 17 fps），等至少 {@link #WAIT_FRAMES}
 * 个完整画完的帧；在最后那一帧的 RenderFrameEvent.Post 里截图（这时主画面已经画完，还没送去显示），
 * 截完马上改回原值。成功、出错、超时都会恢复，恢复只做一次。HTTP 线程超时放弃以后就不会再截，
 * 迟到的截图回调也不写文件。
 *
 * <p>{@code options.hideGui} 只在内存里：Options.save() 不写这个键，所以 options.txt 不会变。
 */
final class HiddenGuiShot {
    static final int WAIT_FRAMES = 2;

    /** 已经开始画的帧数（RenderFrameEvent.Pre 时加一）。只在 Render thread 上读写。 */
    private static long framesStarted;
    /** 正在等帧的那一次截图。只在 Render thread 上读写。 */
    private static @Nullable HiddenGuiShot pending;

    private final Path file;
    private final CompletableFuture<JsonObject> done = new CompletableFuture<>();
    /** 已经截了或者已经放弃了。Render thread 截图和 HTTP 线程放弃谁先抢到算谁的。 */
    private final AtomicBoolean finished = new AtomicBoolean();
    // 下面几个只在 Render thread 上读写
    private boolean applied;
    private boolean restored;
    private boolean original;
    private long shootAt;

    private HiddenGuiShot(Path file) {
        this.file = file;
    }

    /** HTTP 线程：截一张不带界面的图，最多等到 deadlineNanos（System.nanoTime 的值）。 */
    static JsonObject take(Path file, long deadlineNanos) {
        Minecraft mc = ProbeThreads.minecraft();
        HiddenGuiShot shot = new HiddenGuiShot(file);
        try {
            ProbeThreads.onClient(ClientEndpoints.remainingMs(deadlineNanos), () -> {
                shot.arm(mc);
                return null;
            });
            return ProbeThreads.await(shot.done, ClientEndpoints.remainingMs(deadlineNanos), "screenshot (hideGui)");
        } finally {
            shot.abandon(mc);
        }
    }

    /** RenderFrameEvent.Pre（Render thread）。 */
    static void onFrameStart() {
        framesStarted++;
    }

    /** RenderFrameEvent.Post（Render thread）：这一帧已经画进主画面。 */
    static void onFrameEnd() {
        HiddenGuiShot shot = pending;
        if (shot == null) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        if (shot.finished.get()) {
            pending = null; // HTTP 线程已经放弃了：不截，只恢复
            shot.restore(mc);
        } else if (framesStarted >= shot.shootAt) {
            pending = null;
            shot.shoot(mc);
        }
    }

    /** Render thread：记下原值，设成 true，开始数帧。 */
    private void arm(Minecraft mc) {
        if (finished.get()) {
            return; // HTTP 线程已经放弃了，不再改设置
        }
        HiddenGuiShot old = pending;
        if (old != null) {
            // 上一次超时放弃后还没来得及恢复：先恢复它，再记原值。
            old.finished.set(true);
            old.done.cancel(false);
            old.restore(mc);
        }
        original = mc.options.hideGui;
        mc.options.hideGui = true;
        applied = true;
        // 排队的任务只在两帧之间执行，所以下一帧（framesStarted + 1）取界面状态
        // （GameRenderer.extract）时已经是 true；在第 WAIT_FRAMES 帧画完时截。
        shootAt = framesStarted + WAIT_FRAMES;
        pending = this;
    }

    /** Render thread：截图，然后马上恢复原值。 */
    private void shoot(Minecraft mc) {
        if (!finished.compareAndSet(false, true)) {
            restore(mc);
            return;
        }
        try {
            // 拷贝画面的 GPU 命令现在就排进去了，回调要等拷完（之后某一帧）才执行；
            // 所以马上恢复 hideGui 不会影响这一张。
            Screenshot.takeScreenshot(mc.getMainRenderTarget(), this::deliver);
        } catch (Throwable t) {
            done.completeExceptionally(t);
        } finally {
            restore(mc);
        }
    }

    /**
     * 截图回调（Render thread）。HTTP 线程已经放弃的话只关掉图片，不写文件。
     * （回调开始写文件以后 HTTP 线程才超时的话，文件还是会写完，这个窗口只有几十毫秒。）
     */
    private void deliver(NativeImage image) {
        try (NativeImage img = image) {
            if (!done.isDone()) {
                done.complete(ClientEndpoints.analyzeAndSave(img, file));
            }
        } catch (Throwable t) {
            done.completeExceptionally(t);
        }
    }

    /** HTTP 线程：这一次结束了（成功也调）。还没截的话不会再截，恢复交给 Render thread。 */
    private void abandon(Minecraft mc) {
        if (finished.compareAndSet(false, true)) {
            done.cancel(false);
            mc.execute(() -> restore(mc));
        }
    }

    /** Render thread：恢复原值，只做一次；没改过就什么都不做。 */
    private void restore(Minecraft mc) {
        if (applied && !restored) {
            restored = true;
            mc.options.hideGui = original;
        }
    }
}
