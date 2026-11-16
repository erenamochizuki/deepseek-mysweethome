package com.xiaojingyu.probe;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import net.minecraft.client.Minecraft;
import net.minecraft.server.MinecraftServer;

/**
 * 把操作切到正确的线程上执行，并带超时。只在 HTTP 线程上调用。
 * - 客户端状态（界面、开关世界、截图）：客户端主线程 "Render thread"。
 * - 世界数据（方块、命令）：内置服务器线程 "Server thread"。
 * 超时抛 ProbeException(504 timeout)，HTTP 线程不会一直卡住。
 * 任务里抛的异常会原样带回 HTTP 线程（不会像 execute() 那样被吞掉）。
 */
public final class ProbeThreads {
    public static final long DEFAULT_TIMEOUT_MS = 10_000;

    private ProbeThreads() {
    }

    public static Minecraft minecraft() {
        Minecraft mc = Minecraft.getInstance();
        if (mc == null) {
            throw ProbeException.busy("client is still starting");
        }
        return mc;
    }

    /** 在 Render thread 上执行 task，最多等 timeoutMs 毫秒。 */
    public static <T> T onClient(long timeoutMs, Supplier<T> task) {
        Minecraft mc = minecraft();
        if (!mc.isRunning()) {
            throw ProbeException.busy("client is shutting down");
        }
        CompletableFuture<T> f = new CompletableFuture<>();
        // 从 HTTP 线程调用 execute() 一定是排队，不会当场执行。
        mc.execute(() -> {
            if (f.isDone()) {
                return; // HTTP 线程已经超时放弃了
            }
            try {
                f.complete(task.get());
            } catch (Throwable t) {
                f.completeExceptionally(t);
            }
        });
        return await(f, timeoutMs, "Render thread");
    }

    /**
     * 在内置服务器线程上执行 task，最多等 timeoutMs 毫秒。
     * 注意：服务器停止以后 execute() 不再排队，而是在调用者线程（这里是 HTTP 线程）上直接执行，
     * 所以先查 isStopped()，任务第一行再查一次 isSameThread()。
     */
    public static <T> T onServer(MinecraftServer server, long timeoutMs, Supplier<T> task) {
        if (server.isStopped() || !server.isRunning()) {
            throw ProbeException.notInWorld("integrated server is not running");
        }
        CompletableFuture<T> f = new CompletableFuture<>();
        server.execute(() -> {
            if (f.isDone()) {
                return;
            }
            if (!server.isSameThread()) {
                f.completeExceptionally(ProbeException.notInWorld("integrated server stopped"));
                return;
            }
            try {
                f.complete(task.get());
            } catch (Throwable t) {
                f.completeExceptionally(t);
            }
        });
        return await(f, timeoutMs, "Server thread");
    }

    /** 等一个 future，超时回 504，任务里的异常原样抛出。 */
    public static <T> T await(CompletableFuture<T> f, long timeoutMs, String where) {
        try {
            return f.get(Math.max(1, timeoutMs), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            f.cancel(false);
            throw ProbeException.timeout(where + " did not answer within " + timeoutMs + " ms");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw ProbeException.timeout("interrupted while waiting for " + where);
        } catch (ExecutionException e) {
            Throwable c = e.getCause();
            if (c instanceof RuntimeException re) {
                throw re;
            }
            if (c instanceof Error err) {
                throw err;
            }
            throw new RuntimeException(c);
        }
    }
}
