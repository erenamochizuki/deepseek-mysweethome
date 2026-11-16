# NeoForge 26.1 API 参考（探针 xjyprobe / 小鲸鱼之家 用）

维护：api-research（task-3 / P0-C）。只有我改这个文件；发现错误请告诉我或 lead。

**适用版本**：Minecraft 26.1.2，NeoForge 26.1.2.76（用户游戏里装的版本），Java 25，ModDevGradle 2.0.148。

**出处怎么写**
- MC 源码路径一律省略开头的 `net/minecraft/`，例如 `client/Minecraft.java:1639` = `net/minecraft/client/Minecraft.java` 第 1639 行；`com/mojang/...` 照写。来源是反编译的 MC 源码（含 NeoForge 补丁），即 `transformSources/output.zip` 里的路径。我解压的 .126 版在 `tmp/api-research/src/`，mod 队友解压的 .76 版在 `tmp/mod/src76/`。
- `nf:` 开头 = NeoForge 自己的源码，路径省略 `net/neoforged/neoforge/`。.126 在 `tmp/api-research/neo-src/`，.76 在 `tmp/mod/nfsrc/`。
- FML 和事件总线（`net.neoforged.fml.*`、`net.neoforged.bus.*`）没有源码，用 javap 看的 class（FML loader 11.0.13 和 11.0.15、bus 8.0.5）。
- 「HANDOFF §x」= mod 队友在 .76 源码里逐条核对的记录 `tmp/mod/HANDOFF.md` 第 x 节。

**.76 和 .126**：我主要读的是 .126，之后把两版逐文件对比了一遍（附录 A）。本文用到的类，除附录 A 列出的几个文件，两版逐字相同，行号两版通用。差异文件里的行号会标「.126 行号」。

**标记**：「待验证」= 只从源码推断，还没在游戏里跑过，或没找到直接证据。「未找到」= 查过，没有。

---

## 0. 速查

| 要做的事 | 用这个 | 出处 |
|---|---|---|
| 切到客户端主线程 | `mc.submit(Supplier<V>)` 返回 `CompletableFuture<V>`；`mc.execute(Runnable)` | util/thread/BlockableEventLoop.java:62、:103 |
| 切到服务器线程 | `server.submit(...)` / `server.execute(...)`，提交前先判断 `!server.isStopped()` | 同上；server/MinecraftServer.java:1508 |
| 拿内置服务器 | `mc.getSingleplayerServer()`（可能为 null） | client/Minecraft.java:2597 |
| 截图 | `Screenshot.takeScreenshot(mc.getMainRenderTarget(), Consumer<NativeImage>)`，异步 | client/Screenshot.java:93 |
| 存 PNG | `NativeImage.writeToFile(Path)` | com/mojang/blaze3d/platform/NativeImage.java:355 |
| 新建世界并进入 | `mc.createWorldOpenFlows().createFreshLevel(...)` | client/gui/screens/worldselection/WorldOpenFlows.java:95 |
| 进已有存档 | `mc.createWorldOpenFlows().openWorld(id, onCancel)` | WorldOpenFlows.java:303 |
| 退到主菜单 | `mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE)`。注意它会清空主线程任务队列（§4.6） | client/Minecraft.java:2218、:2260 |
| 退出游戏 | `mc.stop()` | client/Minecraft.java:1639 |
| BlockState 转字符串 | `BlockStateParser.serialize(state)` | commands/arguments/blocks/BlockStateParser.java:497 |
| 字符串转 BlockState | `BlockStateParser.parseForBlock(BuiltInRegistries.BLOCK, s, allowNbt)` | 同上 :88 |
| 方块实体 NBT | `be.saveWithFullMetadata(level.registryAccess())` | world/level/block/entity/BlockEntity.java:123 |
| 执行命令 | `server.getCommands().performPrefixedCommand(stack, cmd)` | commands/Commands.java:312 |
| 捕获命令输出 | 自定义 `CommandSource` + `stack.withSource(...)` + `stack.withCallback(...)` | commands/CommandSourceStack.java:130、:214 |
| 注册命令 | 监听 `RegisterCommandsEvent`（在 `NeoForge.EVENT_BUS` 上） | nf: event/RegisterCommandsEvent.java |
| 冻结 / 单步 tick | 原版 `/tick freeze`、`/tick step <n>`；代码里 `server.tickRateManager()` | server/commands/TickCommand.java:22-53；server/MinecraftServer.java:1854 |
| 预置 options.txt | 第一行 `version:4790`；改视距要加 `graphicsPreset:"custom"`（§4.10） | client/Options.java:1703-1707；client/Minecraft.java:525 |
| 注册方块、物品、创造页 | `DeferredRegister.Blocks.registerBlock` / `Items.registerItem`（替你 `setId`）、`Registries.CREATIVE_MODE_TAB`（§11） | nf: registries/DeferredRegister.java:433、:679 |
| 自己的网络包、开界面 | `RegisterPayloadHandlersEvent` → `registrar.playToServer` / `playToClient(type, codec)`，客户端处理在 `RegisterClientPayloadHandlersEvent`；界面重写 `extractRenderState`（§12） | nf: network/registration/PayloadRegistrar.java |
| 模组配置、配置界面（滑块） | `ModConfigSpec.Builder().defineInRange(…)` → `container.registerConfig(ModConfig.Type.COMMON, spec)`；客户端入口 `container.registerExtensionPoint(IConfigScreenFactory.class, (mod, parent) -> new ConfigurationScreen(mod, parent))`；范围 < 256 的整数自动是滑块；文件改了自己重读（§14） | nf: common/ModConfigSpec.java、client/gui/ConfigurationScreen.java |
| 方块实体（存、同步）、方块实体渲染器、动态贴图、右键 | `new BlockEntityType<>(工厂, Set.of(方块))`；`getUpdateTag` 管区块包、`getUpdatePacket` 管变化；`BlockEntityRenderer<T, S>` 的 `extractRenderState` / `submit`，`submitCustomGeometry` + `RenderTypes.text(贴图)`；`DynamicTexture` + `TextureManager.register` / `release`；`useItemOn` / `useWithoutItem`（§15） | world/level/block/entity/BlockEntityType.java:293；client/renderer/blockentity/BlockEntityRenderer.java |
| 跟着存档存自己的数据 | `extends SavedData` + `new SavedDataType<>(id, 构造器, codec)`，`server.getDataStorage().computeIfAbsent(type)` / `get(type)`，改了 `setDirty()`（§13.1） | world/level/storage/SavedDataStorage.java:74 |

---

## 1. 版本事实

### 1.1 26.1 不再混淆，直接用 Mojang 官方名
- 结论：26.1 的游戏 jar 本身就是官方名。开发环境里没有 SRG / intermediary 之类的中间名，看到的类名方法名就是运行时的名字。
- 证据：
  - NeoForm 配置（`neoform-26.1.2-1.zip` 里的 `config.json`，spec 6）的步骤只有 downloadManifest、downloadJson、downloadClient、downloadServer、listLibraries、preProcessJar（合并 client 和 server）、decompile（Vineflower 1.11.2）、patch，**没有改名（rename / mappings）这一步**。
  - 版本清单 `minecraft_26.1.2_version_manifest.json`（`~/.gradle/caches/neoformruntime/artifacts/`）的 downloads 只有 client 和 server，**没有 client_mappings / server_mappings**。
  - 原版 client jar 里的类名本身就可读（例如 `net/minecraft/client/Minecraft.class`）。MDK 自带的 README 也说用的是 Mojang 官方名。
- 跟 1.21 比，探针会碰到的变化：
  - `ResourceLocation` 改名为 `net.minecraft.resources.Identifier`：`Identifier.parse(String)`（resources/Identifier.java:45）、`fromNamespaceAndPath(String, String)`（:41）、`withDefaultNamespace(String)`（:49）、`@Nullable tryParse(String)`（:53，HANDOFF §2.4）。`ResourceKey.identifier()`（resources/ResourceKey.java:55）。
  - `@Nullable` 统一用 `org.jspecify.annotations.Nullable`（jspecify 1.0.0）。
  - 游戏规则改成注册表 + 蛇形命名（§4.4）；权限不再是 int（§6.5）；`/time` 改成时钟模型（§4.4）；方块实体 NBT 读写改用 `ValueInput` / `ValueOutput`（§5.5）。

### 1.2 Java 25
- zip 根目录的 `version.json`：`"java_version": 25`，运行时组件 `java-runtime-epsilon`；`world_version` 4790，协议 775，资源包格式 84.0，数据包格式 101.1。
- MDK `build.gradle`：`java.toolchain.languageVersion = JavaLanguageVersion.of(25)`。NeoForm 配置 `java_target: 25`。

### 1.3 渲染后端
- 只有 OpenGL：`GpuBackend[] backends = new GpuBackend[]{new GlBackend()};`（client/Minecraft.java:464）。依赖里是 LWJGL 3.4.1 的 opengl / glfw / stb，没有 vulkan。
- 但渲染代码全部走 `com.mojang.blaze3d.systems` 下的抽象层：`GpuDevice`（`RenderSystem.getDevice()`，com/mojang/blaze3d/systems/RenderSystem.java:263）、`CommandEncoder`、`GpuBuffer`、`GpuTexture`。**不要自己调 `glReadPixels`**，截图用原版 `Screenshot`（§3）。
- NeoForge 在开发环境默认开着 B3D 校验层：`enableB3DValidationLayer` 默认值是 `!FMLEnvironment.isProduction()`（nf: client/config/NeoForgeClientConfig.java:78），会多一点开销。要关就在 `config/neoforge-client.toml` 写 `enableB3DValidationLayer = false`。

### 1.4 依赖版本（userdev 的 config.json）

| 组件 | .76 | .126 |
|---|---|---|
| NeoForm | 26.1.2-1 | 26.1.2-1 |
| FML（loader / earlydisplay） | 11.0.13 | 11.0.15 |
| 事件总线 bus | 8.0.5 | 8.0.5 |
| accesstransformers | 11.0.2 | 11.0.2 |
| mixin / MixinExtras | 0.17.3+mixin.0.8.7 / 0.5.4（.76 的 pom） | 0.17.4+mixin.0.8.7 / 0.5.5 |
| brigadier / DFU / LWJGL / netty / authlib | 1.3.10 / 9.0.19 / 3.4.1 / 4.2.7 / 7.0.63（来自 MC 的版本 json，两版相同） | 同左 |

.76 的 userdev：`~/.gradle/caches/modules-2/files-2.1/net.neoforged/neoforge/26.1.2.76/1d3b47d0.../neoforge-26.1.2.76-userdev.jar`。

### 1.5 ModDevGradle 2.0.148 的关键配置（照 MDK 模板）
```groovy
plugins { id 'net.neoforged.moddev' version '2.0.148' }
java.toolchain.languageVersion = JavaLanguageVersion.of(25)
neoForge {
    version = project.neo_version          // ★ 写 26.1.2.76
    runs {
        client { client() }
        server { server(); programArgument '--nogui' }
        gameTestServer { type = "gameTestServer" }
        data { clientData() }
        configureEach { logLevel = org.slf4j.event.Level.DEBUG }
    }
    mods { "${mod_id}" { sourceSet(sourceSets.main) } }
}
```
- ★ **`neo_version` 要写 `26.1.2.76`**，不要用 MDK 默认的 `26.1.2.126`。原因：模板 `neoforge.mods.toml` 里对 neoforge 的依赖是 `versionRange="[${neo_version},)"`，用 .126 构建出来的 jar，用户的 .76 游戏会拒绝加载。
- `gradle.properties`：`minecraft_version=26.1.2`、`minecraft_version_range=[26.1.2]`、`org.gradle.configuration-cache=true`。Gradle wrapper 9.2.1。
- 26.1 的 `neoforge.mods.toml` 模板里没有 `modLoader` / `loaderVersion` 两行了（第一项就是 `license`）。
- 客户端启动类是 `net.neoforged.fml.startup.Client`（userdev config）。`--enable-native-access=ALL-UNNAMED`、`--sun-misc-unsafe-memory-access=allow` 等 JVM 参数由 userdev 配置自动带上，不用自己加。
- 第二个开发专用模组的写法见 §8。

### 1.6 版本号怎么读、官方迁移资料、还要注意的改名
- **版本号四段**：NeoForge 26.1 的博客说，版本号是「MC 版本三段 + NeoForge 发布号」，例：`26.1.0.10-beta` = MC 26.1.0、NeoForge 发布号 10，`-beta` 表示还允许破坏性改动（<https://neoforged.net/news/26.1release/>）。所以 `26.1.2.76` = MC 26.1.2 + NeoForge 发布号 76，没有 `-beta`。NeoForm 版本改成 `<MC 版本>-<NeoForm 构建号>`，我们的是 `26.1.2-1`（.76 和 .126 的 userdev 配置都是这个）。
- **同一篇博客的升级要求**：Java 25（toolchain 也要 25）、Gradle 9.1.0 以上（MDK 用 9.2.1）、MDG 写博客时最新 2.0.141（我们 2.0.148，更新）；官方名本身可读，Parchment 可以不用。
- **官方迁移手册**（primer）：<https://github.com/neoforged/.github/blob/main/primers/26.1/index.md>，本地副本 `tmp/api-research/web/primer-26.1.md`（约 300 KB）。查「某个方法去哪了」先在这里搜，再回源码确认。
- **探针以外、写正式模组时会碰到的改名**（博客列出，我在 .126 源码里确认过类和方法存在）：

| 旧（1.21.x） | 26.1 | 出处 |
|---|---|---|
| `GuiGraphics` | `GuiGraphicsExtractor` | client/gui/GuiGraphicsExtractor.java |
| `Screen.render(...)` | `extractRenderState(GuiGraphicsExtractor, int, int, float)` | client/gui/screens/Screen.java:120（.126 行号；.76 是 :117） |
| `renderBackground(...)` | `extractBackground(...)` | Screen.java:386（.126 行号；.76 是 :383） |
| `new ChunkPos(blockPos)` / `asLong()` / `new ChunkPos(long)` | `ChunkPos.containing(BlockPos)` / `pack(...)` / `unpack(long)`；`ChunkPos` 现在是 record | world/level/ChunkPos.java:20、:48、:76/:80、:52 |
| 配方等数据里的 `ItemStack` | `ItemStackTemplate`（record：item、count、components）；`template.create()` 变成 `ItemStack`，反过来 `ItemStackTemplate.fromNonEmptyStack(stack)` | world/item/ItemStackTemplate.java:19、:94、:82 |
| `server.getGlobalGameRules()` | 已 `@Deprecated`，直接用 `server.getGameRules()`（同一个对象） | server/MinecraftServer.java:2220-2222、:2233 |
| `performPrefixedCommand` 返回 int（mcdev-probe 1.20.1 就是拿它当结果） | 返回 `void`，成败靠 `withCallback`（§6.2） | commands/Commands.java:312 |

---

## 2. 线程

### 2.1 客户端主线程（"Render thread"）
- 客户端主线程就叫 `Render thread`（client/main/Main.java:229-231）。
- `public class Minecraft extends ReentrantBlockableEventLoop<Runnable>`（client/Minecraft.java:271），它本身就是一个任务队列。继承来的方法（util/thread/BlockableEventLoop.java）：
  - `public <V> CompletableFuture<V> submit(Supplier<V> supplier)`（:62）：要返回值时用。
  - `public CompletableFuture<Void> submit(Runnable)`（:79，`@CheckReturnValue`）。
  - `public void execute(Runnable command)`（:103）：不要返回值、不等结果时用。
  - `public void executeBlocking(Runnable)`（:88）：内部 join，没有超时，**别用**。
  - `public boolean isSameThread()`（:43）。
- 「排队」还是「当场执行」，由 `scheduleExecutables()` 决定：
  - 基类：`return !this.isSameThread();`（BlockableEventLoop.java:49-51）。
  - `ReentrantBlockableEventLoop` 覆盖成 `return this.runningTask() || super.scheduleExecutables();`（util/thread/ReentrantBlockableEventLoop.java:11-12）。Minecraft 和 MinecraftServer 都继承它。
  - `submit(Supplier)`：`return this.scheduleExecutables() ? CompletableFuture.supplyAsync(supplier, this) : CompletableFuture.completedFuture(supplier.get());`（:63）。`execute` 同理：要排队就 `schedule(task)`，否则 `doRunTask(task)` 当场跑（:103-110）。
  - 所以：从 HTTP 线程调 → 排队；在主线程上、不在任务里 → 当场跑；**在主线程的任务里再 submit → 排队**，这时如果在同一线程上 `.get()` 等它，就是死锁。
- 任务什么时候跑：每帧一次，`runTick` 里的 `runAllTasks()`（client/Minecraft.java:1293）。窗口最小化、游戏暂停时也跑；进世界的加载循环里也跑（§4.2）。
- 异常：任务里抛的异常只打一行日志 `Error executing task on {}`，然后被吞掉（BlockableEventLoop.java:161）。用 `submit` 时异常会进 future；用 `execute` 就自己 try/catch。
- 判断当前线程：`RenderSystem.isOnRenderThread()`（com/mojang/blaze3d/systems/RenderSystem.java:91）。在别的线程调渲染 API 会抛 `IllegalStateException("Rendersystem called from wrong thread")`（:95）。
- `Minecraft` 常用的 public 字段（只在主线程上读写）：`screen`（:365）、`level`（:352，@Nullable ClientLevel）、`player`（:353，@Nullable LocalPlayer）、`gameMode`（:351，@Nullable）、`options`（:305）、`gameDirectory`（:311）、`levelRenderer`（:293）。
- 示例（HTTP 线程里查当前界面）：
```java
Minecraft mc = Minecraft.getInstance();
String screen = mc.submit(() -> mc.screen == null ? "none" : mc.screen.getClass().getSimpleName())
                  .get(5, TimeUnit.SECONDS);   // 超时抛 TimeoutException
```

### 2.2 内置服务器线程
- 拿 server：
  - `public @Nullable IntegratedServer getSingleplayerServer()`（client/Minecraft.java:2597）。不在世界里是 null，退出世界时会被置 null（:2273，HANDOFF §2.1）。
  - 或 NeoForge 的 `ServerLifecycleHooks.getCurrentServer()`（nf: server/ServerLifecycleHooks.java:130）。
  - 这两个字段都不是为跨线程读设计的。稳妥做法：在主线程上取（`mc.submit(mc::getSingleplayerServer)`），或者在 `ServerStartedEvent` 里把 server 存进自己的 `volatile` 字段，`ServerStoppingEvent` 里清掉（§7.4）。
- `public abstract class MinecraftServer extends ReentrantBlockableEventLoop<TickTask> implements CommandSource, ServerInfo, ChunkIOErrorReporter`（server/MinecraftServer.java:194）。`server.submit(...)` / `server.execute(...)` 的用法和客户端一样。
- ★ **服务器停止以后（2026-11-05 订正）**：
  - `MinecraftServer` 把 `scheduleExecutables()` 覆盖成 `return super.scheduleExecutables() && !this.isStopped();`（server/MinecraftServer.java:1508-1510）。
  - 所以服务器停了以后，`execute()` 和 `submit()` **既不排队也不抛异常，而是直接在调用者线程（比如 HTTP 线程）上执行任务**（BlockableEventLoop.java:63、:103-110）。这时在 HTTP 线程上碰世界是不安全的。
  - 只有 `executeIfPossible(Runnable)` 会在停止后抛 `RejectedExecutionException("Server already shutting down")`（MinecraftServer.java:1513-1519）。
  - 写法：提交前先判断 `server != null && !server.isStopped()`；任务第一行再确认 `server.isSameThread()`，不是就直接失败。也可以改用 `executeIfPossible` 并 catch `RejectedExecutionException`。
  - 我之前发给 mod 的消息里说「execute 会抛 RejectedExecutionException」，是错的，以这里为准（mod 队友在 .76 里核对发现，HANDOFF §2.2、§2.9；我已在源码里复核）。
  - 服务器停止前已经排进队列、还没跑的任务，可能永远不执行。等 future 一定要带超时。
- 游戏暂停时：服务器任务照常执行，只是不跑世界 tick。`IntegratedServer.tickServer`（client/server/IntegratedServer.java:128-160）暂停时走 `tickPaused()`；服务器主循环每一轮都在 `waitUntilNextTick` 里 `runAllTasks()`（server/MinecraftServer.java:879-887）。所以暂停时读方块、执行命令都没问题；但「放完方块等几 tick 看效果」这类需要世界 tick 的事，要先取消暂停。
- 示例：
```java
IntegratedServer server = mc.submit(mc::getSingleplayerServer).get(5, TimeUnit.SECONDS);
if (server == null || server.isStopped()) throw new IllegalStateException("not in world");
String s = server.submit(() -> {
    if (!server.isSameThread()) throw new IllegalStateException("server stopped");
    return BlockStateParser.serialize(server.overworld().getBlockState(new BlockPos(0, -61, 0)));
}).get(5, TimeUnit.SECONDS);
```

### 2.3 读世界必须在服务器线程
- `Level.getBlockEntity(BlockPos)` 在别的线程上调**直接返回 null**（world/level/Level.java:671，条件 `!this.isClientSide() && Thread.currentThread() != this.thread`）。
- `Level.getBlockState` 在别的线程上调会走 `ServerChunkCache.getChunk`，它会 `CompletableFuture.supplyAsync(..., mainThreadProcessor).join()` 去等服务器线程（server/level/ServerChunkCache.java:146-148）。服务器忙或停了，HTTP 线程就卡住。
- 结论：所有读写世界的代码都包进 `server.submit(...)`。

### 2.4 别嵌套阻塞
- 只让 HTTP 线程阻塞一次，并且带超时。不要在主线程的任务里 `server.submit(...).join()`，也不要在服务器线程里等主线程，两边互等就死锁。
- 需要「先主线程、再服务器线程」时，用 future 串起来：
```java
CompletableFuture<String> f = mc.submit(mc::getSingleplayerServer)
    .thenCompose(server -> server.submit(() -> "...这里在服务器线程..."));
String r = f.get(10, TimeUnit.SECONDS);
```
  `thenCompose` 里的 lambda 在主线程上执行，它只是把任务交给服务器、不等结果，所以不会卡住主线程。

---

## 3. 截图

### 3.1 API
- `public static void takeScreenshot(RenderTarget target, Consumer<NativeImage> callback)`（client/Screenshot.java:93）。
- `public static void takeScreenshot(RenderTarget target, int downscaleFactor, Consumer<NativeImage> callback)`（:97）。宽高要能被 `downscaleFactor` 整除，否则抛 `IllegalArgumentException("Image size is not divisible by downscale factor")`；缩小时取块内平均色。
- target 用 `mc.getMainRenderTarget()`（client/Minecraft.java:973），类型 `com.mojang.blaze3d.pipeline.RenderTarget`；宽高是 public 字段 `width` / `height`（RenderTarget.java:19-20）。
- 帧缓冲还没准备好（颜色纹理为 null）时抛 `IllegalStateException("Tried to capture screenshot of an incomplete framebuffer")`。

### 3.2 线程和时序
- **必须在 Render thread 上调**，并且不能在 render pass 里面调，否则 `copyTextureToBuffer` 抛 `IllegalStateException("Close the existing render pass before performing additional commands")`（com/mojang/blaze3d/systems/CommandEncoder.java:323）。`mc.execute(...)` 提交的任务在帧开头跑，正合适。
- **是异步的**：内部建一个 GPU buffer，`copyTextureToBuffer` 把像素读回，然后 `RenderSystem.queueFencedTask(callback)`（com/mojang/blaze3d/opengl/GlCommandEncoder.java:264-270）。回调要等 GPU fence 完成，在之后某一帧的 `RenderSystem.executePendingTasks()` 里执行（RenderSystem.java:243-261；调用点 client/Minecraft.java:1379），仍在 Render thread 上。所以要用 `CompletableFuture` 把结果交回 HTTP 线程。
- 回调拿到的 `NativeImage` 已经上下翻正，alpha 固定 255。**接收方负责 `close()`**。原版就是放到 IO 线程写完文件再关（client/renderer/GameRenderer.java:637-660，.126 行号）。

### 3.3 NativeImage
- `public final class NativeImage implements AutoCloseable`（com/mojang/blaze3d/platform/NativeImage.java:40），可以写 `try (img) { ... }`。
- `getWidth()`（:207）、`getHeight()`（:211）。
- `public int getPixel(int x, int y)`（:231）返回 **ARGB**（内部存的是 ABGR，`getPixelABGR` 是 private）。
- `public int[] getPixels()`（:282）：整张图的 ARGB 数组（逐个转换）；`getPixelsABGR()`（:271）不转换。
- `public void writeToFile(Path file) throws IOException`（:355）写 PNG（STB）；另有 `writeToFile(File)`（:321）。
- 直接拿 PNG 字节的方法：未找到。要字节就先写临时文件，再 `Files.readAllBytes`。
- 拆通道：`net.minecraft.util.ARGB` 的 `alpha(int)`（:52）、`red`（:56）、`green`（:60）、`blue`（:64）。
- IO 线程：`Util.ioPool()`（util/Util.java:214）返回 `TracingExecutor`，它 `implements Executor`（TracingExecutor.java:9，HANDOFF §2.6）。原版截图就这么用（client/Screenshot.java:52）。

### 3.4 截到的是什么
- 主渲染目标每帧开头清空（client/renderer/GameRenderer.java:436-440，.126 行号），GUI 也画在它上面（:475）。所以在两帧之间截，得到的是**上一帧的完整画面，包括 GUI**（准星、聊天、暂停菜单），和按 F2 一样。
- 进世界或 tp 之后，区块要先编译完才画得出来。原版自动截图的条件是 `levelRenderer.countRenderedSections() > 10 && levelRenderer.hasRenderedAllSections()`（GameRenderer.java:635-660，.126 行号；client/renderer/LevelRenderer.java:351、:1515）。注意 `hasRenderedAllSections()` 只表示「编译队列空了」（`sectionRenderDispatcher.isQueueEmpty()`），tp 后的前一两个 tick 队列可能还是空的。所以先等几个 tick，再等它变 true（HANDOFF §2.6）。
- 窗口最小化时照样渲染（只是不 blit 到屏幕，client/Minecraft.java:1385），但帧率被压到 10。
- 窗口失焦 500 ms 后会自动打开暂停菜单（`pauseIfInactive`，client/Minecraft.java:1430），截图里就会有菜单。options.txt 写 `pauseOnLostFocus:false`（§4.10）。

### 3.5 另一个入口：Screenshot.grab
- `public static void grab(File workDir, @Nullable String forceName, RenderTarget target, int downscaleFactor, Consumer<Component> callback)`（client/Screenshot.java:31）。F2 用的就是它（client/KeyboardHandler.java:487，.126 行号）。图存到 `workDir/screenshots/`，会触发 NeoForge 的 `ScreenshotEvent`（可取消、可改文件名，nf: client/event/ScreenshotEvent.java）。回调只给一条提示文字，拿不到图像，探针一般不用它。

### 3.6 完整示例（截图 + 存 PNG + 平均亮度 + 不同颜色数）
```java
record Shot(Path file, int w, int h, double meanLuma, int distinctColors) {}

static CompletableFuture<Shot> shoot(Minecraft mc, Path out) {
    CompletableFuture<Shot> f = new CompletableFuture<>();
    mc.execute(() -> {
        try {
            Screenshot.takeScreenshot(mc.getMainRenderTarget(), img -> Util.ioPool().execute(() -> {
                try (img) {
                    int[] px = img.getPixels();                      // ARGB
                    BitSet seen = new BitSet(1 << 24);
                    double sum = 0;
                    for (int c : px) {
                        sum += 0.299 * ARGB.red(c) + 0.587 * ARGB.green(c) + 0.114 * ARGB.blue(c);  // 0..255
                        seen.set(c & 0xFFFFFF);
                    }
                    img.writeToFile(out);
                    f.complete(new Shot(out, img.getWidth(), img.getHeight(), sum / px.length, seen.cardinality()));
                } catch (Throwable t) { f.completeExceptionally(t); }
            }));
        } catch (Throwable t) { f.completeExceptionally(t); }
    });
    return f;   // HTTP 线程：f.get(15, TimeUnit.SECONDS)
}
```

---

## 4. 世界

### 4.1 新建超平坦 + 创造 + 允许作弊的世界并进入
- 入口：`public WorldOpenFlows createWorldOpenFlows()`（client/Minecraft.java:2146）。
- `public void createFreshLevel(String levelId, LevelSettings levelSettings, WorldOptions options, Function<HolderLookup.Provider, WorldDimensions> dimensionsProvider, Screen parentScreen)`（client/gui/screens/worldselection/WorldOpenFlows.java:95）。`levelId` 是存档文件夹名。
- 参数：
  - `public record LevelSettings(String levelName, GameType gameType, LevelSettings.DifficultySettings difficultySettings, boolean allowCommands, WorldDataConfiguration dataConfiguration, Lifecycle lifecycle)`（world/level/LevelSettings.java:8）。NeoForge 补了不带 lifecycle 的 5 参数构造器（:12，lifecycle 取 stable）。游戏规则已经不在 LevelSettings 里了。
  - `record DifficultySettings(Difficulty difficulty, boolean hardcore, boolean locked)`（:71），`DEFAULT` =（NORMAL, false, false）（:72）。
  - `public WorldOptions(long seed, boolean generateStructures, boolean generateBonusChest)`（world/level/levelgen/WorldOptions.java:27）。
  - `public static WorldDimensions createFlatWorldDimensions(HolderLookup.Provider registries)`（world/level/levelgen/presets/WorldPresets.java:68），写成方法引用 `WorldPresets::createFlatWorldDimensions`。
  - `WorldDataConfiguration.DEFAULT`（world/level/WorldDataConfiguration.java:19）。
  - 不重名的文件夹名：`public static String findAvailableName(Path baseDir, String baseName, String suffix) throws IOException`（util/FileUtil.java:32）。baseDir 用 `mc.getLevelSource().getBaseDir()`（world/level/storage/LevelStorageSource.java:387）。
- 原版模板：选择世界界面的「调试世界」按钮（client/gui/screens/worldselection/SelectWorldScreen.java:115-141）就是这样调的，只是它用旁观模式和普通地形。
- 示例：
```java
mc.execute(() -> {
    try {
        String id = FileUtil.findAvailableName(mc.getLevelSource().getBaseDir(), "xjy-test", "");
        LevelSettings settings = new LevelSettings("xjy-test", GameType.CREATIVE,
                new LevelSettings.DifficultySettings(Difficulty.PEACEFUL, false, false),
                true,                                     // allowCommands：允许作弊
                WorldDataConfiguration.DEFAULT);
        WorldOptions opts = new WorldOptions(12345L, false, false);   // 不生成结构，不要奖励箱
        mc.createWorldOpenFlows().createFreshLevel(id, settings, opts,
                WorldPresets::createFlatWorldDimensions, new TitleScreen());
    } catch (Throwable t) { LOGGER.error("create world failed", t); }
});
```
  import：`net.minecraft.world.level.{GameType, LevelSettings, WorldDataConfiguration}`、`net.minecraft.world.Difficulty`、`net.minecraft.world.level.levelgen.WorldOptions`、`net.minecraft.world.level.levelgen.presets.WorldPresets`、`net.minecraft.util.FileUtil`、`net.minecraft.client.gui.screens.TitleScreen`。
- `createFreshLevel` 不会弹「实验性设置」确认框：那个确认只在建世界界面走的 `confirmWorldCreation` 里（WorldOpenFlows.java:276），`createFreshLevel` 不经过它。
- 数据包加载失败时，它打日志 `Failed to load datapacks, can't proceed with server load`，然后 `setScreen(parentScreen)`。

### 4.2 它会占住主线程：发出去不等，然后轮询
- `createFreshLevel` 是同步的：先在主线程上加载数据包（`loadWorldDataBlocking` 里 `minecraft.managedBlock`，WorldOpenFlows.java:238），再进 `doWorldLoad`（client/Minecraft.java:2150）。
- `doWorldLoad` 显示 `LevelLoadingScreen`，然后在主线程上循环，直到服务器就绪（client/Minecraft.java:2187-2197）：
```java
while (!this.singleplayerServer.isReady() || this.overlay != null) {
    screen.tick(); ...
    this.renderFrame(false);
    this.runAllTasks();
    this.managedBlock(() -> Util.getNanos() > finishTime);
}
```
- 这段时间里：`execute()` 提交的新任务**照样执行**（循环里有 `runAllTasks()`）；但**客户端不 tick**（只调了 `renderFrame(false)`，没有调 `tick()`），所以 **`ClientTickEvent` 不发**（HANDOFF §2.1、§2.9）。另外 `ClientTickEvent.Post` 只在游戏加载完成后才发（client/Minecraft.java:1981，HANDOFF §2.1）。探针的轮询和超时逻辑不要依赖客户端 tick 事件。
- 所以 HTTP 侧**不要用 `mc.submit(...).get(短超时)` 等它**，那个 future 要等进完世界才完成，必然超时。做法：`mc.execute(...)` 发出去，立刻返回「已开始」，然后轮询：
```java
boolean ready = mc.submit(() -> mc.level != null && mc.player != null
        && !(mc.screen instanceof LevelLoadingScreen)).get(5, TimeUnit.SECONDS);
```
  `mc.level`、`mc.player` 比加载界面先变成非 null（HANDOFF §2.3）。区块准备好后，`LevelLoadingScreen` 在自己的 `tick()` 里关掉（client/gui/screens/LevelLoadingScreen.java:85-90）。整体超时建议 120 秒。截图前还要等区块画完（§3.4）。
- 已经在一个世界里时：建议先退到主菜单（§4.6），退完再建。直接调 `createFreshLevel` 也许可以（`doWorldLoad` 开头会 `disconnectWithProgressScreen()`），但没验证。

### 4.3 超平坦默认地形
- `FlatLevelGeneratorSettings.getDefault(...)`（world/level/levelgen/flat/FlatLevelGeneratorSettings.java:204-218）：1 层基岩、2 层泥土、1 层草方块；生物群系平原；结构集合是要塞和村庄。
- 主世界 minY = -64（data/worldgen/DimensionTypes.java:51），所以：基岩 y=-64，泥土 -63 和 -62，草方块 -61，玩家脚在 y=-60。
- `WorldOptions` 的 `generateStructures` 传 false，就不生成村庄（world/level/chunk/status/ChunkStatusTasks.java:42）。
- 出生点不一定正好在 (0, -60, 0)，测试前先 tp。
- 自定义层（比如全是石头）要自己构造 `FlatLevelGeneratorSettings`，本文没查。更简单的办法是进世界后用 `/fill`。

### 4.4 游戏规则和 /time（26.1 改了）
- 游戏规则改成注册表 + 蛇形命名（world/level/gamerules/GameRules.java）。常用的：

| 规则 id | 常量 | 行 |
|---|---|---|
| `advance_time` | `ADVANCE_TIME` | :24 |
| `advance_weather` | `ADVANCE_WEATHER` | :25 |
| `block_drops` | `BLOCK_DROPS` | :29 |
| `command_block_output` | `COMMAND_BLOCK_OUTPUT` | :32 |
| `keep_inventory` | `KEEP_INVENTORY` | :46 |
| `log_admin_commands` | `LOG_ADMIN_COMMANDS` | :50 |
| `max_block_modifications`（默认 32768，管 /fill 的上限） | `MAX_BLOCK_MODIFICATIONS` | :51 |
| `max_command_forks` / `max_command_sequence_length` | `MAX_COMMAND_FORKS` / `MAX_COMMAND_SEQUENCE_LENGTH` | :52 / :53 |
| `mob_griefing` | `MOB_GRIEFING` | :61 |
| `random_tick_speed` | `RANDOM_TICK_SPEED` | :74 |
| `send_command_feedback` | `SEND_COMMAND_FEEDBACK` | :77 |
| `spawn_mobs` / `spawn_monsters` | `SPAWN_MOBS` / `SPAWN_MONSTERS` | :81 / :82 |
| `tnt_explodes` | `TNT_EXPLODES` | :89 |

- 数据修复里确认的改名：`doDaylightCycle` → `advance_time`、`doMobSpawning` → `spawn_mobs`、`doWeatherCycle` → `advance_weather`（util/datafix/fixes/GameRuleRegistryFix.java:58、:64、:70）。其余规则的旧名对应关系没有逐个查。
- 读写：`public <T> T get(GameRule<T> gameRule)`（GameRules.java:124）；`public <T> void set(GameRule<T> gameRule, T value, @Nullable MinecraftServer server)`（:133）。拿 GameRules：`server.getGameRules()`（server/MinecraftServer.java:2233）；`ServerLevel.getGameRules()` 也是转到 server 的（server/level/ServerLevel.java:1857）。
- `createFreshLevel` 不能传游戏规则（它给 IntegratedServer 传的是 `Optional.empty()`）。进世界后在服务器线程上设：
```java
server.execute(() -> {
    GameRules rules = server.getGameRules();
    rules.set(GameRules.ADVANCE_TIME, false, server);
    rules.set(GameRules.ADVANCE_WEATHER, false, server);
    rules.set(GameRules.SPAWN_MOBS, false, server);
});
```
- 命令写法：`/gamerule advance_time false`，写成 `/gamerule minecraft:advance_time false` 也行。命令树里每条规则只注册这两个字面量：`literal(gameRule.id())` 和 `literal(gameRule.getIdentifier().toString())`（server/commands/GameRuleCommand.java:14-25）。所以命令里写旧名（如 `doDaylightCycle`）不在命令树里，会报解析错误（源码确认，没实跑）。旧存档里的旧名由 `GameRuleRegistryFix` 自动迁移。
- `/time` 改成了「世界时钟」模型（server/commands/TimeCommand.java:46-104）：子命令有 `set`、`add`、`query`、`pause`、`resume`、`rate`、`of <时钟>`。`set` 下面有两个并列参数（:64-82）：
  - `time`（`TimeArgument`）→ 设默认时钟的总刻数（`setTotalTicks`，:68-69）。
  - `timemarker`（`IdentifierArgument`）→ 跳到时间标记（`setTimeToTimeMarker`，:72-78）。`day` 这种不是数字的词会按标记 id 解析（`minecraft:day`）。主世界的时间线预设了 `day`=1000、`noon`=6000、`night`=13000、`midnight`=18000（world/timeline/Timelines.java:47-50；标记名在 world/clock/ClockTimeMarkers.java:9-12）。所以 **`/time set day`、`/time set noon` 在 26.1 照样能用**（源码确认，没实跑）。找不到标记报 `ERROR_NO_TIME_MARKER_FOUND`（TimeCommand.java:38）。
  - 测试里两种都行，数字更稳：`/time set 6000`（正午）。
- **冻结 / 单步 tick 用原版 `/tick`**，不用自己写 Mixin（mcdev-probe 写了，见 §9）：`/tick query`、`rate <每秒刻数>`、`step [刻数|stop]`、`sprint <刻数>|stop`、`freeze`、`unfreeze`（server/commands/TickCommand.java:22-53，要 `LEVEL_ADMINS`，:23；单人房主是 OWNER，够用）。代码里：`server.tickRateManager()`（server/MinecraftServer.java:1854）返回 `ServerTickRateManager`：`setFrozen(boolean)`（server/ServerTickRateManager.java:28）、`stepGameIfPaused(int ticks)`（:41，没冻结时返回 false）、`setTickRate(float)`（:115）；查状态 `isFrozen()`（world/TickRateManager.java:52）。都在服务器线程上调。

### 4.5 进入已有存档
- `public void openWorld(String levelId, Runnable onCancel)`（WorldOpenFlows.java:303）。先用 `mc.getLevelSource().levelExists(levelId)`（world/level/storage/LevelStorageSource.java:375）判断存档在不在。
- 中途可能弹的界面：存档损坏（RecoverWorldDataScreen）、要备份或升级（BackupConfirmScreen，:359）、需要文件修复（ConfirmScreen）、数据包加载失败（DatapackLoadFailureScreen）、旧的实验性世界（:517-544，存档里记录过「已确认」就不弹）、磁盘空间不足（:568-598）。我们自己用同一版本新建的存档一般都不会遇到。
- 之后同样走 `doWorldLoad`，同样占住主线程，判断完成的方法同 §4.2。
- 示例（`QuickPlay` 里就是这么写的，client/quickplay/QuickPlay.java:90）：
```java
mc.execute(() -> {
    if (mc.getLevelSource().levelExists(id))
        mc.createWorldOpenFlows().openWorld(id, () -> mc.setScreen(new TitleScreen()));
});
```

### 4.6 退出到主菜单
- `public void disconnectFromWorld(Component message)`（client/Minecraft.java:2218）。暂停菜单的「保存并退出到标题界面」调的就是 `this.minecraft.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE)`（client/gui/screens/PauseScreen.java:114）。`ClientLevel.DEFAULT_QUIT_MESSAGE` 在 client/multiplayer/ClientLevel.java:131。
- 在 Render thread 上调。它也是同步的：存档、`server.halt(false)`，然后 `renderFrame` 循环直到 `server.isShutdown()`（client/Minecraft.java:2257-2294），最后 `setScreen(new TitleScreen())`。所以同样 `mc.execute` 发出去，再轮询 `mc.level == null && mc.screen instanceof TitleScreen`。
- ★ 两个坑（mod-2 发现，我在源码里确认过）：
  - `disconnect` 一开头就调 `this.dropAllTasks()`（client/Minecraft.java:2260），它把主线程任务队列整个清空（`pendingRunnables.clear()`，util/thread/BlockableEventLoop.java:116-118）。**断开之前已经 `mc.execute` / `mc.submit` 进队列、还没执行的任务会被直接丢掉**，对应的 future 永远不会完成，只能靠 HTTP 线程的超时兜底。别在发出「退出世界」的同时排别的主线程任务。
  - 等存档的 `while (!server.isShutdown()) this.renderFrame(false);`（:2294-2296）只画帧，不跑任务队列（`runAllTasks` 只在 `runTick` 里，§2.1）。所以存档期间新交给 `mc.execute` 的任务要等存档完才执行。

### 4.7 让游戏正常退出
- `public void stop()`（client/Minecraft.java:1639）：`if (isRunning()) NeoForge.EVENT_BUS.post(new GameShuttingDownEvent()); this.running = false;`。
- 主循环结束后走 `destroy()`（:1207）：发 `ClientStoppingEvent` → 在世界里就断开并存档 → 关窗口 → 发 `ClientStoppedEvent` → `System.exit(0)`。
- 建议 `mc.execute(mc::stop)`：放到主线程上调，HTTP 线程先把响应发出去。
- JVM 还有个关闭钩子线程 `Client Shutdown Thread`，会 `halt(true)` 内置服务器（client/main/Main.java:212-225），这是兜底。

### 4.8 quickPlay 启动参数
- 参数（client/main/Main.java:66-69）：`--quickPlayPath`、`--quickPlaySingleplayer`、`--quickPlayMultiplayer`、`--quickPlayRealms`。
- `--quickPlaySingleplayer <存档文件夹名>` 可用，但**只能进已有存档，不能新建**。名字不存在会显示 DisconnectedScreen（`quickplay.error.invalid_identifier`，client/quickplay/QuickPlay.java:90）。不写名字就进最近玩过的存档（:75）。
- `--quickPlayPath` 是可选的，只是 quickPlay 日志文件的路径（client/quickplay/QuickPlayLog.java:45，参数 @Nullable）。
- 只能给一个 quickPlay 参数，否则抛 `IllegalArgumentException("Only one quick play option can be specified")`（client/main/Main.java:255-278）。
- quickPlay 在初始界面之后才执行（client/Minecraft.java:761-777）。NeoForge 的加载警告界面会挡住它（§4.9）。
- 推荐用法：第一次通过 HTTP 用 `createFreshLevel` 建好测试存档；之后在 runs 里加 `--quickPlaySingleplayer <文件夹名>`（§8.4），启动直接进。

### 4.9 首次启动的弹窗，怎么避开

| 界面 | 触发条件 | 避开办法 | 出处 |
|---|---|---|---|
| 无障碍引导 AccessibilityOnboardingScreen | `options.onboardAccessibility` 为 true（默认） | options.txt 写 `onboardAccessibility:false` | client/Minecraft.java:784 |
| NeoForge 模组加载警告 LoadingErrorScreen | 有加载警告，且 `showLoadWarnings` 为 true（默认） | `config/neoforge-client.toml` 写 `showLoadWarnings = false`（顶层键）。之后只打日志 `Mods loaded with {} warning(s)` | nf: client/loading/ClientModLoader.java:90-104；nf: client/config/NeoForgeClientConfig.java:50-53 |
| 教程提示 | 只在生存模式出现 | 创造模式本来没有；保险起见 `tutorialStep:none` | client/tutorial/Tutorial.java:79-104 |
| 实验性设置警告 | 建世界界面勾了实验性内容，或打开旧的实验性世界 | 用 `createFreshLevel` 不会出现 | WorldOpenFlows.java:276、:517-544 |
| 暂停菜单 | 窗口失焦 500 ms | `pauseOnLostFocus:false` | client/Minecraft.java:1430 |
| 封禁通知、多人游戏警告 | 需要在线账号资料 | 开发环境是离线模式，拿不到资料，不会出现 | client/Minecraft.java:782 起 |

- `neoforge-client.toml` 的文件名：FML 的配置文件名格式是 `%s-%s.toml`（modid-类型，javap 看 `net.neoforged.fml.config.ConfigTracker`），NeoForge 用 `ModConfig.Type.CLIENT` 注册（nf: ClientNeoForgeMod.java:103，.126 行号），所以是 `<游戏目录>/config/neoforge-client.toml`。第一次启动后才会生成；可以提前自己写一个只有 `showLoadWarnings = false` 这一行的文件。**实测（mod-2，2026-11-06）**：NeoForge 打一行 WARN「Configuration file … neoforge-client.toml is not correct. Correcting」，自动补上缺的键（之后文件里有 8 个键），我们写的 `showLoadWarnings = false` 保留，加载警告界面没弹。

### 4.10 options.txt（键名以 Options.java 为准）
- 文件在游戏目录（runs 的 gameDirectory，默认 `run/`）。每行 `键:值`（client/Options.java，processOptions :1449-1581）。
- ★ **第一行写 `version:4790`**（26.1.2 的数据版本）。没有 version 时按 0 处理，所有历史 DataFixer 都会跑一遍（Options.java:1703-1707）；游戏自己保存时第一行就是 version（:1716）。
- 探针推荐内容：
```
version:4790
onboardAccessibility:false
pauseOnLostFocus:false
inactivityFpsLimit:"minimized"
tutorialStep:none
narrator:0
lang:zh_cn
soundCategory_master:0.0
musicToast:"never"
skipMultiplayerWarning:true
realmsNotifications:false
graphicsPreset:"custom"
renderDistance:8
simulationDistance:5
```
- ★ **想让 `renderDistance` / `simulationDistance` 生效，必须同时写 `graphicsPreset:"custom"`**（mod-2 发现并实测，我在源码里确认过）。启动时会执行 `this.options.applyGraphicsPreset(this.options.graphicsPreset().get())`（client/Minecraft.java:525）。默认预设是 `FANCY`（client/Options.java:141），它会把视距改成 16、模拟距离改成 12（client/GraphicsPreset.java:68、:70）；`FAST` 是 8 / 6（:47、:49），`FABULOUS` 是 32 / 12（:89、:91）。`CUSTOM` 在 `GraphicsPreset.apply` 的 switch（:43）里没有分支，什么都不改。mod-2 实测：写了 `graphicsPreset:"custom"` 以后，启动完还是 `renderDistance:8`、`simulationDistance:5`。
- 值的格式：照游戏自己保存的样子写。枚举类的选项值带双引号（`graphicsPreset:"custom"`、`inactivityFpsLimit:"minimized"`、`musicToast:"never"`）；数字、布尔和 `lang`、`tutorialStep` 不带引号。依据：游戏退出时重写的 mod/run/options.txt 就是这样，mod-2 的 mod/dev/options.txt 也照这个写。读取用 `LenientJsonParser.parse`（Options.java:1629），保存用 `encodeStart(JsonOps.INSTANCE, ...)`（:1731）。
- 键说明：

| 键 | 行 | 说明 |
|---|---|---|
| `pauseOnLostFocus` | :1529 | 默认 true。失焦自动暂停 |
| `onboardAccessibility` | :1556 | 默认 true。首次启动的无障碍引导 |
| `tutorialStep` | :1541 | 默认 movement。可选 movement / find_tree / punch_tree / open_inventory / craft_planks / none（client/tutorial/TutorialSteps.java:9-14） |
| `lang` | :1521 | 默认 en_us |
| `narrator` | :1475 | 整数：0 关，1 全部，2 聊天，3 系统。默认 0 |
| `soundCategory_<名字>` | :1576 | 0.0–1.0。名字：master、music、record、weather、block、hostile、neutral、player、ambient、voice、ui（sounds/SoundSource.java:4-14） |
| `inactivityFpsLimit` | :1473 | `afk`（默认）或 `minimized`。afk：60 秒没有输入降到 30fps，10 分钟降到 10fps（com/mojang/blaze3d/platform/FramerateLimitTracker.java:29-63）。探针长时间没人操作，**必须改成 minimized** |
| `maxFps` | :1471 | 帧率上限 |
| `enableVsync` | :1453 | 垂直同步 |
| `renderDistance` / `simulationDistance` | :1480 / :1481 | 内置服务器会跟着客户端设置走。**不写 `graphicsPreset:"custom"` 会被预设覆盖**（见上） |
| `graphicsPreset` | :1463 | `"fast"` / `"fancy"`（默认）/ `"fabulous"` / `"custom"`（client/GraphicsPreset.java:17-20）。启动时会套用一次 |
| `guiScale` | :1468 | 影响截图里 GUI 的大小 |
| `fullscreen` | :1465 | |
| `overrideWidth` / `overrideHeight` | :1530 / :1531 | 覆盖窗口尺寸（client/Minecraft.java:453） |
| `musicToast` | :1559 | never / pause / pause_and_toast |
| `skipMultiplayerWarning` / `joinedFirstServer` / `realmsNotifications` / `hideSplashTexts` / `showAutosaveIndicator` | :1546 / :1548 / :1500 / :1512 / :1550 | |
| `key_<按键名>` | :1564 | 按键绑定 |

- 如果 AFK 限帧没改掉，也可以每次收到 HTTP 请求时调 `mc.getFramerateLimitTracker().onInputReceived()` 重置计时（`getFramerateLimitTracker()` 在 client/Minecraft.java:2911；`public void onInputReceived()` 在 com/mojang/blaze3d/platform/FramerateLimitTracker.java:70）。

### 4.11 在代码里改选项（兜底）
- `Options` 的 public 字段：`pauseOnLostFocus`（:323）、`tutorialStep`（:439）、`languageCode`（:883）、`onboardAccessibility`（:912）。其他选项是 `OptionInstance<T>`，用 `get()` / `set(T)`（client/OptionInstance.java:131、:144）：`inactivityFpsLimit()`（:986）、`narrator()`（:1385）、`getSoundSourceOptionInstance(SoundSource)`（:1249）、`renderDistance()`（:960）、`framerateLimit()`（:972）、`enableVsync()`（:1187）。保存：`save()`（:1714）。
- 时机：`@Mod` 构造器里还没有 Minecraft 实例（client/main/Main.java:122 的 `ClientModLoader.begin()` 比 `new Minecraft` 早），options 也还没加载。要在 `FMLClientSetupEvent` 里用 `enqueueWork` 改：这时 options 已加载（client/Minecraft.java:442），初始界面还没建（:695 `ClientModLoader.finish()`，:761 才建初始界面）。待验证：这个顺序没在游戏里跑过。
```java
modBus.addListener(FMLClientSetupEvent.class, e -> e.enqueueWork(() -> {
    Options o = Minecraft.getInstance().options;
    o.onboardAccessibility = false;
    o.pauseOnLostFocus = false;
    o.tutorialStep = TutorialSteps.NONE;
    o.inactivityFpsLimit().set(InactivityFpsLimit.MINIMIZED);
    o.narrator().set(NarratorStatus.OFF);
    o.getSoundSourceOptionInstance(SoundSource.MASTER).set(0.0);
    o.save();
}));
```
- 建议两样都做：启动前先写好 `run/options.txt`（这样第一次启动就不会出现无障碍引导），代码里再强制一遍（防止被改回去）。语言只在 options.txt 里改；代码里改要重载资源。

---

## 5. 方块

### 5.1 读单个方块

**结论**：在服务器线程上用 `ServerLevel.getBlockState(pos)`。先判断高度在世界范围内、区块已加载。高度越界时返回 `VOID_AIR`；区块没加载时它会同步加载甚至生成区块，卡住服务器线程。

**签名**
- `MinecraftServer.overworld()` → `ServerLevel`（server/MinecraftServer.java:1227）
- `MinecraftServer.getLevel(ResourceKey<Level>)` → `@Nullable ServerLevel`（:1231）。键用 `Level.OVERWORLD / NETHER / END`（world/level/Level.java:95-97），或 `ResourceKey.create(Registries.DIMENSION, Identifier.parse("minecraft:the_nether"))`（resources/ResourceKey.java:25）
- `Level.getBlockState(BlockPos)` → `BlockState`（world/level/Level.java:380）
- `Level.isInWorldBounds(BlockPos)` → `boolean`（:172）；`LevelHeightAccessor.getMinY()` / `getMaxY()`（world/level/LevelHeightAccessor.java:9、:11）
- `Level.isLoaded(BlockPos)` → `boolean`（:695）。y 越界时也返回 false，所以高度要另外判断（HANDOFF §2）
- `Level.getBlockEntity(BlockPos)` → `@Nullable BlockEntity`（:671）

**线程**：`getBlockEntity` 在非服务器线程调用直接返回 null（Level.java:671 判断了 `Thread.currentThread() != this.thread`）。`getChunk` 在非主线程会把任务丢回服务器线程再 `join()`（server/level/ServerChunkCache.java:146-148），可能死锁。所以一律包在 `server.submit(...)` 里。

```java
BlockPos pos = new BlockPos(x, y, z);
String s = server.submit(() -> {
    ServerLevel lv = server.overworld();
    if (!lv.isInWorldBounds(pos)) return "out_of_world";
    if (!lv.isLoaded(pos)) return "not_loaded";
    return BlockStateParser.serialize(lv.getBlockState(pos));
}).get(5, TimeUnit.SECONDS);
```

### 5.2 BlockState 转完整字符串

**结论**：`BlockStateParser.serialize(state)` 直接给出 `minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]`。属性按名字排序；没有属性的方块只有 id（如 `minecraft:stone`）。不要用 `BlockState.toString()`，它的格式是 `Block{minecraft:oak_stairs}[...]`（world/level/block/state/StateHolder.java:43）。

**签名**：`public static String BlockStateParser.serialize(BlockState state)`（commands/arguments/blocks/BlockStateParser.java:497-519；取不到注册名时输出 `air`）。

**要分开拿 id 和属性时**
- id：`BuiltInRegistries.BLOCK.getKey(state.getBlock())` → `Identifier`（core/Registry.java:60）
- 属性列表：`StateHolder.getProperties()` → `Collection<Property<?>>`（world/level/block/state/StateHolder.java:65）
- 取值：`StateHolder.getValue(Property<T>)`（:88）；值转名字：`Property.getName(T value)`（world/level/block/state/properties/Property.java:61）；属性名：`Property.getName()`（:51）

```java
static <T extends Comparable<T>> String valueName(Property<T> p, BlockState s) {
    return p.getName(s.getValue(p));
}
Map<String, String> props = new TreeMap<>();
for (Property<?> p : state.getProperties()) props.put(p.getName(), valueName(p, state));
String id = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
```

### 5.3 字符串解析回 BlockState

**结论**：`BlockStateParser.parseForBlock(lookup, s, allowNbt)`。没写的属性取默认值。格式错误抛 `CommandSyntaxException`。

**签名**
- `public static BlockStateParser.BlockResult parseForBlock(HolderLookup<Block> blocks, String value, boolean allowNbt) throws CommandSyntaxException`（BlockStateParser.java:88；还有 `StringReader` 重载 :92）
- `record BlockResult(BlockState blockState, Map<Property<?>, Comparable<?>> properties, @Nullable CompoundTag nbt)`（:521）。`properties` 只含字符串里明确写了的属性；`nbt` 只在 `allowNbt=true` 且写了 `{...}` 时非 null。
- 第一个参数直接传 `BuiltInRegistries.BLOCK`：`Registry<T>` 本身就继承 `HolderLookup.RegistryLookup<T>`（core/Registry.java:26），26.1 没有也不需要 `asLookup()`。也可以用 `level.registryAccess().lookupOrThrow(Registries.BLOCK)`（core/HolderLookup.java:40）。
- 要支持 `#minecraft:logs` 这种标签：`parseForTesting(...)` 返回 `Either<BlockResult, TagResult>`（:105、:524）。
- 错误：未知方块 `ERROR_UNKNOWN_BLOCK`（:40）、未知属性 `ERROR_UNKNOWN_PROPERTY`（:43）、值不合法 `ERROR_INVALID_VALUE`（:49）。`e.getMessage()` 带出错位置，可以原样回给调用方。

```java
try {
    BlockStateParser.BlockResult r =
        BlockStateParser.parseForBlock(BuiltInRegistries.BLOCK, "minecraft:oak_stairs[facing=east]", false);
    BlockState st = r.blockState();
} catch (CommandSyntaxException e) {
    // 回 400，消息用 e.getMessage()
}
```

### 5.4 读一个区域

**结论**：用 `BlockPos.betweenClosed(a, b)` 遍历长方体（含两端）。三个坑：
1. 迭代器每次返回**同一个**可变对象（内部 `MutableBlockPos cursor`，`return this.cursor.set(...)`），要存下来必须 `.immutable()`。
2. 6 个 int 的重载不会帮你排序 min/max，传反了结果是错的。用 `(BlockPos, BlockPos)` 重载，它先做 `Math.min/Math.max`（core/BlockPos.java:367-372）。
3. 遍历顺序：x 变得最快，其次 y，最后 z（BlockPos.java:401-422）。

**签名**：`public static Iterable<BlockPos> betweenClosed(BlockPos a, BlockPos b)`（:367）；`betweenClosed(AABB)`（:361）；`betweenClosed(int minX, int minY, int minZ, int maxX, int maxY, int maxZ)`（:401）。

**体积上限**：原版 `/fill` 的上限是游戏规则 `max_block_modifications`（默认 32768，FillCommand.java:161-163）。读比写便宜，但一次读几十万格照样卡住服务器线程。建议探针也按 32768 格限制单次请求，超了回 400（这是建议，不是 API 限制）。没加载的区块别读（会触发生成），用 `isLoaded` 跳过并在结果里标出来。

```java
// 调色板 + 下标数组；-1 = 区块没加载。y 先裁到 [getMinY, getMaxY]
server.submit(() -> {
    ServerLevel lv = server.overworld();
    List<String> palette = new ArrayList<>();
    Map<BlockState, Integer> index = new HashMap<>();
    IntArrayList data = new IntArrayList();   // it.unimi.dsi.fastutil，MC 自带
    for (BlockPos p : BlockPos.betweenClosed(from, to)) {
        if (!lv.isLoaded(p)) { data.add(-1); continue; }
        BlockState st = lv.getBlockState(p);
        data.add(index.computeIfAbsent(st, k -> { palette.add(BlockStateParser.serialize(k)); return palette.size() - 1; }));
    }
    return Map.of("palette", palette, "data", data.toIntArray());   // 顺序：x 最快，y 其次，z 最慢
});
```

### 5.5 方块实体 NBT

**结论**：26.1 方块实体的存取改成 `ValueOutput` / `ValueInput`。要拿 `CompoundTag`，用带 `HolderLookup.Provider` 参数的方法，传 `level.registryAccess()`，这个参数必须给。

**签名**（world/level/block/entity/BlockEntity.java）
- `public final CompoundTag saveWithFullMetadata(HolderLookup.Provider registries)`（:123）：含 `id`、`x/y/z`
- `public final CompoundTag saveWithoutMetadata(HolderLookup.Provider)`（:144）：不含 id 和坐标
- `public final CompoundTag saveCustomOnly(HolderLookup.Provider)`（:160）
- 子类重写的是 `loadAdditional(ValueInput)`（:101）和 `saveAdditional(ValueOutput)`（:115）。以后自己写方块实体照这个写。
- 有没有方块实体：`BlockState.hasBlockEntity()`（world/level/block/state/BlockBehaviour.java:843）
- 类型 id：`BuiltInRegistries.BLOCK_ENTITY_TYPE.getKey(be.getType())`（core/registries/BuiltInRegistries.java:188；`getType()` 在 BlockEntity.java:289）
- 转文本：`CompoundTag.toString()` 就是 SNBT（nbt/CompoundTag.java:404）；带缩进用 `NbtUtils.prettyPrint(Tag, boolean)`（nbt/NbtUtils.java:174）
- 写回：`be.loadWithComponents(TagValueInput.create(ProblemReporter.DISCARDING, registries, tag))`（BlockEntity.java:106；world/level/storage/TagValueInput.java:40；util/ProblemReporter.java:18），然后 `be.setChanged()`（:219）和 `level.sendBlockUpdated(pos, state, state, 3)`（Level.java:333）。客户端是否马上刷新：待验证。原版的写法见 `BlockInput.place`（commands/arguments/blocks/BlockInput.java:66-90），可以照抄。
- 必须在服务器线程（见 5.1）。

```java
String snbt = server.submit(() -> {
    ServerLevel lv = server.overworld();
    BlockEntity be = lv.getBlockEntity(pos);
    return be == null ? null : be.saveWithFullMetadata(lv.registryAccess()).toString();
}).get(5, TimeUnit.SECONDS);
```

---

## 6. 命令

### 6.1 两种身份

**服务器身份**：`MinecraftServer.createCommandSourceStack()`（server/MinecraftServer.java:1732）。权限 OWNER（4 级），位置是世界出生点，没有实体，名字 "Server"。`@s` 选不到人，相对坐标 `~` 以出生点为准。

**玩家身份**：`ServerPlayer.createCommandSourceStack()`（server/level/ServerPlayer.java，.76 行号 :1884，.126 :1885）。权限来自 `ServerPlayer.permissions()`（.126 :2004）→ `MinecraftServer.getProfilePermissions(...)`（MinecraftServer.java:1866-1881）：单人存档房主、存档允许作弊时是 OWNER。反馈受游戏规则 `send_command_feedback` 控制（ServerPlayer.java .126 :358-380 的匿名 `CommandSource`）。

拿玩家：`server.getPlayerList().getPlayers()`（server/players/PlayerList.java:837）、`getPlayer(UUID)`（:841）、`getPlayerByName(String)`（:607）。客户端这边单人游戏只有一个玩家，用 `mc.player.getUUID()` 去服务器上找。

**自己拼**：`CommandSourceStack` 有 public 构造器（commands/CommandSourceStack.java:69）：`(CommandSource source, Vec3 position, Vec2 rotation, ServerLevel level, PermissionSet permissions, String textName, Component displayName, MinecraftServer server, @Nullable Entity entity)`。一般用不着，在现成的 stack 上调 `withXxx` 改就行（`withSource` :130、`withEntity` :151、`withPosition` :172、`withRotation` :193、`withCallback` :214、`withPermission` :261、`withLevel` :307）。

### 6.2 执行

**结论**：`server.getCommands().performPrefixedCommand(stack, "/gamemode creative")`。开头的 `/` 有没有都行。它在**当前线程同步**跑完整条命令（包括 `execute ... run ...` 的整个链），返回时命令已经执行完。必须在服务器线程上调用。返回 void，结果要靠 6.3 的办法拿。

**签名**：`public void Commands.performPrefixedCommand(CommandSourceStack sender, String command)`（commands/Commands.java:312）；`MinecraftServer.getCommands()` → `Commands`（MinecraftServer.java:1728）。

**内部顺序**（Commands.java:321-370）：先发 NeoForge 的 `CommandEvent`（可取消）→ `finishParsing` 解析 → `ExecutionContext` 排队执行（:406-420，链长上限是游戏规则 `max_command_sequence_length`，分叉上限 `max_command_forks`）。

### 6.3 捕获输出文字和成功与否

**结论**：两样东西配合。
1. 自己实现 `CommandSource` 收文字，用 `stack.withSource(mySource)` 换上去。只换输出去向，实体、位置、权限都不变（CommandSourceStack.java:130-150）。
2. `stack.withCallback((success, result) -> ...)` 收成功与否和返回值。

**签名**
- `CommandSource` 接口（commands/CommandSource.java）：`void sendSystemMessage(Component)`（:27）、`boolean acceptsSuccess()`（:29）、`boolean acceptsFailure()`（:31）、`boolean shouldInformAdmins()`（:33）
- `CommandResultCallback`（commands/CommandResultCallback.java:16）：`void onResult(boolean success, int result)`，函数式接口
- `CommandSourceStack withCallback(CommandResultCallback)`（:214）：**替换**原来的回调，不合并；要合并用 `withCallback(cb, BinaryOperator<CommandResultCallback>)`（:235）

**回调怎么被调到**：`Commands` 构造器里 `dispatcher.setConsumer(ExecutionCommandSource.resultConsumer())`（Commands.java:303）→ `(context, success, result) -> context.getSource().callback().onResult(success, result)`（commands/ExecutionCommandSource.java:32）。

**成功文字和失败文字怎么区分**：`sendSuccess` 原样交给 `source.sendSystemMessage`（需要 `acceptsSuccess()` 为真，且 stack 没被静音，:464）；`sendFailure` 会包一层红色：`Component.empty().append(message).withStyle(ChatFormatting.RED)`（:495-499）。所以看最外层 Style 的颜色是不是红色就能分开。`Style.getColor()` → `@Nullable TextColor`（network/chat/Style.java:85）；`TextColor.fromLegacyFormat(ChatFormatting.RED)`（network/chat/TextColor.java:71）；`TextColor.getValue()`（:37）。

```java
public record CmdResult(boolean callbackFired, boolean success, int result, List<String> out, List<String> err) {}

// 必须在服务器线程调用：server.submit(() -> runCaptured(server, stack, cmd)).get(10, TimeUnit.SECONDS)
static CmdResult runCaptured(MinecraftServer server, CommandSourceStack base, String cmd) {
    List<String> out = new ArrayList<>(), err = new ArrayList<>();
    TextColor red = TextColor.fromLegacyFormat(ChatFormatting.RED);
    CommandSource sink = new CommandSource() {
        @Override public void sendSystemMessage(Component msg) {
            TextColor c = msg.getStyle().getColor();
            (red != null && c != null && c.getValue() == red.getValue() ? err : out).add(msg.getString());
        }
        @Override public boolean acceptsSuccess() { return true; }      // 不受 send_command_feedback 影响
        @Override public boolean acceptsFailure() { return true; }
        @Override public boolean shouldInformAdmins() { return false; } // 不往聊天栏广播
    };
    boolean[] fired = {false}, ok = {false};
    int[] res = {0};
    CommandSourceStack stack = base.withSource(sink).withCallback((success, result) -> {
        fired[0] = true;
        if (success) { ok[0] = true; res[0] += result; }
    });
    server.getCommands().performPrefixedCommand(stack, cmd);
    return new CmdResult(fired[0], ok[0], res[0], out, err);
}
// 玩家身份：base = server.getPlayerList().getPlayer(uuid).createCommandSourceStack()
// 服务器身份：base = server.createCommandSourceStack()
```

### 6.4 坑

- **语法错误、未知命令不会调回调**。`finishParsing` 只 `sendFailure` 一句红字然后返回 null，后面不执行（Commands.java:371 起）。所以判成功要看「回调被调过，且至少一次 success=true」。回调一次都没调 = 失败（err 里有原因）。
- **执行中抛普通异常**：被 `performCommand` 的 catch 接住，`sendFailure("command.failed")`，在 IDE/开发环境（`SharedConstants.IS_RUNNING_IN_IDE`）再多发一行异常描述（Commands.java:344-364）。这种情况回调有没有被调到：待验证，按「回调没调 = 失败」处理不会错。
- **一条命令可能调多次回调**：比如 `execute as @a run ...` 每个分支调一次（待验证次数）。上面的例子按「任一次成功就算成功、result 累加」处理。
- **有些输出抓不到**：`/msg`、`/teammsg`、`/version` 调的是 `getSource().sendSystemMessage`，stack 带玩家实体时直接发给玩家（CommandSourceStack.java:453），绕过你的 `CommandSource`。
- **别的模组取消了 `CommandEvent`**：什么都不执行；如果事件里带了异常，会发一句红字（Commands.java:323-329）。
- **`withSuppressedOutput()`**（:240）会把文字全吞掉，捕获时别用。
- **别用客户端发命令当探针**：`ClientPacketListener.sendCommand(String)`（client/multiplayer/ClientPacketListener.java:2670）等于在聊天栏敲命令：先过 NeoForge 客户端命令，再发包给服务器，输出只进聊天栏，拿不到成功与否。`sendUnattendedCommand(String, @Nullable Screen)`（:2687）遇到解析错误、需要签名或权限不够时会弹确认界面。探针一律用 6.3 在服务器上执行。

### 6.5 权限

**结论**：26.1 把权限改成了 `PermissionSet`。`CommandSourceStack` 上已经没有 `hasPermission(int)`，只有 `permissions()` → `PermissionSet`（CommandSourceStack.java:377）。

**类**（server/permissions/）
- `PermissionLevel` 枚举：`ALL(0) MODERATORS(1) GAMEMASTERS(2) ADMINS(3) OWNERS(4)`，有 `byId(int)`、`isEqualOrHigherThan(...)`
- `LevelBasedPermissionSet extends PermissionSet`（LevelBasedPermissionSet.java:3）：常量 `MODERATOR`、`GAMEMASTER`（:7）、`ADMIN`、`OWNER`，`static forLevel(PermissionLevel)`（:31）；`ALL` 标了 `@Deprecated`
- 没有权限：`PermissionSet.NO_PERMISSIONS`
- 换权限：`stack.withPermission(PermissionSet)`（CommandSourceStack.java:261，直接替换）；`stack.withMaximumPermission(PermissionSet)`（:282，只往高了提）
- 给自己的命令设门槛：`.requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))`（Commands.java:557；常量 `LEVEL_MODERATORS / LEVEL_GAMEMASTERS / LEVEL_ADMINS / LEVEL_OWNERS` 在 :164-167；原版例子 server/commands/GameRuleCommand.java:16）

**谁有多少**：服务器身份 OWNER；单人房主（存档允许作弊）OWNER（PlayerList.java:601-604 + MinecraftServer.java:1866-1881）；没开作弊的单人存档房主不是 op，权限 ALL，`/gamemode` 这类命令会失败。

```java
// 用玩家身份，但只给 2 级
CommandSourceStack st = player.createCommandSourceStack().withPermission(LevelBasedPermissionSet.GAMEMASTER);
```

### 6.6 注册自己的命令（/xjy）

**结论**：监听 `RegisterCommandsEvent`（在 `NeoForge.EVENT_BUS` 上），往它给的 dispatcher 里注册。

**签名**（nf: event/RegisterCommandsEvent.java，.76 与 .126 相同）
- `CommandDispatcher<CommandSourceStack> getDispatcher()`
- `Commands.CommandSelection getCommandSelection()`：`ALL / DEDICATED / INTEGRATED`（Commands.java:565-568）
- `CommandBuildContext getBuildContext()`：物品、方块参数类型要用
- 触发点：`Commands` 构造器里 `EventHooks.onCommandRegister(...)`（Commands.java:301 → nf: event/EventHooks.java:846-848，.126 行号）。`Commands` 在每次加载数据包时新建（server/ReloadableServerResources.java:52），所以每次进世界会触发；`/reload` 时大概率再触发一次（待验证）。监听器里只注册命令，不要存 dispatcher，也不要做一次性的初始化。
- 构建：`Commands.literal(String)`（Commands.java:451）、`Commands.argument(String, ArgumentType<T>)`（:455）
- 只在客户端跑的命令另有 `RegisterClientCommandsEvent`（nf: client/event/RegisterClientCommandsEvent.java），探针用不到。

```java
@EventBusSubscriber(modid = XiaoJingYu.MODID)   // 没有 bus 参数，见 7.3
public class XjyCommands {
    @SubscribeEvent
    static void onRegister(RegisterCommandsEvent e) {
        e.getDispatcher().register(Commands.literal("xjy")
            .requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))
            .then(Commands.literal("ping").executes(ctx -> {
                ctx.getSource().sendSuccess(() -> Component.literal("pong"), false);
                return 1;
            })));
    }
}
```

### 6.7 /status 常用取值

| 要什么 | 写法 | 出处 |
|---|---|---|
| MC 版本 "26.1.2" | `SharedConstants.getCurrentVersion().name()` | SharedConstants.java:197 |
| NeoForge 版本 | `ModList.get().getModContainerById("neoforge").map(c -> c.getModInfo().getVersion().toString())`。别用 `NeoForgeVersion.getVersion()`，它标了 `@ApiStatus.Internal` | HANDOFF §2 |
| 游戏模式 | `mc.gameMode.getPlayerMode().getName()`（`gameMode` 可能为 null） | client/multiplayer/MultiPlayerGameMode.java:578；world/level/GameType.java:45 |
| 存档显示名 | `server.getWorldData().getLevelName()` | MinecraftServer.java:2070 |
| 存档目录 | `server.getWorldPath(LevelResource.ROOT)`，结尾是 `.`，用 `.normalize()` | MinecraftServer.java:2058；world/level/storage/LevelResource.java:16 |
| 玩家朝向/坐标/UUID/名字 | `getYRot()` `getXRot()` `getX/Y/Z()` `getUUID()` `getName()` | world/entity/Entity.java（.76 行号 :3812、:3829、:3191、:2889） |
| 窗口尺寸 | `mc.getWindow().getWidth()` / `getHeight()` | com/mojang/blaze3d/platform/Window.java:474、:478 |
| 当前界面 | `mc.screen`（可能为 null）、`screen.getClass().getSimpleName()`、`screen.getTitle()` | client/Minecraft.java:365；client/gui/screens/Screen.java:99 |
| 游戏加载完了没 | `mc.isGameLoadFinished()` | client/Minecraft.java:757 |
| 截图前隐藏 HUD | `mc.options.hideGui = true`（public 字段，就是 F1） | client/Options.java:742 |

---

## 7. 模组入口

### 7.1 @Mod 主类

**结论**：主类加 `@Mod("modid")`。构造器参数按**类型**注入，可选：`IEventBus`（本模组的 mod 总线）、`ModContainer`、`FMLModContainer`、`Dist`。也可以没有参数。

**签名**（javap，FML loader 11.0.13 / 11.0.15 相同）
- `@interface net.neoforged.fml.common.Mod { String value(); Dist[] dist() default {CLIENT, DEDICATED_SERVER}; String[] depends(); }`
- `FMLModContainer` 认的构造器参数类型：`IEventBus`、`ModContainer`、`FMLModContainer`、`Dist`。构造失败日志："Failed to create mod instance. ModID: {}, class {}"，游戏起不来。
- MDK 模板：`public ExampleMod(IEventBus modEventBus, ModContainer modContainer)`（MDK `src/main/java/com/example/examplemod/ExampleMod.java`）

**构造器跑得非常早**：在 `new Minecraft(...)` 之前（client/main/Main.java:122 `ClientModLoader.begin()`）。这时 `Minecraft.getInstance()` 是 null，options 也没加载。游戏目录用 `FMLPaths.GAMEDIR.get()`。

### 7.2 只在客户端执行

**结论**：单独一个类 `@Mod(value = MODID, dist = Dist.CLIENT)`，只在客户端构造。MDK 的 `ExampleModClient` 就是这么写的。同一个 modid 可以有多个 `@Mod` 类，按 dist 分别加载。探针整个模组只在客户端用，主类直接写 `dist = Dist.CLIENT`。

**运行时判断**：`FMLEnvironment.getDist()` → `Dist`；`FMLEnvironment.isProduction()` → `boolean`（javap，都是 static 方法；旧版的 `FMLEnvironment.dist` 字段写法不能用）。

**规矩**：服务器端绝不能加载 `net.minecraft.client.*` 的类。只在客户端用的代码放在 `dist = Dist.CLIENT` 的类里，或 `@EventBusSubscriber(value = Dist.CLIENT)` 的类里。

```java
@Mod(value = "xjyprobe", dist = Dist.CLIENT)
public final class XjyProbe {
    public XjyProbe(IEventBus modBus, ModContainer container) {
        if (FMLEnvironment.isProduction()) return;          // 万一被打进发布包，什么都不做
        modBus.addListener(FMLClientSetupEvent.class, e -> e.enqueueWork(ProbeOptions::apply));   // 改 options，见 4.11
        NeoForge.EVENT_BUS.addListener(ClientStoppingEvent.class, e -> ProbeHttp.stop());
        ProbeHttp.start();   // 只绑 127.0.0.1；处理请求时 Minecraft.getInstance() 可能还是 null，要判断
    }
}
```

### 7.3 两条总线

- **mod 总线**：构造器拿到的 `IEventBus`。发生命周期和注册类事件（实现了 `IModBusEvent` 的），比如 `FMLClientSetupEvent`、`FMLCommonSetupEvent`、注册表事件。
- **游戏总线**：`NeoForge.EVENT_BUS`（nf: common/NeoForge.java:17）。游戏里的事件，比如 `RegisterCommandsEvent`、`ServerStartedEvent`、`ClientTickEvent`。
- `IEventBus`（javap bus 8.0.5）：`register(Object)`；`addListener(Consumer<T>)`；`addListener(Class<T>, Consumer<T>)`；`addListener(EventPriority, [boolean receiveCanceled,] [Class<T>,] Consumer<T>)`；`unregister(Object)`；`<T> T post(T)`。
- **`@EventBusSubscriber` 在 26.1 只有 `value()`（Dist[]）和 `modid()`，没有 `bus` 参数**。FML 按事件类型自动分：实现 `IModBusEvent` 的进 mod 总线，其余进游戏总线。方法要 `static`，加 `@SubscribeEvent`。官方文档（Version 26.1）说法一致：带这个注解的类「相当于在模组构造器最后调用 `NeoForge.EVENT_BUS.register(X.class)` 和 `modBus.register(X.class)`」，所以处理方法必须是 static；建议写上 `modid`（<https://docs.neoforged.net/docs/concepts/events>）。同一页给的启动顺序：模组构造器 → 自动订阅 → `FMLConstructModEvent` → 注册表事件 → `FMLCommonSetupEvent` → `FMLClientSetupEvent` → IMC → `FMLLoadCompleteEvent`。
- `FMLClientSetupEvent` / `FMLCommonSetupEvent` 继承 `ParallelDispatchEvent`，在线程池里并行发。要碰游戏状态用 `event.enqueueWork(Runnable)` 或 `enqueueWork(Supplier<T>)`，返回 `CompletableFuture`（javap）。

### 7.4 启动、停止事件（用于清理）

| 事件 | 总线 | 什么时候 | 线程 | 出处 |
|---|---|---|---|---|
| `FMLClientSetupEvent` | mod | options 已加载，主菜单出来之前 | 线程池（用 `enqueueWork`） | client/Minecraft.java:695 `ClientModLoader.finish()` |
| `ClientStartedEvent` | 游戏 | `Minecraft.run()` 进主循环前 | Render thread | Minecraft.java:923 |
| `ServerAboutToStartEvent` | 游戏 | 内置服务器 `initServer`，加载世界前 | Server thread | client/server/IntegratedServer.java:101 |
| `ServerStartingEvent` | 游戏 | 世界加载完、首次保存后 | Server thread | IntegratedServer.java:107 |
| `ServerStartedEvent` | 游戏 | 进 tick 循环前 | Server thread | server/MinecraftServer.java:739 |
| `ServerStoppingEvent` | 游戏 | tick 循环结束后 | Server thread | MinecraftServer.java:797 |
| `ServerStoppedEvent` | 游戏 | 最后；之后 `ServerLifecycleHooks.getCurrentServer()` 变 null | Server thread | MinecraftServer.java:819 |
| `GameShuttingDownEvent` | 游戏 | `mc.stop()` 被调用时 | 调 `stop()` 的线程 | Minecraft.java:1639 |
| `ClientStoppingEvent` | 游戏 | `destroy()` 开头，存档之前 | Render thread | Minecraft.java:1209 |
| `ClientStoppedEvent` | 游戏 | `destroy()` 末尾，`System.exit(0)` 之前 | Render thread | Minecraft.java:1231 |

包名：服务器事件在 `net.neoforged.neoforge.event.server`（都有 `getServer()`）；客户端事件在 `net.neoforged.neoforge.client.event.lifecycle`（都有 `getClient()`）；`net.neoforged.neoforge.event.GameShuttingDownEvent`。服务器事件由 nf: server/ServerLifecycleHooks.java:94-118 发出，客户端事件由 nf: client/ClientLifecycleHooks.java:21、:28、:36 发出。

**清理建议**
- 要服务器对象时每次现取 `mc.getSingleplayerServer()`，或者在 `ServerStartedEvent` 存到一个 `volatile` 字段、`ServerStoppingEvent` 清掉。别长期抓着旧的 `MinecraftServer`。
- HTTP 线程设成 daemon，不挡 JVM 退出；`ClientStoppingEvent` 里关掉监听。
- 「退出游戏」接口：先把 HTTP 响应发完，再 `mc.execute(mc::stop)`。之后主循环结束，`destroy()` 存档、关窗口、退进程（见 4.7）。

### 7.5 每帧、每 tick 的事件

- `ClientTickEvent.Pre` / `.Post`（nf: client/event/ClientTickEvent.java:26、:35）：客户端每 tick 前后（client/Minecraft.java:1846、:1981）。**进世界的加载过程中不发**（见 4.2）。
- `RenderFrameEvent.Pre` / `.Post`（nf: client/event/RenderFrameEvent.java）：每帧 `gameRenderer.render` 前后（Minecraft.java:1381、:1383），`getPartialTick()` 拿 `DeltaTracker`。
- `ServerTickEvent.Pre` / `.Post`（nf: event/tick/ServerTickEvent.java:48、:59）；还有 `LevelTickEvent`、`PlayerTickEvent`、`EntityTickEvent`（同目录）。
- 用途：「等 N 帧再截图」「等区块渲染完」可以挂在 `RenderFrameEvent.Post` 上数帧，比反复 `mc.execute` 自己排队清楚。

## 8. MDG：开发专用的第二个模组（探针）

### 8.1 目标

- 主模组 `xiaojingyu` 在 `src/main`，探针 `xjyprobe` 在独立的 `src/probe` source set。
- 只有 `runClient` 加载探针；`runServer`、`runData`、`runGameTestServer` 不加载；发布 jar 里没有探针。
- mod/build.gradle（mod-2 维护）已经按下面的写法配好了。本节解释每一行为什么要这样写，出处是 MDG README 和 MDG 2.0.148 jar 的 javap。

### 8.2 关键配置

```groovy
sourceSets { probe }

configurations {
    probeImplementation.extendsFrom implementation          // 主模组的依赖探针也能用
    probeRuntimeClasspath.extendsFrom localRuntime
}

dependencies {
    probeImplementation sourceSets.main.output              // 探针能直接调用主模组的类
}

neoForge {
    version = project.neo_version                           // 26.1.2.76
    addModdingDependenciesTo sourceSets.probe               // 探针也能编译 MC/NeoForge 的类
    mods {
        "${mod_id}"       { sourceSet(sourceSets.main) }
        "${probe_mod_id}" { sourceSet(sourceSets.probe) }
    }
    runs {
        client {
            client()
            sourceSet = sourceSets.probe                    // 用 probe 的运行时类路径（里面含 main 的输出）
            loadedMods = [neoForge.mods.getByName(project.mod_id), neoForge.mods.getByName(project.probe_mod_id)]
        }
        server {
            server()
            loadedMods = [neoForge.mods.getByName(project.mod_id)]   // 一定要写，见下
        }
        // gameTestServer / data / clientData 同样只写主模组
    }
}
```

| 写法 | 作用 | 出处 |
|---|---|---|
| `addModdingDependenciesTo sourceSets.probe` | 新 source set 默认看不到 MC 的类，要这一句 | MDG README「Isolated Source Sets」（本地副本 tmp/api-research/mdg/README.md:375-401）；javap `ModDevExtension.addModdingDependenciesTo(SourceSet)` |
| `mods { xjyprobe { sourceSet(...) } }` | 告诉 FML 哪些输出目录属于哪个模组。MDG 据此生成 `-Dfml.modFolders=...` 和 `MOD_CLASSES` 环境变量 | MDG 内部类 `internal/ModFoldersProvider`（javap）；userdev config `MOD_CLASSES={source_roots}` |
| `sourceSet = sourceSets.probe` | 这个 run 用哪个 source set 的运行时类路径，默认 `main` | README Runs 节（:169-249）原文："Changes the source set whose runtime classpath is used for this run. This defaults to "main"" |
| `loadedMods = [...]` | 这个 run 加载哪些模组 | README Runs 节原文："This defaults to all mods declared in this project (inside of mods { ... } )"。**默认是全部**，所以 server、data、gameTestServer 都必须显式只写主模组，不然探针也会被加载 |
| 发布 jar | 标准 `jar` 任务只打包 `sourceSets.main.output`，探针不会进去 | Gradle java 插件的默认行为 |

注意：
- README 说 Eclipse 不支持「每个 run 用不同的类路径」，`sourceSet = ...` 在 Eclipse 里不生效。命令行和 IntelliJ 没问题。
- 我没跑 Gradle（规矩不允许），上面只和 README、javap 对过。mod-2 要实际确认三件事：`runClient` 日志里有 xjyprobe；`runServer` 日志里没有；`jar tf build/libs/*.jar` 里没有探针的类。
- **mod-2 实测结果（2026-11-06）**：`runClient` 日志里有 `[xjyprobe] probe module: module xjyprobe` 和 `listening on 127.0.0.1:…`；发布 jar 只有 11 个条目（MANIFEST、`XiaojingyuMod.class`、`neoforge.mods.toml`、两份 lang），没有探针。`runServer` 还没跑：它会往共用的 `mod/run/` 里写 `eula.txt`、`server.properties`。所以「runServer 不加载探针」目前只有源码层面的依据（server run 的 `loadedMods` 只有本体）。要测的话，先给 server run 单独设一个目录（`gameDirectory = project.file('run-server')`，`RunModel.getGameDirectory()`，MDG README Runs 一节），mcdev-probe 也是这么分的（§9.2）。

### 8.3 探针自己的 neoforge.mods.toml

- 每个模组一份 `META-INF/neoforge.mods.toml`，放在各自 source set 的资源里。mod/build.gradle 用 `generateProbeMetadata` 从 `src/probe/templates` 生成到 `build/generated/sources/probeMetadata`，和主模组的 `generateModMetadata` 是同一个套路。
- 26.1 的 MDK 模板**没有** `modLoader` / `loaderVersion` 两行（MDK `src/main/templates/META-INF/neoforge.mods.toml`：:9 license、:15 `[[mods]]`、:18 modId）。照抄模板改 modId 就行。
- 探针的依赖写法和主模组一样：`[[dependencies.xjyprobe]]` 依赖 `neoforge`（`versionRange="[${neo_version},)"`）和 `minecraft`。要不要再写一条依赖 `xiaojingyu`：可选，写了能保证主模组先加载。

### 8.4 runs 里加参数

**RunModel 的方法**（javap MDG 2.0.148 `net.neoforged.moddevgradle.dsl.RunModel`；README Runs 节）
- 程序参数：`programArgument(String)`，或 `programArguments.addAll('--a', 'b')`
- JVM 参数：`jvmArgument(String)` / `jvmArguments`
- 系统属性：`systemProperty(String, String)` / `systemProperties`（`MapProperty`，可以 `put(key, provider)`）
- 环境变量：`environment(String, String)`
- 其他：`gameDirectory`（默认 `<项目>/run`）、`devLogin`（默认 false = 离线开发模式）、`logLevel`、`ideName`、`disableIdeRun()`、`taskBefore(task)`

**客户端认的程序参数**（client/main/Main.java）

| 参数 | 说明 | 出处 |
|---|---|---|
| `--width` / `--height` | 窗口大小，默认 854×480。**options.txt 里有 `overrideWidth`/`overrideHeight` 时以它为准** | Main.java:85-86；client/Minecraft.java:453 |
| `--username` | 开发环境默认 `Dev`。名字里的 `#` 会被换成随机数字 | Main.java:77；nf: client/ClientHooks.java:998（.126 行号，.76 是 :979） |
| `--uuid` | 不传就按用户名算离线 UUID。**换用户名 = 换了一个人**，旧存档里的背包、位置都不是他的 | Main.java:79、:163-165 |
| `--quickPlaySingleplayer <存档文件夹名>` | 启动后直接进这个**已有**存档；不能新建。不给值 = 进最近玩的那个 | Main.java:66-69；client/quickplay/QuickPlay.java:75、:90 |
| `--quickPlayPath <文件>` | 快速游玩日志，可以不传 | client/quickplay/QuickPlayLog.java:45 |
| `--fullscreen` | 全屏，默认关 | Main.java（flag） |

quickPlay 之前有两个界面会挡住它：无障碍引导（`onboardAccessibility:false` 关掉，见 4.9）和模组加载警告（`neoforge-client.toml` 里 `showLoadWarnings = false`，见 4.9）。

**探针端口**：`systemProperties.put('xjyprobe.port', providers.gradleProperty('xjyprobe.port').orElse('0'))`，代码里 `Integer.getInteger("xjyprobe.port", 0)`。0 = 系统随机分配，实际端口写进发现文件（docs/PROBE.md:15-17）。命令行固定端口：`gradlew runClient -Pxjyprobe.port=端口`。

```groovy
client {
    client()
    sourceSet = sourceSets.probe
    loadedMods = [neoForge.mods.getByName(project.mod_id), neoForge.mods.getByName(project.probe_mod_id)]
    programArguments.addAll('--width', '1280', '--height', '720', '--username', 'XjyTester')
    systemProperties.put('xjyprobe.port', providers.gradleProperty('xjyprobe.port').orElse('0'))
    // 想启动直接进某个已有存档（待验证：和配置缓存一起用有没有问题）：
    // if (project.hasProperty('xjy.world')) programArguments.addAll('--quickPlaySingleplayer', project.property('xjy.world').toString())
}
```

**预置选项文件**：mod/build.gradle 的 `seedDevOptions` 在 `runClient` 前把 `dev/options.txt`、`dev/neoforge-client.toml` 复制到 `run/`，目标已存在就不覆盖。options.txt 第一行要写 `version:4790`（见 4.10）。

### 8.5 发布前检查

- `jar tf` 发布 jar：没有 xjyprobe 的类，只有一份 `META-INF/neoforge.mods.toml`，modId 是 xiaojingyu。
- 探针入口第一行 `if (FMLEnvironment.isProduction()) return;`，万一被打进去也不开端口。
- HTTP 只绑 127.0.0.1。
- `neo_version=26.1.2.76`（mod/gradle.properties:14）。mods.toml 的 `versionRange="[${neo_version},)"` 是下限，下限比用户游戏里的版本高就装不上。

## 9. mcdev-probe 的设计：借鉴什么，26.1 要改什么

**资料来源**：任务给的本地克隆（`TEMP/sec-review\minecraft-mod-dev`）在本机不存在。我改从 GitHub 拉了 main 分支的 17 个文件（2026-11-06），放在 `tmp/api-research/mcdev/`（文件名里的 `/` 换成了 `_`）。仓库：<https://github.com/yan-mc/minecraft-mod-dev>，MIT 许可。它只支持 MC 1.20.1 + Forge 47.4.x + Java 17（它的 docs/MANUAL.md:584-600），代码不能直接用，只借鉴思路。下文的 java 文件都在它的 `lab/mcdev-probe/src/main/java/com/mcdev/probe/` 下；「MANUAL」= 它的 docs/MANUAL.md。

### 9.1 它是怎么做的
- 两个探针 + 一个测试服：专用服务器上的探针 127.0.0.1:39001，客户端上的探针 127.0.0.1:39002，客户端连进端口 25566 的测试服；run 目录分成 run-server / run-client / run-gametest（MANUAL:208-231）。
- 同一个 `@Mod("mcdev_probe")`：客户端在 `FMLClientSetupEvent` 里开 `ClientProbeServer`；服务端在 `ServerStartedEvent`（只认专用服务器）开 `ProbeServer`，在 `ServerStoppingEvent` 关（McdevProbe.java）。
- HTTP 用 JDK 自带的 `com.sun.net.httpserver.HttpServer`，绑 127.0.0.1，2 个线程（ProbeServer.java:62、:78）。鉴权是固定 token `mcdev`，放在请求头 `X-Mcdev-Token`；token 为空就不校验（:50、:580-590）。返回统一的 `{"ok":true,"data":...}`（:592-596）。
- 碰游戏的操作：`mc.execute(...)` 丢到游戏线程，HTTP 线程用 `future.get(10, TimeUnit.SECONDS)` 等结果（ClientProbeServer.java:710-720）。MANUAL:622 写的规则是「所有游戏访问走 client thread」。
- 命令：服务端 `performPrefixedCommand(mc.createCommandSourceStack(), cmd)`，只拿回一个 int（ProbeServer.java:126-161）；客户端 `mc.player.connection.sendCommand(cmd)`，只回 `{"sent":true}`，看不到输出（ClientProbeServer.java:440-464）。
- 截图：`Screenshot.grab(...)` 写文件，HTTP 线程每 50 ms 查一次文件在不在，最多 40 次；只回路径、大小、宽高，不看图的内容（ClientProbeServer.java:669-700；MANUAL:263）。
- 退出：先回 HTTP 响应，再 `mc.execute(() -> mc.stop())`（ClientProbeServer.java:702-708）。
- 冻结 tick：自己写的 Mixin，在 `ServerLevel.tick` 开头取消（TickControl.java、mixin/ServerLevelMixin.java）。
- 日志：给 log4j 根 logger 挂一个环形缓冲 appender，留最近 1000 条，用 `/log/tail` 读（ProbeLogs.java）。
- 测试卡片：不认识的 action / assert 记进 `warnings`，不算通过（MANUAL:239）。

### 9.2 值得借鉴的

| 做法 | 为什么 | 我们怎么用 |
|---|---|---|
| 只绑 127.0.0.1 | 不暴露到局域网 | 已经这么做（docs/PROBE.md:15） |
| 统一 JSON 外壳 + 明确的错误码 | AI 好判断成败 | PROBE.md 的 400/401/403/404/405/409/504/500 分得更细（docs/PROBE.md:28），保持 |
| 碰游戏一律切到游戏线程，HTTP 线程带超时 | 线程安全 | 照做。超时按操作分开：建世界要等很久（§4.2），读方块几秒就够。读世界要切到服务器线程（§2.3） |
| 方块断言以服务端为准 | 客户端的方块状态会滞后（MANUAL:237） | 在服务器线程读 `ServerLevel`（§5.1） |
| 不用 quickPlay 连服务器，等主菜单出来再显式进入 | quickPlay 在 UI / 网络没准备好时就连，偶发卡死（MANUAL:238） | 单人世界同理：等 `TitleScreen` 出来再调 `createFreshLevel` / `openWorld`（§4.1、§4.5）。quickPlay 只能进已有存档（§4.8） |
| 退出：先回响应，再 `stop()` | 不然调用方收不到回复 | 照做（tmp/mod/HANDOFF.md:223 写的顺序一样） |
| 日志环形缓冲 + tail 接口 | AI 不用自己翻日志文件 | 可以做。26.1 开发环境的 classpath 里有 log4j-core 2.25.2（userdev 配置），挂 appender 应该可行：待验证 |
| 卡片里不认识的字段不能静默通过 | 防假阳性 | 卡片解析器照做 |
| 端口、token 走系统属性 | 能同时跑多个实例 | 已有 `xjyprobe.port`（§8.4） |
| UI 快照（当前界面、控件、槽位坐标） | 以后测 GUI 用 | P0 不做。以后注意：点击坐标是 GUI 缩放后的坐标，不是窗口像素（它的 docs/TOOLS.md:33-38）。26.1 用 `Window.getGuiScaledWidth()`、`getGuiScaledHeight()`、`getGuiScale()` 换算（com/mojang/blaze3d/platform/Window.java:498、:502、:514） |

### 9.3 26.1 / NeoForge 要改的

| mcdev-probe（1.20.1 Forge） | 我们（26.1 NeoForge） | 出处 |
|---|---|---|
| 专用服务器 + 客户端两个探针、两个端口 | 只做单人世界，一个客户端探针就够；要碰服务端逻辑就切到内置服务器线程 | §2.2 |
| 固定 token `mcdev`，token 为空就不校验 | 每次启动生成随机 token，写进发现文件，防本机别的程序乱调 | docs/PROBE.md:15-20 |
| `FMLEnvironment.dist == Dist.CLIENT`（字段） | `@Mod(value = ..., dist = Dist.CLIENT)`，或 `FMLEnvironment.getDist()`（方法） | §7.2；javap FML 11 |
| `FMLJavaModLoadingContext.get().getModEventBus()` | 构造器参数注入 `IEventBus` | §7.1 |
| `MinecraftForge.EVENT_BUS` | `NeoForge.EVENT_BUS` | nf: common/NeoForge.java:17 |
| `performPrefixedCommand` 返回 int，拿来当结果 | 返回 `void`；成败用 `withCallback`，文字用自定义 `CommandSource` 收 | §6.2、§6.3 |
| 客户端 `sendCommand`，看不到输出 | 在内置服务器上用玩家的 `CommandSourceStack` 执行，输出全能拿到 | §6.1、§6.4 |
| `Screenshot.grab` 写文件，HTTP 线程轮询文件 | `Screenshot.takeScreenshot` 在回调里直接拿 `NativeImage`，自己存 PNG、算亮度和颜色数 | §3 |
| `/status` 在 HTTP 线程上直接读游戏数据（ProbeServer.java:98-114） | 切到对应线程再读 | §2 |
| HTTP 线程里 `Thread.sleep(50)` 夹着发包（ClientProbeServer.java:601-620） | 跨 tick 的操作挂 `ClientTickEvent` / `ServerTickEvent`，或用 future 串起来，不占 HTTP 线程 | §2.4、§7.5 |
| Mixin 冻结 tick | 原版 `/tick freeze`、`/tick step`，或 `server.tickRateManager()`，不需要 Mixin | §4.4 |
| 必须用 dev-mapped jar，reobf jar 会 `NoSuchMethodError`（MANUAL:236、:539-548） | 26.1 不混淆，没有这个问题；探针放独立 source set，只在 runClient 加载 | §1.1、§8 |
| 反射读 `AbstractContainerScreen.hoveredSlot` | 字段还是 `protected`，名字不会变（不混淆）。公开的 `getHoveredSlot()` 只有 .126 有（.126 :709-713）；.76 只有私有的 `getHoveredSlot(double, double)`（.76 :314）。所以我们（.76）还是要反射，或用 AT | client/gui/screens/inventory/AbstractContainerScreen.java:52 |
| Forge 的 `FakePlayerFactory.get(level, new GameProfile(...))` | NeoForge 同名同用法：`FakePlayerFactory.get(ServerLevel, GameProfile)`，`FakePlayer extends ServerPlayer`。`GameProfile` 在 authlib 7 里是 record，构造器 `(UUID, String)`（javap） | nf: common/util/FakePlayerFactory.java:32；nf: common/util/FakePlayer.java:88 |
| 专用测试服 + 独立 run 目录 | 单人世界用不上。以后测多人再学它：run 目录分开，服务端就绪后再起客户端 | MANUAL:235 |
| JDK `com.sun.net.httpserver` | JDK 25 的 `jdk.httpserver` 模块照样导出这个包。**实测能用**（mod-2，2026-11-06）：日志「jdk.httpserver in boot layer: true; main module: null」，探针是具名模块 xjyprobe，从 classpath 启动。当时 mod/build.gradle 加了 `--add-modules=jdk.httpserver`；去掉它再测还没做。按 JEP 261，从 classpath 启动时，凡是无条件导出了包的系统模块都默认是根模块（JDK 11 起），所以这个参数大概率多余，但留着无害 | `java --describe-module jdk.httpserver`；mod/build.gradle:83；<https://openjdk.org/jeps/261>（Root modules 一节） |

### 9.4 P0 用不上的
- 服务端模拟合成（`/craft`）、`/recipe`、`/loot`、假玩家挖方块、多人登录编排、`RunRecorder` 的运行快照。以后要用再看它的源码。

## 10. P2 预习：旋转、镜像、放方块

### 10.1 BlockState 旋转和镜像

- `public BlockState rotate(Rotation rotation)`、`public BlockState mirror(Mirror mirror)`（world/level/block/state/BlockBehaviour.java:596、:600，`BlockStateBase` 上）。每种方块自己决定怎么变：楼梯改 `facing`，门改 `facing` 和 `hinge`。
- `Rotation`：`NONE`、`CLOCKWISE_90`、`CLOCKWISE_180`、`COUNTERCLOCKWISE_90`（world/level/block/Rotation.java:18-21）；`getRotated(Rotation)` 叠加两次旋转（:38）。
- `Mirror`：`NONE`、`LEFT_RIGHT`（z 取反）、`FRONT_BACK`（x 取反）（world/level/block/Mirror.java:11-13）。
- 坐标：`BlockPos.rotate(Rotation)` 绕原点转：顺时针 90° `(x,y,z)→(-z,y,x)`，180° `→(-x,y,-z)`，逆时针 90° `→(z,y,-x)`（core/BlockPos.java:219）。
- 绕任意点 + 镜像：`public static BlockPos transform(BlockPos pos, Mirror mirror, Rotation rotation, BlockPos pivot)`，**先镜像再旋转**（world/level/levelgen/structure/templatesystem/StructureTemplate.java:536）。
- 原版放结构时方块状态也是先镜像再旋转：`state.mirror(m).rotate(r)`（StructureTemplate.java:286）。坐标和状态要用同一个顺序，不然楼梯会朝错。

```java
// 把相对 origin 的蓝图方块，变换后放到世界里
BlockPos rel = p.subtract(origin);                                   // BlockPos.java:138
BlockPos dst = StructureTemplate.transform(rel, mirror, rotation, BlockPos.ZERO).offset(origin);   // :134
BlockState st = state.mirror(mirror).rotate(rotation);
```

### 10.2 Level.setBlock 的 flags

- `public boolean setBlock(BlockPos pos, BlockState blockState, @Block.UpdateFlags int updateFlags)`（world/level/Level.java:217），内部用递归上限 512 调 `setBlock(pos, state, flags, updateLimit)`（:222）。
- 返回 false：坐标出界；新状态和旧状态完全一样（world/level/chunk/LevelChunk.java:281-282）；或者放完发现方块没变。
- `setBlockAndUpdate(pos, state)` = flags 3（Level.java:329）。

| 值 | 常量（world/level/block/Block.java:91-111） | 源码里实际管什么 |
|---|---|---|
| 1 | `UPDATE_NEIGHBORS` | 通知邻居方块（`updateNeighborsAt`）和比较器（Level.java:254 起的 `markAndNotifyBlock`）；旧方块的 `affectNeighborsAfterRemoval`（LevelChunk.java:318） |
| 2 | `UPDATE_CLIENTS` | 把变化发给客户端（`sendBlockUpdated`） |
| 4 | `UPDATE_INVISIBLE` | 客户端上不重新渲染（Level.java:266） |
| 8 | `UPDATE_IMMEDIATE` | 客户端立刻重建区块网格（client/renderer/LevelRenderer.java:1433） |
| 16 | `UPDATE_KNOWN_SHAPE` | 不做邻居形状更新（Level.java:278） |
| 32 | `UPDATE_SUPPRESS_DROPS` | 形状更新把方块挤掉时不掉落（Block.java:227） |
| 64 | `UPDATE_MOVE_BY_PISTON` | 标记「被活塞推的」（LevelChunk.java:305） |
| 128 | `UPDATE_SKIP_SHAPE_UPDATE_ON_WIRE` | 形状更新跳过红石线（world/level/redstone/NeighborUpdater.java:44） |
| 256 | `UPDATE_SKIP_BLOCK_ENTITY_SIDEEFFECTS` | 换掉方块实体时不调 `preRemoveSideEffects`，比如箱子不把东西洒出来（LevelChunk.java:306-312） |
| 512 | `UPDATE_SKIP_ON_PLACE` | 不调新方块的 `onPlace`（LevelChunk.java:327） |
| 3 | `UPDATE_ALL` | 1+2，最常用 |
| 11 | `UPDATE_ALL_IMMEDIATE` | 1+2+8 |
| 260 | `UPDATE_NONE` | 4+256 |
| 816 | `UPDATE_SKIP_ALL_SIDEEFFECTS` | 16+32+256+512 |

`Block.UPDATE_LIMIT = 512` 不是 flag，是递归层数上限（setBlock 的默认 `updateLimit`），只是数值和 `UPDATE_SKIP_ON_PLACE` 一样。

### 10.3 setBlock 里发生了什么（顺序）

1. `LevelChunk.setBlockState`（LevelChunk.java:270）：换状态、更新光照；方块变了就移除旧方块实体（没有 256 时先调 `preRemoveSideEffects`）；有 1 或活塞时调旧方块的 `affectNeighborsAfterRemoval`；没有 512 时调新方块的 `onPlace`；需要时建新方块实体。
2. `Level.markAndNotifyBlock`（Level.java:254）：有 2 → `sendBlockUpdated`（服务器上只在区块到了 BLOCK_TICKING 时发）；有 1 → 通知邻居和比较器；没有 16 → 邻居形状更新，传下去的 flags 去掉 1 和 32（`& -34`，:279）；最后更新 POI 和 `onBlockStateChange`。
3. NeoForge：`captureBlockSnapshots` 打开时会记录快照，不调 `onPlace`（LevelChunk.java:327）。

### 10.4 大批量放方块

- 照抄原版 `/fill` 的两遍法（server/commands/FillCommand.java:157-213）：
  1. 第一遍：先记下旧状态（`record UpdatedPosition(BlockPos pos, BlockState oldState)`，:165），再用 `2 | 256` 放（strict 模式 `2 | 816`，:188）。只发客户端，不通知邻居，不会放到一半沙子掉下来、水流起来。
  2. 第二遍：全放完后，每个位置调 `level.updateNeighboursOnBlockSet(pos, oldState)`（:202-203；server/level/ServerLevel.java:874-886）。
- 数量上限：原版用游戏规则 `max_block_modifications`（默认 32768，超了报「区域太大」，FillCommand.java:161-163）。我们的批量放置最好也设上限。
- 网络：一个 tick 里同一个区块段的改动会合成一个包发出去（server/level/ChunkHolder.java:43 `changedBlocksPerSection`、:174 `broadcastChanges`），不是一个方块一个包。
- 一次放几万个会卡住服务器 tick。大结构建议拆到多个 tick，挂在 `ServerTickEvent.Post` 上每 tick 放一批（每批多少合适：待验证，要实测）。
- 放之前检查 `level.isLoaded(pos)`。没加载的区块，`getBlockState` / `setBlock` 会同步加载甚至生成它，很慢（见 5.1）。
- 必须在服务器线程上做。

### 10.5 放之前记下旧方块，以便撤销

**做法 A（推荐，能存盘）**：记方块状态字符串 + 方块实体 NBT，撤销时用 `BlockInput.place` 放回去。

```java
record UndoEntry(BlockPos pos, String state, @Nullable CompoundTag be) {}

// 放置前，服务器线程
BlockState old = level.getBlockState(pos);
BlockEntity oldBe = level.getBlockEntity(pos);                      // 不在服务器线程会拿到 null（Level.java:671）
undo.add(new UndoEntry(pos.immutable(), BlockStateParser.serialize(old),
        oldBe == null ? null : oldBe.saveWithoutMetadata(level.registryAccess())));

// 撤销：倒序放回，最后统一通知邻居
HolderLookup<Block> blocks = level.registryAccess().lookupOrThrow(Registries.BLOCK);
List<BlockState> replaced = new ArrayList<>();
for (int i = undo.size() - 1; i >= 0; i--) {
    UndoEntry u = undo.get(i);
    replaced.add(level.getBlockState(u.pos()));
    BlockState st = BlockStateParser.parseForBlock(blocks, u.state(), false).blockState();   // 会抛 CommandSyntaxException
    new BlockInput(st, Set.of(), u.be()).place(level, u.pos(), 2 | 16 | 256);
}
for (int i = undo.size() - 1, j = 0; i >= 0; i--, j++) {
    level.updateNeighboursOnBlockSet(undo.get(i).pos(), replaced.get(j));
}
```

- `saveWithoutMetadata` 存的是方块实体数据 + `components`（world/level/block/entity/BlockEntity.java:144-158），和 `BlockInput.place` 里用的 `loadWithComponents`（BlockEntity.java:106；BlockInput.java:66-90）正好配对。`/setblock` 带 NBT 走的也是这条路。
- flags `2 | 16 | 256` 的理由：2 = 发给客户端；16 = 不按邻居重算形状，原样恢复记下的状态；256 = 撤掉的箱子不洒东西（不然会刷物品）。这个组合没在游戏里试过：待验证。
- 门、床、高草这种两格的方块，要两格一起记、一起恢复。
- `CloneCommands` 复制方块实体用的是另一对：`saveCustomOnly` + `loadCustomOnly`，组件单独 `collectComponents()` / `setComponents()`（server/commands/CloneCommands.java:218、:276、:281）。也可以照它做。

**做法 B（只在内存里）**：NeoForge 的 `BlockSnapshot`（nf: common/util/BlockSnapshot.java）。
- `public static BlockSnapshot create(ResourceKey<Level> dim, LevelAccessor level, BlockPos pos, int flag)`（:71）：记下状态和方块实体 NBT；`create(dim, level, pos)` 用 flag 3（:80）。
- 恢复：`restore()`（:187，用记下的 flag）、`restore(int flags)`（:180）、`restoreToLocation(LevelAccessor level, BlockPos pos, int flags)`（:156）。
- 它抓着 level 的引用，世界关了就不能用，也存不了盘。只适合「刚放完马上撤销」。

## 11. 方块和物品注册（P5 家具，mod 写，2026-11-06）

这一节是 mod 成员做 P5 家具时在 .76 源码（tmp/mod/src76、tmp/mod/nfsrc）里查的，`gradlew build` 编译通过；游戏里的结果见卡片 P5-001。代码在 `mod/src/main/java/com/xiaojingyu/furniture/`。

### 11.1 Properties 必须先有 id

- 26.1 的方块和物品在**构造函数里**就要知道自己的注册名：`BlockBehaviour(Properties)` 里 `properties.effectiveDrops()`、`effectiveDescriptionId()` 用 id 算掉落表和翻译键（world/level/block/state/BlockBehaviour.java:102-105），id 没设就抛 `NullPointerException("Block id not set")`（:1148、:1282）。物品同理：`Item(Properties)` 里 `itemIdOrThrow()`（world/item/Item.java:135-140、:680），没设抛 `"Item id not set"`。
- 所以 `new Block(Properties.of()...)` 这样直接 new 再注册是不行的，要先 `properties.setId(ResourceKey.create(Registries.BLOCK, id))`（BlockBehaviour.java:1271；物品是 `Item.Properties.setId`，Item.java:660）。原版自己就是这么注册的：`factory.apply(properties.setId(id))` 再 `Registry.register`（world/level/block/Blocks.java:7200-7203）。
- id 定了以后，默认值都从它来：掉落表 `<命名空间>:blocks/<名字>`（BlockBehaviour.java:982-984），方块翻译键 `block.<命名空间>.<名字>`（:985），物品模型 `<命名空间>:<名字>`（Item.java 的 `model`，对应 `assets/<命名空间>/items/<名字>.json`）。

### 11.2 NeoForge 的写法：DeferredRegister.Blocks / Items 替你 setId

- `DeferredRegister.createBlocks(modid)` 返回 `DeferredRegister.Blocks`。`registerBlock(name, Function<Properties, B> 构造函数, UnaryOperator<Properties> 设属性)` 在注册事件里先 `setId` 再调构造函数（nf: registries/DeferredRegister.java:433-435、:450-452），返回 `DeferredBlock<B>`（`implements ItemLike`，nf: registries/DeferredBlock.java:21）。
- `DeferredRegister.createItems(modid)` 返回 `DeferredRegister.Items`。`registerItem(name, Function<Item.Properties, I>, UnaryOperator<Item.Properties>)` 同样先 `setId`（DeferredRegister.java:679-681、:696-698），返回 `DeferredItem<I>`。
- 方块的物品：`registerSimpleBlockItem(name, block)` 做的是 `new BlockItem(block.get(), props)`，并且 `props.useBlockDescriptionPrefix()`（:573-575），物品的名字就用方块的翻译键 `block.<ns>.<名字>`，lang 里只写一条。要自己的物品类时用 `registerItem` 并自己加 `useBlockDescriptionPrefix()`（原版 `Items.registerBlock` 也加，item/Items.java:2382-2388）。
- 两个 DeferredRegister 都要在模组构造函数里 `register(modEventBus)`（:315）。
- `BlockBehaviour.Properties` 的 lambda 和 `Supplier` 两种重载都有；写 `p -> p.strength(...)` 时 Java 按参数个数选到 `UnaryOperator` 那个，不会有歧义（实测编译通过）。

```java
static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MOD_ID);
static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
static final DeferredBlock<ShellCaseBlock> SHELL_CASE =
        BLOCKS.registerBlock("shell_case", ShellCaseBlock::new, p -> p.strength(2.0F, 3.0F).sound(SoundType.WOOD).noOcclusion());
static final DeferredItem<TwoCellBlockItem> SHELL_CASE_ITEM =
        ITEMS.registerItem("shell_case", p -> new TwoCellBlockItem(SHELL_CASE.get(), p), p -> p.useBlockDescriptionPrefix());
// 模组构造函数里：BLOCKS.register(modEventBus); ITEMS.register(modEventBus);
```

### 11.3 方块类要有 codec

- `BlockBehaviour.codec()` 是抽象的（BlockBehaviour.java:121），`HorizontalDirectionalBlock` 又声明了一遍（world/level/block/HorizontalDirectionalBlock.java:18），子类必须实现。只有 Properties 一个参数的方块用 `simpleCodec(构造函数)`（BlockBehaviour.java:127）：`public static final MapCodec<X> CODEC = simpleCodec(X::new);`。不用登记到 `BLOCK_TYPE` 注册表（NeoForge 不查，我们也不用数据驱动的方块）。
- `HorizontalDirectionalBlock` 带 `FACING`（`BlockStateProperties.HORIZONTAL_FACING`），`rotate`、`mirror` 已经按 facing 写好（:20-28）。

### 11.4 创造模式物品栏的新页

- 注册表 `Registries.CREATIVE_MODE_TAB`（core/registries/Registries.java:160），用普通的 `DeferredRegister.create(Registries.CREATIVE_MODE_TAB, modid)`。
- `CreativeModeTab.builder()`（world/item/CreativeModeTab.java:72）→ `.title(Component.translatable("itemGroup.<modid>.<名字>"))`（:202）→ `.icon(() -> stack)` → `.displayItems((parameters, output) -> output.accept(item))` → `.build()`。NeoForge 另有 `displayItems(Collection<Holder>)`（:325）直接放一个 DeferredRegister 的全部条目。往原版的页里加东西用 `BuildCreativeModeTabContentsEvent`（nf: event/BuildCreativeModeTabContentsEvent.java），这次没用。

### 11.5 「照木板」的属性

- 橡木木板：`mapColor(MapColor.WOOD).instrument(NoteBlockInstrument.BASS).strength(2.0F, 3.0F).sound(SoundType.WOOD).ignitedByLava()`（Blocks.java:96-99）。
- 原版床：`sound(WOOD).strength(0.2F).noOcclusion().ignitedByLava().pushReaction(PushReaction.DESTROY)`（Blocks.java:7067-7079）。
- 斧子挖得快、挖得掉靠方块标签 `minecraft:mineable/axe`，没有对应的 Properties。数据包文件 `data/minecraft/tags/block/mineable/axe.json`（26.1 的标签文件夹是单数 `block`），写 `"replace": false` 只追加。

### 11.6 两格的方块（照原版床）

- 放：`BlockItem.place`（world/item/BlockItem.java:48-89）先 `getStateForPlacement`，再 `placeBlock`（默认 flags 11，:146-148），最后 `setPlacedBy`。原版床的 `getStateForPlacement` 先查另一格 `canBeReplaced(context)` 和世界边界，不行就返回 null（world/level/block/BedBlock.java:195-204）；`BedItem.placeBlock` 用 flags 26（2|8|16，不做邻居和形状更新，item/BedItem.java:13-15）；`setPlacedBy` 在服务器上放另一格（flags 3），再补 `updateNeighborsAt` 和 `updateNeighbourShapes`（BedBlock.java:289-298）。
- 另一格不对就变空气：`updateShape` 里，朝另一格的那个方向如果邻居不是另一半，返回空气（BedBlock.java:155-172）。返回空气以后 `Block.updateOrDestroy` 调 `destroyBlock(pos, 有没有 32)`（world/level/block/Block.java:221-233），会按掉落表掉东西。
- 拆：只有主格的掉落表有东西（原版床的 `loot_table/blocks/*_bed.json` 用 `block_state_property` 条件 `part=head`）。创造模式拆非主格时，`playerWillDestroy` 用 flags 35（1|2|32，不掉落）把主格也拆掉，再发 2001 粒子事件（BedBlock.java:178-193；`LevelEvent.PARTICLES_DESTROY_BLOCK`）。
- 镜像：左右之分的两格方块，镜像以后要交换左右。NeoForge 给箱子补过同样的修正（ChestBlock.java:370-373，MC-134110）。只按 facing 转（`/xjy place`）不用换。
- `/setblock` 不加 strict 时，`BlockInput.place` 先按邻居算一遍，算出空气就**还用原来写的状态**（commands/arguments/blocks/BlockInput.java:66-69），放的 flags 是 2|256，之后 `updateNeighboursOnBlockSet`（server/commands/SetBlockCommand.java:117-121）。所以单独 setblock 半张床不会马上消失，但它的邻居（另一半）会收到形状更新。卡片里两格都用 strict 放（docs/PROBE.md「搭场景」）。
- NeoForge 的 `IBlockExtension.isBed` 默认是 `this instanceof BedBlock`（nf: common/extensions/IBlockExtension.java:282），不继承 `BedBlock` 就不能睡，村民也不会认它。

### 11.7 数据和资源放在哪（26.1）

| 东西 | 路径 |
|---|---|
| 掉落表 | `data/<ns>/loot_table/blocks/<名字>.json`（单数 `loot_table`） |
| 方块标签 | `data/<ns>/tags/block/<标签>.json`，斧子是 `data/minecraft/tags/block/mineable/axe.json` |
| 方块状态、方块模型、贴图 | `assets/<ns>/blockstates/`、`models/block/`、`textures/block/` |
| 物品定义（26.1 必须有） | `assets/<ns>/items/<名字>.json`，原版例：`{"model":{"type":"minecraft:model","model":"minecraft:block/oak_planks"}}` |
| 翻译 | `assets/<ns>/lang/zh_cn.json`、`en_us.json`：`block.<ns>.<名字>`、创造页 `itemGroup.<ns>.<名字>` |

- 半透明（比如贝壳柜的玻璃）：26.1 每个面按自己用的贴图有没有半透明 / 全透明像素自动分层（`ChunkSectionLayer.byTransparency`，client/renderer/chunk/ChunkSectionLayer.java:29；调用在 client/resources/model/geometry/BakedQuad.java:86），方块注册时不用设 render type。

### 11.8 一个类、好几种方块，状态属性不一样（P5 第 2 轮的多格家具）

- 状态属性在 `Block` 的构造函数里就定了：`Block(Properties)` 调 `this.createBlockStateDefinition(builder)`（world/level/block/Block.java:238），这时子类构造函数里的字段**还没赋值**。所以「同一个类，按格子数 N 带不同的 `part`」不能靠实例字段。我们的做法（`FurnitureBlock`）：调 `super(...)` 的参数里先把这一种的规格放进一个 `ThreadLocal`，`createBlockStateDefinition` 从它读，`super` 回来再清掉。注册在一个线程里按顺序跑，没有并发问题。
- `IntegerProperty.create("part", 0, N - 1)`（world/level/block/state/properties/IntegerProperty.java:45）。名字一样、范围不一样的是不同的属性对象；同一个 N 的方块共用一个对象就行（原版的 `AGE_7` 这类也是多个方块共用）。blockstate 文件、`/setblock`、掉落表条件里写成 `part=0`（掉落表的 `properties` 里是字符串 `"0"`）。
- 光：`Properties.lightLevel(ToIntFunction<BlockState>)`（BlockBehaviour.java:1109）可以按状态给不同的光。~~函数在方块造好以后才调~~（2026-11-07 更正，第 2 轮第 1 次开游戏就崩在这里）：函数在**每个 BlockState 造出来时**就调（`BlockStateBase` 的构造函数里 `properties.lightEmission.applyAsInt(this.asState())`，BlockBehaviour.java:451），也就是还在 `Block` 的构造函数里，子类字段还没赋值，`state.getBlock()` 的字段也是 null。所以函数里只能用注册时就有的东西：我们用捕获的规格加共用的 `part` 属性（`FurnitureBlock.lightFunction(spec)`）。
- 碰撞和选框分开：`getShape` 是选框（也是默认的碰撞），`getCollisionShape` 默认是 `hasCollision ? state.getShape(...) : Shapes.empty()`（BlockBehaviour.java:318-320）。要「选得中、但人能穿过去」（画框）就只覆盖 `getCollisionShape` 返回 `Shapes.empty()`；「人能走上去的薄层」（地毯）返回 `Block.box(0, 0, 0, 16, 1, 16)`。不用 `Properties.noCollision()`，它对整个方块生效，地毯和茶几在同一件里一个有碰撞一个没有就不行。
- 方块的 codec：构造函数带了规格，`simpleCodec` 用不了，就写一个带 id 字段的 `RecordCodecBuilder`（`Codec.STRING.fieldOf("furniture")` + `propertiesCodec()`）。这个 codec 只在数据驱动方块时用到，我们不用，但 `codec()` 必须实现（§11.3）。

### 11.9 不加状态、不加方块实体，让方块「会响」（P5 第 3 轮的风铃，mod3 查的，2026-11-07）

要求（FURNITURE.md 9.3）：风铃下面有活的东西刚走进来就响；不加方块状态（鲸图不变），`/xjy place` 盖出来的也要会响。查到的：

- **`/xjy place` 不调 `onPlace`**：它放方块的 flags 是 `2|16|32|256|512`（`BuildJob.RAW`）。512 是 `Block.UPDATE_SKIP_ON_PLACE`（Block.java:100），`LevelChunk.setBlockState` 里 `(flags & 512) == 0` 才调 `state.onPlace(...)`（world/level/chunk/LevelChunk.java:327）。所以「放下时 `scheduleTick`、tick 里再排下一次」的做法，盖出来的方块起不了头；随机刻平均 68 秒才轮到一次，卡片里还关了（`random_tick_speed 0`）。
- **方块实体不管 flags 都会建**：同一个函数后面，新状态 `hasBlockEntity()` 就 `newBlockEntity`（LevelChunk.java:330-345）。可是有方块实体的格子会被 `/xjy capture` 写进鲸图（`Capture.java` 存 `saveWithoutMetadata`），卡片的 `expect_file` 也比方块实体（文件里没有、游戏里有就算不一样），生成器写的房子鲸图就对不上了。
- 所以风铃用第三种做法：**从实体这边看**。`ServerTickEvent.Post`（游戏事件总线 `NeoForge.EVENT_BUS`，只在服务器线程）里每 2 tick 把每个 `ServerLevel` 的 `getAllEntities()` 过一遍，活的（`LivingEntity`，不算盔甲架、旁观模式、死了的）就查它的碰撞箱上面几格有没有风铃，和上一次比，新出现的才响。`MinecraftServer.getTickCount()`（:1463）当时钟（`advance_time false` 也照走）。查格子前先 `level.hasChunk(cx, cz)`，不为了看一眼去加载区块。代码 `furniture/WindChimes.java`。
- 声音：`SoundEvents.AMETHYST_BLOCK_CHIME` 是 `SoundEvent`（sounds/SoundEvents.java:54），`level.playSound(null, BlockPos, SoundEvent, SoundSource, 音量, 音高)`（world/level/Level.java:408，第一个参数 null = 谁都听得见，位置是格子正中）。原版紫水晶块被射中时音高是 `0.5 + 随机 × 1.2`（world/level/block/AmethystBlock.java:29），走在紫水晶上是 `Entity.playAmethystStepSound`（Entity.java:1375-1382）。
- 只在开发版里给卡片留个能读的计数：`FMLEnvironment.isProduction()`（FML loader 11.0.15，`net.neoforged.fml.loading`）开发时是 false；命令存储 `server.getCommandStorage()`（MinecraftServer.java:1793）的 `get(Identifier)` / `set(Identifier, CompoundTag)`（world/level/storage/CommandStorage.java:25、:55），卡片用 `/data get storage xiaojingyu:dev wind_chime.rings` 读（26.1 的 `ResourceLocation` 叫 `Identifier`，`Identifier.fromNamespaceAndPath`）。
- 命令返回 0 也算成功：`Frame.returnSuccess(value)` → `onSuccess(value)` → `onResult(true, value)`（commands/execution/Frame.java:6-7、commands/CommandResultCallback.java:18-20），所以卡片可以写 `result: 0`（`data get` 读到 0）。

## 12. 网络包、只在客户端的入口、界面（抓取黑名单，mod4 查的，2026-11-07）

用在 `/xjy blacklist` 的界面上（COMMANDS.md §2a，代码在 `mod/src/main/java/com/xiaojingyu/blacklist/` 和 `client/`）。行号都是 .76 的（`tmp/mod/src76/`、`tmp/mod/nfsrc/`），都编译过、`gradlew build` 过了。

### 12.1 自己的网络包（payload）

- **登记**：mod 总线上的 `RegisterPayloadHandlersEvent`（nf: network/event/RegisterPayloadHandlersEvent.java），`event.registrar("版本号")` 给一个 `PayloadRegistrar`（nf: network/registration/PayloadRegistrar.java）。play 阶段用：
  - `playToServer(type, codec, handler)`：客户端 → 服务器。
  - `playToClient(type, codec, handler)`：服务器 → 客户端，处理写在公共代码里。
  - `playToClient(type, codec)`（:45，不带处理）：处理另外在 **`RegisterClientPayloadHandlersEvent`**（mod 总线，只在客户端发，nf: client/network/event/RegisterClientPayloadHandlersEvent.java）里用 `event.register(type, handler)` 登记。**要让公共代码不碰客户端的类，就用这个**：处理里要开界面（`Minecraft`、`Screen`），放进只在客户端加载的类里。客户端登记完会检查，有服务器 → 客户端的包没登记处理就抛 `IllegalStateException("Some clientbound payloads are missing client-side handlers: …")`（nf: client/network/registration/ClientNetworkRegistry.java:90）。
  - 默认处理在主线程上跑（registrar 把处理包成 `MainThreadPayloadHandler`，PayloadRegistrar.java:201-208）；要在网络线程跑用 `registrar.executesOn(HandlerThread.NETWORK)`。客户端那边 `register(type, handler)` 也是主线程（`HandlerThread.MAIN`）。
  - 单人游戏也会真的编码、解码（RegisterPayloadHandlersEvent 的类注释），所以 codec 写错单人游戏里就能发现。两边版本号不一样（NeoForge 对 NeoForge）连不上。
- **包本身**：一个 record 实现 `CustomPacketPayload`，`type()` 返回 `new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(modid, "名字"))`（network/protocol/common/custom/CustomPacketPayload.java:79）。codec 用 `StreamCodec.composite(codec1, getter1, …, 构造器)`（network/codec/StreamCodec.java:194 起，最多好多个字段）：
  - `ByteBufCodecs.BOOL`、`VAR_INT`、`stringUtf8(最大长度)`、`STRING_UTF8`（32767）、`.apply(ByteBufCodecs.list(最多几个))` 变成列表（network/codec/ByteBufCodecs.java:56、:102、:267、:168、:444）。
  - 聊天文字 `Component`：`ComponentSerialization.TRUSTED_STREAM_CODEC`（服务器发给客户端用；network/chat/ComponentSerialization.java:40），要 `RegistryFriendlyByteBuf`，play 阶段的 codec 就是这个类型。可翻译的文字（`Component.translatable` 带参数）照样能传，客户端按自己的语言显示。
- **发**：服务器 → 某个玩家 `PacketDistributor.sendToPlayer(serverPlayer, payload)`（nf: network/PacketDistributor.java:36）；客户端 → 服务器 `ClientPacketDistributor.sendToServer(payload)`（nf: client/network/ClientPacketDistributor.java:22，客户端的类）。发之前可以 `serverPlayer.connection.hasChannel(type)`（nf: common/extensions/ICommonPacketListener.java:65）看对方装没装。
- **处理**：`(payload, IPayloadContext context) -> …`；`context.player()`（服务器这边是 `ServerPlayer`，要自己 instanceof）、`context.reply(payload)`、`context.enqueueWork(…)`（nf: network/handling/IPayloadContext.java:52、:59、:80）。**客户端发来的东西不能信**：服务器这边自己再查权限和内容。

### 12.2 只在客户端加载的入口

- 同一个 modid 再写一个 `@Mod(value = MOD_ID, dist = Dist.CLIENT)` 的类（§7.2），构造器 `(IEventBus modEventBus)` 就行；在里面 `modEventBus.addListener(RegisterClientPayloadHandlersEvent.class, e -> e.register(…))`。界面类、客户端的处理都放在它那个包里，公共代码一个都不 import。实测开发游戏（客户端）里两个 `@Mod` 类都加载了：`Sync` 的客户端处理是在 `dist = CLIENT` 那个类里登记的，`/xjy blacklist` 照样打开了界面。专用服务器没开过（要同意 EULA 才会加载模组：server/Main.java:92-110 先查 eula.txt，后面 :114 才 `ServerModLoader.load`），所以改成 cmdTest 扫编译出来的类：`client/` 包以外的类的常量池里不能有 `net/minecraft/client/`、`net/neoforged/neoforge/client/`、`com/mojang/blaze3d/`。

### 12.3 界面（Screen）在 26.1 的写法

- 画：重写 `extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float a)`，先调 `super`（画按钮、输入框）。背景由 `extractBackground` 画：`isInGameUi()` 返回 true 时是半透明的渐变（和背包、箱子界面一样，client/gui/screens/Screen.java:383-395、:432；`AbstractContainerScreen` 就返回 true）。`isPauseScreen()` 默认 true（单人游戏开着就暂停），不想暂停返回 false。
- `GuiGraphicsExtractor` 常用（client/gui/GuiGraphicsExtractor.java）：`text(font, String|Component|FormattedCharSequence, x, y, color[, shadow])`（:236 起，默认带阴影）、`centeredText`（:265）、`fill(x0, y0, x1, y1, argb)`（:184）、`outline(x, y, w, h, argb)`（:212）、`blitSprite(RenderPipelines.GUI_TEXTURED, Identifier.withDefaultNamespace("container/slot"), x, y, 18, 18)`（物品格子的底，原版 CreateFlatWorldScreen.java:269 也这么画）、`item(stack, x, y)` / `fakeItem(stack, x, y)` / `itemDecorations(font, stack, x, y)`（数量；:832、:862、:870）、`setComponentTooltipForNextFrame(font, List<Component>, x, y)`（:1075）、`setTooltipForNextFrame(font, Component, x, y)`（:1067）。
- **颜色要带透明度**：`text` 在 `ARGB.alpha(color) != 0` 时才画（:251），写 `0xFFFFFF` 字就不见了，要写 `0xFFFFFFFF`。
- 同一层里后交的盖在先交的上面（原版背包的格子高亮前景就是在画完物品之后交的，AbstractContainerScreen.java:119-121），所以「物品上面蒙一层暗色」在 `item` 之后 `fill`。
- 输入：`mouseClicked(MouseButtonEvent e, boolean doubleClick)`（`e.x()`、`e.y()`、`e.button()`）、`mouseScrolled(double x, double y, double scrollX, double scrollY)`、`keyPressed(KeyEvent e)`（client/gui/components/events/GuiEventListener.java:21-45）。`KeyEvent`：`isConfirmation()` = 回车或小键盘回车（257、335），`isCycleFocus()` = Tab（258），`isEscape()`（client/input/InputWithModifiers.java:25-51）。先调 `super.mouseClicked` 让按钮、输入框先处理。
- 部件：`Button.builder(Component, b -> …).bounds(x, y, w, h).build()`（client/gui/components/Button.java:24、:87、:101），`CommonComponents.GUI_DONE` 是原版的「完成」；`new EditBox(font, x, y, w, h, 名字)`（EditBox.java:69），`setHint(灰字提示)`、`setSuggestion(光标后面的灰字补全)`、`setResponder(文字变了时调)`、`setMaxLength`（:634、:621、:83、:504）；都用 `addRenderableWidget` 加。点击声：`AbstractWidget.playButtonClickSound(minecraft.getSoundManager())`（AbstractWidget.java:168）。
- 字：`font.lineHeight` = 9，`font.width(…)`、`font.split(FormattedText, 宽)` 折行、`font.plainSubstrByWidth(String, 宽)` 截断（client/gui/Font.java:41、:178、:206、:194）。
- 开界面：在客户端主线程 `Minecraft.getInstance().setScreen(new XxxScreen(…))`。探针的 `/status` 里 `screen` 是界面类的简单名（比如 `BlacklistScreen`）。
- 玩家物品栏（客户端也有一份）：`player.getInventory().getItem(格子)`，0–8 是快捷栏，9–35 是背包，`Inventory.INVENTORY_SIZE` = 36（world/entity/player/Inventory.java:30、:430）。方块物品是 `BlockItem`，`getBlock()`（world/item/BlockItem.java:187）。

### 12.4 命令和注册表的小东西

- 方块 id 参数：`IdentifierArgument.id()`、`IdentifierArgument.getId(ctx, 名字)`（commands/arguments/IdentifierArgument.java:15、:19；就是以前的 `ResourceLocationArgument`），`stone` 读成 `minecraft:stone`，大写报错。Tab 补全 `.suggests((c, b) -> SharedSuggestionProvider.suggestResource(Stream<Identifier>, b, ""))`（commands/SharedSuggestionProvider.java:119-126）。要全部方块状态参数才用 `BlockStateArgument`（会补全 `[属性]`）。
- 注册表：`BuiltInRegistries.BLOCK` 是 `DefaultedRegistry`，`getValue(不认识的 id)` 返回空气、不是 null（core/DefaultedRegistry.java:12），查有没有用 `getOptional(id)` 或 `containsKey(id)`（core/Registry.java:73、:104）；`entrySet()` 的键是 `ResourceKey`，取 id 用 `key.identifier()`。
- 命令以外查权限：`Commands.LEVEL_GAMEMASTERS.check(serverPlayer.permissions())`（commands/Commands.java:166、server/permissions/PermissionCheck.java:11）。
- 准星对着的方块（服务器上算）：`player.pick(player.blockInteractionRange(), 1.0F, false)`（world/entity/Entity.java:1909；最后一个参数 false = 看穿液体；`ClipContext.Block.OUTLINE` 用选框，草这种没有碰撞的也选得中），结果是 `BlockHitResult` 且 `getType() == HitResult.Type.BLOCK`。创造模式交互距离 5 格、生存 4.5 格（Player.java:2047）。
- 聊天里可点的字：`new ClickEvent.SuggestCommand("/…")`（填进聊天栏）、`new ClickEvent.CopyToClipboard(文字)`，`new HoverEvent.ShowText(Component)`。
- 游戏目录下的 `config/`：`FMLPaths.CONFIGDIR.get()`（`net.neoforged.fml.loading.FMLPaths`）。

### 12.5 液体、含水，和搭场景时的坑

- 水和岩浆（源头、流动的）都是 `LiquidBlock`（world/level/block/LiquidBlock.java）；气泡柱是 `BubbleColumnBlock`，不是 `LiquidBlock`，单独判断 `Blocks.BUBBLE_COLUMN`。含水属性是 `BlockStateProperties.WATERLOGGED`，`state.hasProperty(…)` / `setValue(…, false)`。海草、海带的流体状态也是水，但没有 `waterlogged` 属性。
- `/tick freeze` 以后方块计划刻和液体刻都不跑（server/level/ServerLevel.java:357-395 看 `tickRateManager().runsNormally()`），随机刻也停（ServerChunkCache.java:324、:348）：放下的水、岩浆不流，草方块不会因为上面压着方块变泥土，岩浆也不会点着旁边的草。卡片搭含水的场景时先冻住，最后 `tick unfreeze`。
- **但岩浆碰到水马上变黑曜石或圆石，冻住也一样**：这是 `LiquidBlock.onPlace` / `neighborChanged` 里直接改的（`shouldSpreadLiquid`，LiquidBlock.java:151、:197、:215），不是计划刻。上、东南西北五个方向只要有流体状态是水的（水、含水方块、海草、气泡柱都算），岩浆就变。搭场景时岩浆要和这些隔开。
- 气泡柱 `setblock` 不加 strict 时只排计划刻、不改状态（BubbleColumnBlock.updateShape），下面要有岩浆块（`drag=true`）或灵魂沙才「站得住」，冻住时不检查也不会变。

### 12.6 普通 JVM（cmdTest）里能用、不能用的

- 不能：`Bootstrap.bootStrap()`、任何 `Blocks.*`。`Blocks` 的静态初始化要 `FeatureFlags`，它调 `FMLLoader.getCurrent()`，抛 `IllegalStateException: There is no current FML Loader`（实测）。所以「这个方块抓的时候怎么存」按 `BlockStateParser.serialize` 的字符串判断（`build/CaptureFilter.java`），在游戏里再换回 BlockState。
- 能：`Identifier.tryParse`（大写、空格返回 null，`stone` 补成 `minecraft:stone`）、Gson（`JsonParser.parseString` 默认宽松：认 `//` 和 `#` 注释、单引号、不加引号的字符串，`[1,]` 多出来的逗号读成 null，坏了抛 `JsonSyntaxException`，消息里有 `line N column M`）。
- Windows 上用 `Files.move(tmp, file, REPLACE_EXISTING, ATOMIC_MOVE)` 替换刚写过的文件，偶尔会抛 `AccessDeniedException`（cmdTest 里遇到过一次，多半是杀毒软件正开着它）；别的程序不带共享删除地开着这个文件时一定会这样（`ExtendedOpenOption.NOSHARE_DELETE` 能复现）。这时直接写进原文件可以成功。
- 也能（mod5 实测）：`NbtOps.INSTANCE` 加 DFU 的 `Codec` / `RecordCodecBuilder` 编码、解码；`UUIDUtil.STRING_CODEC`；`SavedData` 这个基类（new 一个子类、`setDirty` / `isDirty`）；`CompoundTag.getStringOr` / `getIntOr` / `getCompoundOrEmpty`。`SavedDataType` 没在 cmdTest 里用（放在单独的类里，免得测试碰到它）。

## 13. 跟着存档走的数据、命令里的中文字面量、转回去（capture 上次，mod5 查的，2026-11-07）

用在 `/xjy capture 上次`（COMMANDS.md §2b，代码 `build/PlaceRecord.java`、`LastPlaces.java`、`LastPlaceStore.java`、`command/CaptureCommand.java`）。行号都是 .76 的（`tmp/mod/src76/`），都编译过、开发游戏里 P4-003 跑过。

### 13.1 SavedData（存在存档里的自己的数据）

- 26.1 的写法：一个类 `extends SavedData`（world/level/saveddata/SavedData.java，只有 `dirty` 一个字段，`setDirty()`），加一个 `SavedDataType`：`new SavedDataType<>(Identifier id, Supplier<T> 构造器, Codec<T> codec)`（world/level/saveddata/SavedDataType.java:15；NeoForge 补的写法，第 4 个参数 `DataFixTypes` 可以是 null，模组的数据没有 DataFixer）。原版的例子：`WanderingTraderData.TYPE`。
- 放哪：`MinecraftServer.getDataStorage()`（server/MinecraftServer.java:2225）是**整个存档一份**，文件夹是 `<存档>/data/`（:329，`LevelResource.DATA`）；`ServerLevel.getDataStorage()`（server/level/ServerLevel.java:1489）是每个维度自己的一份。不想按维度分就用服务器那份。
- 文件名：`id.withSuffix(".dat").resolveAgainst(data 文件夹)`（world/level/storage/SavedDataStorage.java:65），`Identifier.resolveAgainst` = `root.resolve(命名空间, 路径)`，所以 `xiaojingyu:last_place` → `<存档>/data/xiaojingyu/last_place.dat`。NeoForge 会建中间的文件夹（tryWrite）。
- 取：`computeIfAbsent(type)`（:74）没有就新建一个，**并且标成要存**（`set` 里 `setDirty()`），第一次保存时就会写出一个空文件；`get(type)`（:85）只读，没有文件就是 null，不新建。只是看一眼（status、capture 上次）用 `get`。
- 读：第一次 `get` 时从文件读（gzip 或不压缩的 NBT 都认），`codec.parse(RegistryOps, tag.get("data"))`，出错时 `resultOrPartial` 记一行 ERROR、能读的部分照用，整个读不出来就当没有。
- 存：改了就 `setDirty()`。游戏自动保存（`scheduleSave`，MinecraftServer.java:615-617）和关服 / 退出世界（`close` → `saveAndJoin`，:700）时把标了 dirty 的编码成 `{data: …, DataVersion: 4790}`，gzip 写盘（`IOUtilities.writeNbtCompressed`）。卡片 P4-003 退出世界后，`data/xiaojingyu/last_place.dat` 里就是最后的记录（解出来看过）。
- DFU 的小地方：`optionalFieldOf(名字, 默认值)` 编码时**等于默认值就不写**这个键（`mode` 是 `auto` 时文件里没有 `mode`，读回来还是 `auto`）；`Codec.INT_STREAM` 经 NbtOps 写成 int 数组（`[I;…]`）；`Codec.unboundedMap(UUIDUtil.STRING_CODEC, …)` 写成以 UUID 文字为键的 compound。字段多的 `RecordCodecBuilder.create(i -> i.group(…))` javac 推不出类型（报「对于 group(…) 找不到合适的方法」），要写成 `RecordCodecBuilder.<T>create(…)`，`forGetter` 里的 lambda 写明参数类型 `(T r) -> …`。

### 13.2 Brigadier 的中文字面量

- `Commands.literal("上次")` 可以用：`CommandNode.getRelevantNodes` 把下一个空格前的整段当成这个词去查字面量子节点，查到就只走它（brigadier `CommandNode.java`），`LiteralCommandNode.parse` 比的是原字符串的那一段、后面必须是结尾或空格，没有「只能 ASCII」的限制（只有不加引号的**参数**才限字符）。和整数参数 `<前>` 并排也没冲突：输入是「上次」时只走字面量，是数字时字面量查不到，再走参数。
- 实测：探针经服务器执行 `xjy capture 上次 名字`、`xjy capture last 名字` 都对（卡片 P4-003）。客户端聊天栏里打字时的补全和高亮用的是服务器发来的同一棵命令树（字面量名按 UTF 字符串发），没专门试过，按源码没有问题。
- 给个英文别名就是再挂一个 `literal("last")`，指向同一个处理。

### 13.3 方块状态转回去

- place 转 k 用 `state.rotate(Frame.rotation(k))`，抓回来转 `state.rotate(Frame.rotation((4 − k) & 3))`：`Rotation.getRotated` 两次合起来是 `NONE`，四个水平朝向都回到原样（cmdTest 的 LastPlace 组查了）。
- 各种方块自己的 `rotate`：`HorizontalDirectionalBlock.rotate`（:21）只改 `facing`（原版的床 `BedBlock` 继承它，`part` 不变；我们的家具也继承它，`part` 不变）；`DoorBlock.rotate`（:248）只改 `facing`，**合页 `hinge` 只在 `mirror`（:253）里换**；`StairBlock.rotate`（:170）只改 `facing`，`shape`（inner_left 之类）是相对朝向的，不用改；`CrossCollisionBlock.rotate`（:89，栅栏、玻璃板）把东南西北四个连接属性挪位置；`ChestBlock.rotate`（:365）只改 `facing`，`type` 不变。所以转 k 再转 −k 都回到原来的状态字符串，P4-003 在游戏里 90 / 180 / 270 度、房子（楼梯含拐角、门、我们的床和 40 来种家具、栅栏、玻璃板、灯笼）和原版的床、合页在右的门、箱子都逐格比过，一格不差。
- 方块实体的数据不跟着转（箱子里的东西、床的颜色都和朝向无关），原样搬。

## 14. 模组配置和配置界面（抓取范围的滑块，mod6 查的，2026-11-07）

用在「模组 → 小鲸鱼之家 → 配置」的 4 个滑块（COMMANDS.md §2「抓取范围配置」，代码 `config/CaptureConfig.java`、`client/CaptureConfigScreen.java`、`client/XiaojingyuClient.java`）。NeoForge 的行号是 .76 的（`tmp/mod/nfsrc/`）；FML 没有 .13 的源码，读的是 loader 11.0.15 的 sources jar（Gradle 缓存里有，解压在 `tmp/mod6/fml-src/`），再用 javap 对过 11.0.13 的 `ModContainer`、`ConfigTracker`（方法和调用一样）；night-config 3.8.3 的 sources jar 解压在 `tmp/mod6/nc-src/`。都编译过，开发游戏里跑过（卡片 P2-006、探针截图）。

### 14.1 定义和登记

- `ModConfigSpec`（nf: common/ModConfigSpec.java）：`new ModConfigSpec.Builder()`，`.comment("…", "…")` 给下一个值加注释（几行），`.defineInRange("键", 默认, 最小, 最大)` 返回 `IntValue`（:779），`.build()` 得到 spec（:886）。`push("节")` / `pop()` 分节（我们不分节，键在顶层，配置页打开就是滑块）。`defineInRange` 自己在注释后面加两行 ` Default: 16`、` Range: 1 ~ 64`（:372-376）。注释全是空白在开发环境直接抛异常（`buildComment`，:927-933）。
- 登记：模组构造函数里 `modContainer.registerConfig(ModConfig.Type.COMMON, SPEC)`（FML `ModContainer`），默认文件名 `<modid>-<类型>.toml`（`ConfigTracker.defaultConfigName`），我们的是 `config/xiaojingyu-common.toml`。两个模组登记同一个文件名会抛异常。
- 四种类型（FML `ModConfig.Type` 的注释）：COMMON 两边都读、在全局 `config/`、**不同步**；CLIENT 只在客户端；SERVER 每个存档一份（`<存档>/serverconfig/`）、进世界时读、同步给客户端；STARTUP 登记时就读。COMMON 在模组加载时读（nf: internal/CommonModLoader.java:64，CLIENT 是 :62），比任何命令都早；SERVER 在 `ServerLifecycleHooks`（:92）。
- 读：`IntValue.get()` / `getAsInt()` 有缓存（`ConfigValue.get`），没读进来时抛 `IllegalStateException("Cannot get config value before config is loaded.")`，先看 `SPEC.isLoaded()`。`set(v)` 直接改内存里的值（不写文件、不发事件），值的 restartType 是 NONE 时缓存也跟着改。

### 14.2 文件改了会自己重读

- 会。FML `ConfigTracker.openConfig` 读完文件就给它挂一个 night-config 的 `FileWatcher.defaultInstance().addWatch(path, new ConfigWatcher(…))`，除非 `config/fml.toml` 里 `disableConfigWatcher = true`（默认 false，开发游戏也是 false）。night-config 3.8.3 的 `FileWatcher`：WatchService 每 200 ms 问一次，同一个文件改了以后防抖 500 ms 再调（`DEFAULT_SERVICE_POLL_TIMEOUT`、`DEFAULT_DEBOUNCE_TIME`），认 `ENTRY_MODIFY` 和 `ENTRY_CREATE`（临时文件改名成它也算）。
- `ConfigWatcher.run` → `ConfigTracker.loadConfig(…, ModConfigEvent.Reloading::new)`：重读文件 → `spec.acceptConfig` → `afterReload()` 清掉 restartType 为 NONE 的值的缓存 → 发 `ModConfigEvent.Reloading`（mod 总线）。我们不用听这个事件，下次 `get()` 就是新的。实测（卡片 P2-006）：写完文件到 `/xjy status` 显示新的数约 0.5 秒。
- 读的时候文件「不对」（`isCorrect` 为 false：少了键、数超出范围、类型不对、多了不认识的键）：先备份成 `<名字>-1.toml.bak`（最多留 5 份，旧的往后挪），再 `correct` 修好写回去。修法（`ModConfigSpec.correct` 和 `Range.correct`，:1054）：没写的键用默认值；数字超出范围截到最近的界上（100 → 64，0 → 1）；不是数字 → 默认值；不认识的键删掉。文件根本读不了（不是 TOML）：备份、删掉、按默认值新写一个。
- 只改了值、注释不动的文件是「对的」，重读时不会被改写、不会多出 `.bak`（P2-006 的 `config` 步骤就是这样改的，跑完 `mod/run/config/` 里没有 `.bak`）。

### 14.3 配置界面（ConfigurationScreen），整数怎么变成滑块

- 登记在只在客户端的入口里（`@Mod(value = MOD_ID, dist = Dist.CLIENT)`，构造函数可以收 `(IEventBus, ModContainer)`）：`container.registerExtensionPoint(IConfigScreenFactory.class, (mod, parent) -> new ConfigurationScreen(mod, parent))`（nf: client/gui/IConfigScreenFactory.java；`ConfigurationScreen` 类注释里的写法）。登记了，「模组」列表里这个模组的「配置」按钮才能点。
- `ConfigurationScreen`（nf: client/gui/ConfigurationScreen.java）先列出这个模组的每个配置文件；**只有一个能改的文件时直接点开它**（`addOptions` 里 `count == 1` 就 `autoClose` 并按下那个按钮），关掉那一页时它自己也关掉，回到上一级。第三个参数是 `Function4<ConfigurationScreen, ModConfig.Type, ModConfig, Component, Screen>`，可以换成自己的 `ConfigurationSectionScreen` 子类（我们传 `CaptureConfigScreen::new`）。
- 每个值画成什么（`ConfigurationSectionScreen.rebuild`）：布尔是切换按钮；枚举是循环按钮；**整数（`IntValue`）在 `最大 − 最小 < 256`（`MAX_SLIDER_SIZE`）时是滑块**（`createIntegerValue` → `createSlider`，vanilla 的 `OptionInstance.IntRange`，滑块上只显示数字），否则是输入框；`long`、`double` 一律是输入框（`createNumberBox`）；字符串是输入框。所以 `defineInRange(…, 0, 64)` 不用做任何事就是滑块，没必要自己写界面。
- 字（翻译键，`getTranslationKey`、`translatableConfig`）：每个值的名字 `<modid>.configuration.<键>`（或者 `Builder.translation(…)` 指定的），说明 `<键>.tooltip`（没有就用注释），鼠标停在名字或滑块上显示「粗体名字 + 说明 + 取值范围：1 ~ 64」（范围只在有翻译过的说明时加）；标题 `<modid>.configuration.title`（%s = 模组名）；文件那一页的按钮和标题 `<modid>.configuration.section.<文件名里非字母数字换成点>`、`….title`（我们的是 `xiaojingyu.configuration.section.xiaojingyu.common.toml`）。开发环境下关界面时把缺的键打到日志里（`TranslationChecker.finish`，`neoforge-client.toml` 的 `logUntranslatedConfigurationWarnings`），实测我们的一条都没缺。
- 改了什么时候生效：拖滑块就 `cv.set`（内存里马上变，同一个 JVM 的单人游戏服务器下一次读就是新的），带撤销记录；最上一层那一页关掉时 `changed` 才 `modSpec.save()`：写文件（`LoadedConfig.save` → `ConfigTracker.writeConfig`）并发 `Reloading`。底下三个按钮是 NeoForge 的「取消」（撤回这次的改动）、「重置」（这一页都回默认值）、「完成」。
- 连着服务器时，SERVER 类型的文件按钮是灰的（「这里的设置由服务端决定，且无法在线更改」）；**COMMON 不管**，照样能改，改的是自己电脑上的文件。所以我们在页面下面自己加了一行提示。
- 加自己的行：子类覆盖 `createSyntheticValues()` 返回 `Element(名字, 说明, 部件, undoable)` 的列表，加在最后。子类能用 `changed`、`context.modSpec()`、`minecraft`、`font`。注意 `OptionsSubScreen.removed()` 会存一次原版的 `options.txt`（换界面时都会调）。

### 14.4 从客户端界面发命令、查权限

- `minecraft.player.connection.sendCommand("xjy blacklist")`（client/multiplayer/ClientPacketListener.java:2670）：先给客户端命令（`ClientCommandHandler`），没有就发 `ServerboundChatCommandPacket`（没有要签名的参数时不签名）。服务器 `handleChatCommand` → `tryHandleChat` → `server.execute(…)`（server/network/ServerGamePacketListenerImpl.java:1539、:1646）。
- 单人游戏开着配置界面时游戏是暂停的（`ConfigurationSectionScreen` 是 `OptionsSubScreen`，`isPauseScreen` 默认 true），但内置服务器暂停时照样 `tickConnection()`（client/server/IntegratedServer.java:171-177），排进来的任务在两次 tick 之间照样执行，所以命令会执行、回包会到（实测：点「打开…」约 0.3 秒黑名单界面就开了）。
- 客户端查自己的权限：`Commands.LEVEL_GAMEMASTERS.check(minecraft.player.permissions())`（client/player/LocalPlayer.java:422；服务器用实体事件告诉客户端权限等级，:511-523）。服务器装没装我们的模组：`connection.hasChannel(BlacklistNet.Sync.TYPE)`（客户端的 `ClientPacketListener` 也有，nf: common/extensions/ICommonPacketListener.java:65）。

### 14.5 探针里点按钮（`POST /screen`，docs/PROBE.md 接口 11）

- 打开某个模组的配置界面：`ModList.get().getModContainerById(id)` → `getCustomExtension(IConfigScreenFactory.class)` → `createScreen(container, mc.screen)` → `mc.setScreen(…)`（和 `ModListScreen` 做的一样）。`ConfigurationScreen.init` 里又 `setScreen` 了一次（自动点开唯一的文件），没问题：`Minecraft.setScreen` 先 `added()` 再 `init()`，里面那次把界面换掉以后外面那次照样走完。
- 找按钮：界面、`OptionsList`、列表的每一行（`ContainerObjectSelectionList.Entry`）都是 `ContainerEventHandler`，顺着 `children()` 往下找 `AbstractButton`；点：`button.onPress(new MouseButtonEvent(x, y, new MouseButtonInfo(GLFW.GLFW_MOUSE_BUTTON_LEFT, 0)))`（`AbstractButton.onPress(InputWithModifiers)`，client/gui/components/AbstractButton.java:32；NeoForge 自动点开文件时也是这么点的）。不经过 `MouseHandler`，探针锁着键鼠也能用。

### 14.6 普通 JVM（cmdTest）里

- 能：静态初始化 `ModConfigSpec`（建 spec 不碰 FML，只有空白注释时才调 `FMLEnvironment`）；`spec.getSpec().get(键)` 拿 `ValueSpec`（`getDefault()`、`getRange()`、`getComment()`、`restartType()`）；`spec.getValues().valueMap()` 的顺序就是定义顺序（配置页的顺序）；night-config 的 `CommentedConfig.inMemory()` 加 `spec.correct(config)` / `isCorrect` 查修正规则。
- 读进来要 `ILoadedConfig`，它是 FML 的 sealed 接口，只许包内的 record `LoadedConfig(CommentedConfig, Path, ModConfig)` 实现。测试里用反射造一个（path、modConfig 都给 null，配置先 `correct` 好，`acceptConfig` 就不会去存），测完 `acceptConfig(null)` 卸掉。见 `CaptureRangeTests.loaded`。

## 15. 方块实体、方块实体渲染器、动态贴图、右键（相册和相框，mod7 查的，2026-11-08）

用在相册矮桌、新相框、画框墙（docs/PHOTOS.md §4，代码 `photo/`、`furniture/PhotoFurnitureBlock.java`、`client/PhotoRenderer.java`、`client/PhotoTextures.java`）。行号都是 .76 的（`tmp/mod/src76/`、`tmp/mod/nfsrc/`）。都编译过，开发游戏里卡片 P5-004 跑过（4 个朝向的截图对）。

### 15.1 方块实体：类型、存、发给客户端

- **类型**：`new BlockEntityType<>(工厂::new, Set<Block>)`（world/level/block/entity/BlockEntityType.java:293）。NeoForge 另补了 `Block...` 变参的构造器（:304），变参是空的会抛异常，真没有方块时传 `Set.of()`。注册表 `Registries.BLOCK_ENTITY_TYPE`：`DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, modid)`，`register(名字, () -> new BlockEntityType<>(…, Set.of(block.get())))`。方块注册表比方块实体类型先跑，supplier 里拿方块没问题。
- **方块**：`implements EntityBlock`，`newBlockEntity(pos, state)` 返回 null 就是这一格不要方块实体（我们画框墙的 part 1）。`BlockState.hasBlockEntity()` 只看方块是不是 `EntityBlock`；`LevelChunk.setBlockState`（world/level/chunk/LevelChunk.java:330-345）对新状态调 `newBlockEntity`，null 就不建；同一个方块只换状态（比如 part 变了）时方块实体留着。不继承 `BaseEntityBlock` 也行，渲染形状默认还是方块模型。`BlockEntity` 的构造器会查状态的方块在不在类型的方块里（`validateBlockState`，BlockEntity.java:65），不在就抛 `IllegalStateException`。
- **存、读**：重写 `loadAdditional(ValueInput)`、`saveAdditional(ValueOutput)`，先调 super（NeoForge 在里面存 `NeoForgeData` 和附件，BlockEntity.java:101、:115）。要把一段 NBT 原样存回去：`input.read("键", ExtraCodecs.NBT)` 拿到 `Tag`，`output.store("键", ExtraCodecs.NBT, tag)` 写回（util/ExtraCodecs.java:90），byte array、list、空 compound 都不变。
- **`components: {}`**：`saveWithoutMetadata(ValueOutput)` = `saveAdditional` + **一定写** `components`（空的也写），所以原版箱子 capture 出来都带 `components: {}`。这个方法不是 final，可以重写成「空的就不写」；`loadWithComponents` 读不到就当空（BlockEntity.java:106-109），没有影响。`saveWithFullMetadata`、final 的 `saveWithoutMetadata(Provider)` 都调到它，所以 `/xjy capture`、区块存盘、`/data get block` 都跟着变。
- **发给客户端**：
  - 区块包：`ClientboundLevelChunkPacketData`（network/protocol/game/ClientboundLevelChunkPacketData.java:154）对区块里每个方块实体调 `getUpdateTag(Provider)`（默认空 compound），空的就不带数据，客户端也就不调 `handleUpdateTag`。
  - 变了以后：`level.sendBlockUpdated(pos, state, state, Block.UPDATE_CLIENTS)`，或者 setBlock 带 flag 2（`/xjy place` 的 RAW）、`/setblock` 带 NBT，都会让 `ChunkHolder.broadcastChanges`（server/level/ChunkHolder.java:204-235）在 tick 末尾对有方块实体的格子调 `getUpdatePacket()`（默认 null）并发出去。同一个 tick 里先 setBlock、再 `loadWithComponents` 读数据，发出去的就是读完的数据，所以 `/xjy place` 盖出来客户端马上就有（P5-004 截图）。
  - `ClientboundBlockEntityDataPacket.create(be, (be, registries) -> tag)`（:30）可以给一个和 `getUpdateTag` 不一样的 tag。`getUpdateTag` 只在区块包和不带第二个参数的 `create(be)` 里用。
  - 客户端：区块包 → `handleUpdateTag(ValueInput)`，方块实体包 → `onDataPacket(Connection, ValueInput)`，NeoForge 的默认实现都是 `loadWithComponents`（nf: common/extensions/IBlockEntityExtension.java:36、:47），所以客户端读的也是 `loadAdditional`。
- **包有多大**：一个包在线上（压缩后）最多约 2 MiB（帧长是 3 字节的 varint，`Varint21FrameDecoder`），解压后最多 8 MiB（network/CompressionDecoder.java:13-14）。NeoForge 的 `GenericPacketSplitter` 只拆解压后超过 8 MiB 的包（nf: network/filters/GenericPacketSplitter.java:51-53）。PNG 几乎压不小，一个区块里照片太多，区块包压缩后会超 2 MiB，联机的玩家就断线。单人游戏是内存连接，包不编码。`ChunkWatchEvent.Sent`（nf: event/level/ChunkWatchEvent.java）在区块包发出去之后马上触发（server/network/PlayerChunkSender.java:86），可以在这里给这个玩家补发方块实体包（我们 `PhotoSync` 就这么做）。

### 15.2 右键

- 服务器（server/level/ServerPlayerGameMode.java:369-429）：先 NeoForge 的 `RightClickBlock` 事件；然后方块的 `useItemOn(stack, state, level, pos, player, hand, hit)`，返回 `TRY_WITH_EMPTY_HAND`（默认）而且是主手时，再调 `useWithoutItem(state, level, pos, player, hit)`；都没起作用就轮到物品的 `useOn`（拿着方块就是放方块）。所以「拿着方块时照常放方块」= `useItemOn` 对 `BlockItem` 返回 `PASS`。
- 潜行：`player.isSecondaryUseActive()`（= `isShiftKeyDown()`，Player.java:296）而且**任一只手有东西**时，方块的这两个方法都不调（:392，除非两只手的物品都 `doesSneakBypassUse`）。所以「潜行右键」只能空手（原版箱子、门一样）。卡片 P5-004 实测：潜行拿着木棍右键相框，没起作用。
- 空手时 `stack` 是空的，物品是 `Items.AIR`，类是 `AirItem`，不是 `BlockItem`（world/item/Items.java:64）。
- 客户端也调这两个方法（预测）：`level.isClientSide()` 时直接回 `InteractionResult.SUCCESS`，客户端就挥手、把包发给服务器，真正的事在服务器做。
- 动作栏（物品栏上面一行字）：`player.sendOverlayMessage(Component)`（world/entity/player/Player.java:1402，服务器上 ServerPlayer.java:1904）。
- 放方块时点的是哪个面：`BlockPlaceContext.getClickedFace()`（像展示框那样贴墙）。

### 15.3 方块实体渲染器：先抽取、再提交

- `BlockEntityRenderer<T extends BlockEntity, S extends BlockEntityRenderState>`（client/renderer/blockentity/BlockEntityRenderer.java）：
  - `S createRenderState()`；
  - `extractRenderState(T be, S state, float partialTicks, Vec3 cameraPosition, @Nullable ModelFeatureRenderer.CrumblingOverlay breakProgress)`：默认调 `BlockEntityRenderState.extractBase` 填 `blockPos`、`blockState`、`lightCoords`（`LevelRenderer.getLightCoords`）、`breakProgress`。重写时先调 `BlockEntityRenderer.super.extractRenderState(…)`。读方块实体、读世界都在这里做；render state 对象会被反复用，列表要先清空；
  - `submit(S state, PoseStack poseStack, SubmitNodeCollector collector, CameraRenderState camera)`：只交东西，不直接画；`poseStack` 进来时已经平移到方块的最小角；
  - 另有 `shouldRenderOffScreen()`、`getViewDistance()`（默认 64）、`shouldRender(be, cameraPos)`。
- **渲染范围**：NeoForge 的 `getRenderBoundingBox(be)`（nf: client/extensions/IBlockEntityRendererExtension.java:20），默认就是这一格。画到别的格（两格的画框墙）要放大，不然这一格出了视野整个就不画了。
- **注册**：mod 总线的 `EntityRenderersEvent.RegisterRenderers`，`event.registerBlockEntityRenderer(type, Renderer::new)`（构造器收 `BlockEntityRendererProvider.Context`，nf: client/event/EntityRenderersEvent.java:113）。放在 `dist = CLIENT` 的入口里。
- **自己画四边形**：`collector.submitCustomGeometry(poseStack, renderType, (pose, buffer) -> buffer.addVertex(pose, x, y, z).setColor(-1).setUv(u, v).setLight(light))`（client/renderer/OrderedSubmitNodeCollector.java:192）。原版展示框里的地图就这么画（client/renderer/MapRenderer.java，`RenderTypes.text(贴图)`：位置、颜色、贴图坐标、光照，不要法线和 overlay，受方块光，没有方向阴影）。`RenderTypes.textPolygonOffset(贴图)`（client/renderer/rendertype/RenderTypes.java:588，管线 `TEXT_POLYGON_OFFSET` 带深度偏移 −1 / −10，RenderPipelines.java:460）是告示牌上的字用的，贴在面上远处也不闪（P5-004 在 20 格外拍过）。这些管线剔除背面：四个顶点要按**从正面看逆时针**给。
- 转朝向：`poseStack.mulPose(Axis.YP.rotationDegrees(角度))`，正角度从上往下看是**逆时针**；blockstate 的 y 90（北 → 东，顺时针）对应 −90。
- 抽取阶段可以建贴图、上传：原版 `MapRenderer.extractRenderState` → `MapTextureManager.prepareMapTexture` 里就 `texture.upload()`（client/resources/MapTextureManager.java）。

### 15.4 动态贴图

- `NativeImage.read(byte[])`（com/mojang/blaze3d/platform/NativeImage.java:124）：STB 解码成 RGBA，只查 PNG 文件头，不管多大。要限制大小，就在解码前自己读 IHDR 的宽高（PNG 第 16–23 字节，大端）。`getPixel` / `setPixel` 是 ARGB（:231、:247）。
- `new DynamicTexture(Supplier<String> 名字, NativeImage)`（client/renderer/texture/DynamicTexture.java:22）：建 GPU 贴图（最近邻、重复）并马上上传；之后这张图归它管，`close()` 一起关。
- 登记：`Minecraft.getInstance().getTextureManager().register(Identifier, 贴图)`（client/renderer/texture/TextureManager.java:70），同名的旧贴图被关掉；不要了 `release(Identifier)`（:110）。原版地图的贴图叫 `minecraft:map/<id>`，做法一样。
- `RenderTypes.text(id)` 这类按 Identifier 记住（`Util.memoize`），贴图释放以后再用同一个名字登记照样能画。
- 都在 Render thread 上做。用到的客户端事件（`NeoForge.EVENT_BUS`）：每帧开头 `RenderFrameEvent.Pre`，每 tick `ClientTickEvent.Post`，离开世界 `ClientPlayerNetworkEvent.LoggingOut`。

### 15.5 探针模拟右键（`POST /use`，docs/PROBE.md 接口 12）

- 在服务器线程上：`player.setShiftKeyDown(潜行)` → `player.gameMode.useItemOn(player, level, player.getMainHandItem(), InteractionHand.MAIN_HAND, new BlockHitResult(点到的位置, 面, pos, false))` → 改回原来的潜行状态。走的就是真右键在服务器上的那一段（含 `RightClickBlock` 事件、拿着方块就放方块），只是没有客户端的预测，也不查够不够得着。
- 动作栏的字：`Gui` 的 `overlayMessageString` 是 private、没有 getter，探针用 mixin 的 `@Accessor` 读（`GuiAccessor`）。服务器发的包客户端下一帧才处理，所以等它换成**新的对象**（同一句话再发一次也是新对象），最多等 2 秒。
- 开发版才有的测试开关照风铃（§11.9）放在命令存储 `xiaojingyu:dev`：`photo_chunk_budget`（区块包里照片的预算，测补发用）、`photo_late_sent`（补发了几个）。

## 附录 A：.76 和 .126 的差别

本机两份源码逐个文件比过（`diff -rq`；.76 = tmp/mod/src76 和 tmp/mod/nfsrc，.126 = tmp/api-research/src 和 neo-src）。MC 部分有 49 个文件不同，NeoForge 部分有 56 个。

**本文用到的类，两版完全一样**：Minecraft、Screenshot、NativeImage、RenderSystem、Options、WorldOpenFlows、QuickPlay、MinecraftServer、IntegratedServer、Level、ServerLevel、LevelChunk、BlockEntity、BlockStateParser、BlockInput、Commands、CommandSourceStack、PlayerList、FillCommand、StructureTemplate、NeoForgeClientConfig、ClientModLoader、ClientLifecycleHooks、ServerLifecycleHooks、RegisterCommandsEvent、GameShuttingDownEvent、ScreenshotEvent、ClientTickEvent、RenderFrameEvent、event/tick/*、BlockSnapshot。

**有差别、但不影响本文结论的**

| 文件 | 差别 | 对我们的影响 |
|---|---|---|
| client/renderer/GameRenderer.java | .126 改成比较窗口宽高，.76 用 isResized 标志 | 截图 API 不变；文中行号按 .126 |
| client/KeyboardHandler.java | .126 加了输入法预编辑（ScreenEvent.Preedit）钩子 | 行号偏移，F2 截图逻辑相同 |
| server/level/ServerPlayer.java | .126 打开容器时多发 `PlayerContainerEvent.Open` | `createCommandSourceStack` 在 .76 :1884、.126 :1885 |
| world/level/WorldLoader.java | 多一个 staticLayerTags 参数 | 我们不直接调 |
| world/entity/Entity.java、LivingEntity、ItemEntity | 流体相关重构 | 无 |
| BedBlock、DoorBlock、DoublePlantBlock、PistonBaseBlock、PistonHeadBlock | .126 加了 NeoForge 的 `getRelocability` | 不影响 rotate/mirror |
| nf: client/ClientHooks.java | .126 加预编辑钩子，`onMouseScroll` 参数改了 | 行号偏移：.76 的 `onScreenshot` :489、`fireRenderFramePre` :878、`instantiateMainTarget` :952、`convertUsername` :979（.126 :998） |
| nf: event/EventHooks.java、common/CommonHooks.java、client/ClientNeoForgeMod.java | 若干钩子；.126 注册 ConditionalModelLoader | 文中这些文件的行号按 .126 |
| client/gui/screens/inventory/AbstractContainerScreen.java | .126 加了公开的 `getHoveredSlot()`（:709-713） | .76 没有，要反射读 `hoveredSlot`（§9.3） |
| client/gui/screens/Screen.java | .126 多发 `ScreenEvent.Render.Foreground`（:113-115） | 行号偏移：`extractRenderState` .76 :117、.126 :120（§1.6） |

**只在 .126 有，.76 上别用**：`ConditionalModelLoader`、`ConditionalModelBuilder`、`TooltipFlagExtension`、`BlockRelocability`、`RegisterTooltipAppendersEvent`、`GetEquipmentDropChanceEvent`、`InFluidPredicate`。

**库版本**：FML loader .76 = 11.0.13，.126 = 11.0.15。javap 比过 `Mod`、`EventBusSubscriber`、`FMLEnvironment`、`ParallelDispatchEvent`、`FMLModContainer` 认的构造器参数类型，一致。sponge-mixin .76 = 0.17.3+mixin.0.8.7、MixinExtras 0.5.4（.76 的 pom）；.126 = 0.17.4 / 0.5.5。

## 附录 B：还没确认的点（待验证）

**已实测（mod-2 和 probe-tools 各跑了一次 runClient，都正常退出，2026-11-06）**：
- `neoforge-client.toml` 只写 `showLoadWarnings = false` 一行就行：NeoForge 自动补上缺的键，保留我们的值，不弹加载警告（§4.9）。
- options.txt 写 `graphicsPreset:"custom"` 后，`renderDistance` / `simulationDistance` 不再被预设覆盖（§4.10）。
- 探针在 runClient 里加载；发布 jar 不含探针（§8.2）。
- `com.sun.net.httpserver` 在探针里能用（带 `--add-modules=jdk.httpserver` 测的，§9.3）。

**源码已确认、没在游戏里跑过**（风险低）：
- 命令里写旧的游戏规则名（如 `doDaylightCycle`）会报解析错误（§4.4，GameRuleCommand.java:14-25）。
- `/time set day` = 1000、`noon` = 6000、`night` = 13000、`midnight` = 18000（§4.4，Timelines.java:47-50）。
- `/tick freeze`、`/tick step` 单人房主可用（§4.4，TickCommand.java:23 要 `LEVEL_ADMINS`，房主是 OWNER）。
- 退出世界时，已排队还没执行的主线程任务会被丢掉；存档期间新排的任务要等存档完才执行（§4.6，Minecraft.java:2260、:2294-2296）。

**还要实测**：
1. 在 `FMLClientSetupEvent.enqueueWork` 里改 options 的时机（§4.11）。mod-2 改用启动前复制 options.txt，这条暂时用不上。
2. ~~写回方块实体 NBT 后，客户端是否马上刷新（§5.5）。~~ 2026-11-08 mod7 实测：会。setBlock（带 flag 2）后同一个 tick 里 `loadWithComponents`，tick 末尾 `ChunkHolder.broadcastChanges` 发的方块实体包就带着新数据，前提是方块实体的 `getUpdatePacket()` 不是 null（默认是 null，要自己写，§15.1）。
3. 命令执行中抛普通异常时，结果回调有没有被调用（§6.4）。
4. 分叉命令（`execute as @a ...`）回调被调几次（§6.4）。
5. `/reload` 是否再次触发 `RegisterCommandsEvent`（§6.6）。
6. runServer 不加载探针（§8.2）。先给 server run 单独设 gameDirectory 再测。
7. `--quickPlaySingleplayer` 用 Gradle 属性传入时和配置缓存是否冲突（§8.4）。
8. 批量放置每 tick 放多少合适（§10.4）。
9. 撤销时 flags `2 | 16 | 256` 的效果（§10.5）。
10. 去掉 `--add-modules=jdk.httpserver` 是否照样能用（§9.3；按 JEP 261 应该能）。
11. 给 log4j 根 logger 挂环形缓冲 appender 是否可行（§9.2）。

## 附录 C：资料出处

- MC 26.1.2 + NeoForge 补丁源码：.126 来自 ../dev-env\mdk-26.1.2-template\build\tmp\neoformruntime\20261105-132553_transformSources\output.zip（解压到 tmp/api-research/src）；.76 来自 tmp/mod/src76、tmp/mod/nfsrc。
- NeoForge .76 的 pom / module / userdev：~/.gradle\caches\modules-2\files-2.1\net.neoforged\neoforge\26.1.2.76\。
- FML loader 11.0.13 / 11.0.15、bus 8.0.5、MDG 2.0.148：Gradle 缓存里的 jar，用 javap 看（../dev-env\jdk-25\bin\javap.exe）。
- MDG README：<https://github.com/neoforged/ModDevGradle>（原文 <https://raw.githubusercontent.com/neoforged/ModDevGradle/main/README.md>，本地副本 tmp/api-research/mdg/README.md）。
- MDK 模板：../dev-env\mdk-26.1.2-template\（只读）。

- NeoForge 26.1 发布博客（Technici4n，2026-03-24）：<https://neoforged.net/news/26.1release/>（新闻列表 <https://neoforged.net/news/>）。用到：版本号四段的读法、NeoForm 版本格式、Java 25 / Gradle 9.1+ / MDG 要求、`ItemStackTemplate`、`GuiGraphicsExtractor`、`ChunkPos` 改名（§1.6）。
- 26.1 迁移手册（primer）：<https://github.com/neoforged/.github/blob/main/primers/26.1/index.md>（原文 <https://raw.githubusercontent.com/neoforged/.github/main/primers/26.1/index.md>，本地副本 tmp/api-research/web/primer-26.1.md）。用到：Java 25 和不混淆（:20-28）、世界时钟和时间标记（:1612、:1711）、`doWorldLoad` / `IntegratedServer` 改收可选的 `GameRules`（:1879-1894）、`ChunkPos` 改成 record（:3662）。
- NeoForge 官方文档 Events 页（Version 26.1）：<https://docs.neoforged.net/docs/concepts/events>。用到：`@EventBusSubscriber` 自动注册、mod 总线事件、启动顺序（§7.3）。
- 博客引用的 Mojang 去混淆公告：<https://www.minecraft.net/en-us/article/removing-obfuscation-in-java-edition>（我没打开原文，§1.1 的结论以源码和 NeoForm 配置为准）。
- 博客引用的 Fabric 26.1 公告：<https://fabricmc.net/2026/03/14/261.html>（没用到）。
- mcdev-probe：<https://github.com/yan-mc/minecraft-mod-dev>（main 分支，2026-11-06 拉取，MIT），本地副本 tmp/api-research/mcdev/（§9）。
- JEP 261 Module System，Root modules 一节：<https://openjdk.org/jeps/261>（2026-11-06 拉取，本地副本 tmp/api-research/web/jep261.html）。用到：JDK 11 起，从 classpath 启动时，凡是无条件导出了包的系统模块都是默认根模块（§9.3 的 httpserver 一行）。
- 团队实测：mod-2 给我的消息（2026-11-06，runClient 两次），结果写进了 §4.6、§4.9、§4.10、§8.2、§9.3、附录 B。
- 网上资料都和源码对过，没发现冲突；有出入时以源码为准。
