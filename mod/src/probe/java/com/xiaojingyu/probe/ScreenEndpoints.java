package com.xiaojingyu.probe;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.components.events.ContainerEventHandler;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.client.gui.IConfigScreenFactory;
import org.lwjgl.glfw.GLFW;

/**
 * POST /screen：不发真实键鼠，在 Render thread 上直接操作界面（docs/PROBE.md 第 11 个接口）。body 里只写一种：
 * <ul>
 *   <li>{@code {"config": "模组 id"}}：打开这个模组的配置界面（和 模组 → 选这个模组 → 配置 一样，用它登记的
 *       IConfigScreenFactory），上一级是现在的界面（在世界里没开界面时，关掉就回到游戏）。</li>
 *   <li>{@code {"press": "按钮上的字"}}：在现在的界面里找字完全一样、能点的按钮（包括列表里的），调它的 onPress，
 *       和用鼠标左键点一下一样，只是不经过鼠标。</li>
 *   <li>{@code {"close": true}}：现在的界面 onClose()（和按 Esc 一样）。</li>
 * </ul>
 * 回复 {@code screen}（做完以后的界面类名）和 {@code buttons}（这个界面上的按钮：text、active），排错用。
 */
final class ScreenEndpoints {
    private ScreenEndpoints() {
    }

    static Reply screen(ProbeRequest req) {
        int actions = (req.has("config") ? 1 : 0) + (req.has("press") ? 1 : 0) + (req.has("close") ? 1 : 0);
        if (actions != 1) {
            throw ProbeException.badRequest("write exactly one of 'config', 'press', 'close'");
        }
        String config = req.has("config") ? req.requireString("config") : null;
        String press = req.has("press") ? req.requireString("press") : null;
        if (req.has("close") && !req.requireBool("close")) {
            throw ProbeException.badRequest("'close' must be true");
        }
        JsonObject o = ProbeThreads.onClient(ProbeThreads.DEFAULT_TIMEOUT_MS, () -> {
            if (ClientEndpoints.transitioning()) {
                throw ProbeException.busy("a world is opening or closing");
            }
            Minecraft mc = Minecraft.getInstance();
            if (config != null) {
                ModContainer mod = ModList.get().getModContainerById(config)
                    .orElseThrow(() -> ProbeException.notFound("no mod '" + config + "'"));
                IConfigScreenFactory factory = mod.getCustomExtension(IConfigScreenFactory.class)
                    .orElseThrow(() -> ProbeException.notFound("mod '" + config + "' has no config screen"));
                mc.setScreen(factory.createScreen(mod, mc.screen));
            } else if (press != null) {
                Screen screen = mc.screen;
                if (screen == null) {
                    throw ProbeException.notFound("no screen is open");
                }
                List<AbstractButton> buttons = new ArrayList<>();
                collect(screen, buttons);
                AbstractButton hit = null;
                for (AbstractButton b : buttons) {
                    if (b.getMessage().getString().equals(press) && b.active && b.visible) {
                        hit = b;
                        break;
                    }
                }
                if (hit == null) {
                    throw ProbeException.notFound("no active button '" + press + "' on " + screen.getClass().getSimpleName()
                        + " (buttons: " + describe(buttons) + ")");
                }
                hit.onPress(new MouseButtonEvent(hit.getX() + hit.getWidth() / 2.0, hit.getY() + hit.getHeight() / 2.0,
                    new MouseButtonInfo(GLFW.GLFW_MOUSE_BUTTON_LEFT, 0)));
            } else {
                if (mc.screen == null) {
                    throw ProbeException.notFound("no screen is open");
                }
                mc.screen.onClose();
            }
            JsonObject body = Reply.newBody();
            Screen now = mc.screen;
            body.addProperty("screen", now == null ? null : now.getClass().getSimpleName());
            JsonArray list = new JsonArray();
            if (now != null) {
                List<AbstractButton> buttons = new ArrayList<>();
                collect(now, buttons);
                for (AbstractButton b : buttons) {
                    JsonObject bo = new JsonObject();
                    bo.addProperty("text", b.getMessage().getString());
                    bo.addProperty("active", b.active);
                    list.add(bo);
                }
            }
            body.add("buttons", list);
            return body;
        });
        return Reply.ok(o);
    }

    /** All buttons under this element (screens, lists and their rows are containers). */
    private static void collect(GuiEventListener e, List<AbstractButton> out) {
        if (e instanceof AbstractButton b) {
            out.add(b);
        }
        if (e instanceof ContainerEventHandler c) {
            for (GuiEventListener child : c.children()) {
                collect(child, out);
            }
        }
    }

    private static String describe(List<AbstractButton> buttons) {
        List<String> names = new ArrayList<>();
        for (AbstractButton b : buttons) {
            names.add("'" + b.getMessage().getString() + "'" + (b.active ? "" : " (inactive)"));
        }
        return String.join(", ", names);
    }
}
