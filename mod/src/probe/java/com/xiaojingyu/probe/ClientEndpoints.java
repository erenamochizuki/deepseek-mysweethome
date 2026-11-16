package com.xiaojingyu.probe;

import com.google.gson.JsonObject;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.BitSet;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.util.FileUtil;
import net.minecraft.world.Difficulty;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.levelgen.WorldOptions;
import net.minecraft.world.level.levelgen.presets.WorldPresets;
import net.neoforged.fml.loading.FMLPaths;

/**
 * 在 Render thread 上做事的接口：/status（只读快照）、/world/open、/world/leave、/screenshot、/quit。
 */
final class ClientEndpoints {
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final Pattern SHOT_NAME = Pattern.compile("[A-Za-z0-9._-]{1,64}");
    private static final long SCREENSHOT_TIMEOUT_MS = 15_000;

    /**
     * 建世界 / 退世界正在进行。只在 Render thread 上写，HTTP 线程只读。
     * 这两步都会把 Render thread 卡住一段时间（等服务器起来 / 等存盘），期间客户端不 tick。
     */
    static volatile boolean opening;
    static volatile boolean leaving;
    private static String lastCreatedFolder;

    static Reply worldReopen(ProbeRequest req) {
        String folder = ProbeThreads.onClient(ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            Minecraft mc = Minecraft.getInstance();
            if (opening || leaving || mc.level != null || mc.getSingleplayerServer() != null) {
                throw ProbeException.busy("leave the current world before reopening");
            }
            if (lastCreatedFolder == null) {
                throw ProbeException.badRequest("no world created by this probe session");
            }
            String f = lastCreatedFolder;
            opening = true;
            mc.execute(() -> {
                try {
                    mc.createWorldOpenFlows().openWorld(f, () -> mc.setScreen(new TitleScreen()));
                } finally {
                    opening = false;
                }
            });
            return f;
        });
        JsonObject o = Reply.newBody();
        o.addProperty("started", true);
        o.addProperty("folder", folder);
        return Reply.ok(o);
    }

    private ClientEndpoints() {
    }

    static boolean transitioning() {
        return opening || leaving;
    }

    // ---------------------------------------------------------------- GET /status

    static Reply status(ProbeRequest req) {
        ProbeSnapshot s = ProbeSnapshot.current();
        JsonObject o = Reply.newBody();
        o.addProperty("v", 1);
        o.addProperty("mc", ProbeMod.mcVersion());
        o.addProperty("neoforge", ProbeMod.neoForgeVersion());
        o.addProperty("pid", ProcessHandle.current().pid());
        o.addProperty("ready", s.ready());
        o.addProperty("screen", s.screen());
        o.addProperty("inWorld", s.inWorld());
        if (s.player() != null) {
            ProbeSnapshot.Player p = s.player();
            JsonObject po = new JsonObject();
            po.addProperty("x", p.x());
            po.addProperty("y", p.y());
            po.addProperty("z", p.z());
            po.addProperty("yaw", p.yaw());
            po.addProperty("pitch", p.pitch());
            po.addProperty("dimension", p.dimension());
            po.addProperty("gameMode", p.gameMode());
            o.add("player", po);
        } else {
            o.add("player", null);
        }
        o.addProperty("chunksRendered", s.chunksRendered());
        o.addProperty("fps", s.fps());
        // inputLocked 读当前状态；mouseGrabbed、windowFocused 是这一 tick 的快照。
        o.addProperty("inputLocked", InputLock.locked());
        o.addProperty("mouseGrabbed", s.mouseGrabbed());
        o.addProperty("windowFocused", s.windowFocused());
        o.addProperty("snapshotAgeMs", s.ageMs());
        return Reply.ok(o);
    }

    // ---------------------------------------------------------------- POST /world/open

    static Reply worldOpen(ProbeRequest req) {
        String name = req.string("name", null);
        if (name == null || name.isBlank()) {
            name = "probe-" + LocalDateTime.now().format(STAMP);
        }
        name = name.strip();
        if (name.length() > 100) {
            throw ProbeException.badRequest("name is longer than 100 characters");
        }
        long seed = req.number("seed", 0);
        final String worldName = name;

        // 第 1 步（Render thread，马上回）：检查状态、定文件夹名、标记 opening。
        String folder = ProbeThreads.onClient(ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            Minecraft mc = Minecraft.getInstance();
            if (opening || leaving) {
                throw ProbeException.busy("a world is being opened or closed");
            }
            if (mc.level != null || mc.player != null || mc.getSingleplayerServer() != null) {
                throw ProbeException.busy("already in a world");
            }
            String f;
            try {
                f = FileUtil.findAvailableName(mc.getLevelSource().getBaseDir(), worldName, "");
            } catch (IOException e) {
                throw ProbeException.internal("cannot pick a save folder: " + e);
            }
            opening = true;
            // 第 2 步排在后面执行：createFreshLevel 会卡住 Render thread 直到服务器就绪，
            // 所以不能放在 HTTP 线程等着的这个任务里。在 Render thread 的任务里 execute() 只会排队。
            lastCreatedFolder = f;
            mc.execute(() -> createWorld(mc, f, worldName, seed));
            return f;
        });

        JsonObject o = Reply.newBody();
        o.addProperty("started", true);
        o.addProperty("name", worldName);
        o.addProperty("folder", folder);
        return Reply.ok(o);
    }

    private static void createWorld(Minecraft mc, String folder, String name, long seed) {
        try {
            LevelSettings settings = new LevelSettings(
                    name,
                    GameType.CREATIVE,
                    new LevelSettings.DifficultySettings(Difficulty.PEACEFUL, false, false),
                    true, // 允许作弊
                    WorldDataConfiguration.DEFAULT);
            WorldOptions options = new WorldOptions(seed, false, false); // 不生成建筑、不给奖励箱
            ProbeMod.LOGGER.info("[xjyprobe] creating flat world '{}' in folder '{}' (seed {})", name, folder, seed);
            mc.createWorldOpenFlows().createFreshLevel(folder, settings, options,
                    WorldPresets::createFlatWorldDimensions, new TitleScreen());
        } catch (Exception e) {
            ProbeMod.LOGGER.error("[xjyprobe] creating world '{}' failed", folder, e);
        } finally {
            opening = false;
        }
    }

    // ---------------------------------------------------------------- POST /world/leave

    static Reply worldLeave(ProbeRequest req) {
        ProbeThreads.onClient(ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            Minecraft mc = Minecraft.getInstance();
            if (opening || leaving || mc.level == null) {
                throw ProbeException.notInWorld("not in a world");
            }
            leaving = true;
            // disconnectFromWorld 会卡住 Render thread 直到存盘完、服务器停下，同样排到后面执行。
            mc.execute(() -> {
                try {
                    mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE);
                } catch (Exception e) {
                    ProbeMod.LOGGER.error("[xjyprobe] leaving the world failed", e);
                } finally {
                    leaving = false;
                }
            });
            return null;
        });
        JsonObject o = Reply.newBody();
        o.addProperty("started", true);
        return Reply.ok(o);
    }

    // ---------------------------------------------------------------- POST /screenshot

    static Reply screenshot(ProbeRequest req) {
        long t0 = System.nanoTime();
        long deadline = t0 + SCREENSHOT_TIMEOUT_MS * 1_000_000L;
        String name = req.string("name", null);
        if (name == null || name.isEmpty()) {
            name = "shot";
        }
        if (!SHOT_NAME.matcher(name).matches()) {
            throw ProbeException.badRequest("name may only use A-Z a-z 0-9 . _ - (1-64 characters)");
        }
        boolean hideGui = req.bool("hideGui", false);
        Path file;
        try {
            file = uniqueShotPath(name);
        } catch (IOException e) {
            throw ProbeException.internal("cannot create probe-shots folder: " + e);
        }
        if (hideGui) {
            // 不带界面：先设 hideGui、等两帧再截，截完恢复（HiddenGuiShot）。
            JsonObject o = HiddenGuiShot.take(file, deadline);
            o.addProperty("ms", (System.nanoTime() - t0) / 1_000_000L);
            return Reply.ok(o);
        }

        CompletableFuture<JsonObject> done = new CompletableFuture<>();
        ProbeThreads.onClient(remainingMs(deadline), () -> {
            Minecraft mc = Minecraft.getInstance();
            // 回调不是马上执行：GPU 把画面拷出来以后（之后某一帧）才在 Render thread 上调用。
            Screenshot.takeScreenshot(mc.getMainRenderTarget(), image -> {
                try (NativeImage img = image) {
                    done.complete(analyzeAndSave(img, file));
                } catch (Throwable t) {
                    done.completeExceptionally(t);
                }
            });
            return null;
        });
        JsonObject o = ProbeThreads.await(done, remainingMs(deadline), "screenshot callback");
        o.addProperty("ms", (System.nanoTime() - t0) / 1_000_000L);
        return Reply.ok(o);
    }

    static long remainingMs(long deadlineNanos) {
        return Math.max(1, (deadlineNanos - System.nanoTime()) / 1_000_000L);
    }

    /** 算亮度和颜色数，写 PNG。在 Render thread 上（截图回调里）执行。HiddenGuiShot 也用。 */
    static JsonObject analyzeAndSave(NativeImage img, Path file) throws IOException {
        int[] px = img.getPixels(); // ARGB
        long sum = 0;
        BitSet colors = new BitSet(1 << 24);
        for (int c : px) {
            int rgb = c & 0xFFFFFF;
            colors.set(rgb);
            sum += ((rgb >> 16) & 0xFF) + ((rgb >> 8) & 0xFF) + (rgb & 0xFF);
        }
        double mean = px.length == 0 ? 0.0 : sum / (3.0 * 255.0 * px.length);
        img.writeToFile(file);

        JsonObject o = Reply.newBody();
        o.addProperty("path", file.toString());
        o.addProperty("width", img.getWidth());
        o.addProperty("height", img.getHeight());
        o.addProperty("meanBrightness", Math.round(mean * 10000.0) / 10000.0);
        o.addProperty("distinctColors", colors.cardinality());
        return o;
    }

    private static Path uniqueShotPath(String name) throws IOException {
        Path dir = FMLPaths.GAMEDIR.get().resolve("probe-shots").toAbsolutePath().normalize();
        Files.createDirectories(dir);
        String base = name + "-" + LocalDateTime.now().format(STAMP);
        Path p = dir.resolve(base + ".png");
        for (int i = 2; Files.exists(p); i++) {
            p = dir.resolve(base + "-" + i + ".png");
        }
        return p;
    }

    // ---------------------------------------------------------------- POST /quit

    static Reply quit(ProbeRequest req) {
        Minecraft mc = ProbeThreads.minecraft();
        JsonObject o = Reply.newBody();
        // 先把回复发出去，再让 Render thread 调 stop()。
        return Reply.okThen(o, () -> mc.execute(mc::stop));
    }
}
