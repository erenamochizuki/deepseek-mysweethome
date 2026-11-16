package com.xiaojingyu.client;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.logging.LogUtils;
import com.xiaojingyu.XiaojingyuMod;
import com.xiaojingyu.photo.Photo;
import com.xiaojingyu.photo.Photos;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

/**
 * Photos as textures (docs/PHOTOS.md §4), only on the render thread. One {@link DynamicTexture} per photo, keyed by
 * the SHA-1 Id of its bytes (worked out here, so a wrong stored Id can never show another photo), registered as
 * {@code xiaojingyu:photo/<id>} like vanilla map textures. Frames showing the same photo share it.
 *
 * <ul>
 *   <li>Decoding: the bytes were already checked (signature, 128 × 128, ≤ 48 KB) when the block entity read them;
 *       here MC's PNG reader decodes them, the size is checked again and every pixel is made opaque. At most
 *       {@link #DECODES_PER_FRAME} new photos per frame, so a wall full of photos does not stall one frame (the rest
 *       show a frame later). A photo that cannot be decoded is remembered as bad (one log line) and not drawn.</li>
 *   <li>Releasing: a texture nobody drew for {@link #KEEP_SECONDS} seconds is released (GPU memory and the image);
 *       leaving the world releases all of them.</li>
 * </ul>
 */
final class PhotoTextures {
    private static final Logger LOGGER = LogUtils.getLogger();
    static final int DECODES_PER_FRAME = 4;
    static final int KEEP_SECONDS = 30;
    private static final long KEEP_NANOS = KEEP_SECONDS * 1_000_000_000L;

    private static final Map<String, Entry> CACHE = new HashMap<>();
    private static int decodedThisFrame;
    private static int ticks;

    /** A decoded photo; location null = could not be decoded. */
    private static final class Entry {
        final @Nullable Identifier location;
        long lastUsed;

        Entry(@Nullable Identifier location) {
            this.location = location;
        }
    }

    private PhotoTextures() {
    }

    /** The texture of a photo, or null (bad, or waiting for its turn to be decoded). Render thread only. */
    static @Nullable Identifier get(Photo photo) {
        String key = photo.hash();
        Entry e = CACHE.get(key);
        if (e == null) {
            if (decodedThisFrame >= DECODES_PER_FRAME) {
                return null;
            }
            decodedThisFrame++;
            e = new Entry(decode(key, photo));
            CACHE.put(key, e);
        }
        e.lastUsed = System.nanoTime();
        return e.location;
    }

    private static @Nullable Identifier decode(String key, Photo photo) {
        byte[] png = photo.png();
        if (Photos.problem(png) != null) {
            return null;
        }
        NativeImage image = null;
        try {
            image = NativeImage.read(png);
            if (image.getWidth() != Photos.SIZE || image.getHeight() != Photos.SIZE) {
                LOGGER.warn("[xiaojingyu] photo {} not drawn: decoded as {}×{}", photo.id(), image.getWidth(), image.getHeight());
                image.close();
                return null;
            }
            for (int y = 0; y < Photos.SIZE; y++) {
                for (int x = 0; x < Photos.SIZE; x++) {
                    image.setPixel(x, y, image.getPixel(x, y) | 0xFF000000);
                }
            }
            Identifier location = Identifier.fromNamespaceAndPath(XiaojingyuMod.MOD_ID, "photo/" + key);
            NativeImage pixels = image;
            image = null; // the texture owns it now
            Minecraft.getInstance().getTextureManager().register(location, new DynamicTexture(() -> "xiaojingyu photo " + key, pixels));
            return location;
        } catch (Exception ex) {
            LOGGER.warn("[xiaojingyu] photo {} not drawn: {}", photo.id(), ex.toString());
            if (image != null) {
                image.close();
            }
            return null;
        }
    }

    /** Start of a frame: new photos may be decoded again. */
    static void onFrame() {
        decodedThisFrame = 0;
    }

    /** Every client tick: once a second, release textures nobody drew for a while. */
    static void onTick() {
        if (++ticks < 20) {
            return;
        }
        ticks = 0;
        long now = System.nanoTime();
        for (Iterator<Map.Entry<String, Entry>> it = CACHE.entrySet().iterator(); it.hasNext(); ) {
            Entry e = it.next().getValue();
            if (now - e.lastUsed > KEEP_NANOS) {
                release(e);
                it.remove();
            }
        }
    }

    /** Leaving the world: release everything. */
    static void clear() {
        CACHE.values().forEach(PhotoTextures::release);
        CACHE.clear();
    }

    /** Number of photo textures held now (decoded ones and remembered bad ones). */
    static int size() {
        return CACHE.size();
    }

    private static void release(Entry e) {
        if (e.location != null) {
            Minecraft.getInstance().getTextureManager().release(e.location);
        }
    }
}
