package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;
import static com.xiaojingyu.build.CmdTestMain.throwsIae;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.zip.CRC32;

import javax.imageio.ImageIO;

import com.xiaojingyu.share.ShareFiles;
import com.xiaojingyu.share.ShareModel;

import net.minecraft.world.level.material.MapColor;

/** The preview picture of a capture (COMMANDS.md §5) and our PNG encoder. */
final class ImageTests {
    private ImageTests() {
    }

    static void run() throws Exception {
        scale();
        shading();
        render();
        pngRoundTrip();
        pngChunks();
        shareRoundTrip();
    }

    private static void scale() {
        eq(16, PreviewImage.scale(1, 1), "1x1 uses 16 px per block");
        eq(16, PreviewImage.scale(32, 17), "32 long: 16 px");
        eq(15, PreviewImage.scale(33, 10), "33 long: 15 px");
        eq(3, PreviewImage.scale(129, 64), "widest capture: 3 px");
        eq(1, PreviewImage.scale(1024, 3), "1024 long: 1 px");
        for (int[] s : new int[][] {{1, 1}, {17, 64}, {64, 129}, {500, 2}, {511, 511}, {512, 1}}) {
            int px = PreviewImage.scale(s[0], s[1]);
            check(px >= 1 && px <= 16 && Math.max(s[0], s[1]) * px <= 512,
                "scale(" + s[0] + ", " + s[1] + ") = " + px + " keeps the long side within 512 px");
        }
    }

    /** COMMANDS.md §5: shaded like the vanilla map at scale 0 (MapItem.java:173), against the block to the north. */
    private static void shading() {
        for (int dh = -3; dh <= 3; dh++) {
            for (int parity = 0; parity < 2; parity++) {
                double diff = dh * 4.0 / (1 + 4) + (parity - 0.5) * 0.4;
                MapColor.Brightness want = diff > 0.6 ? MapColor.Brightness.HIGH
                    : diff < -0.6 ? MapColor.Brightness.LOW : MapColor.Brightness.NORMAL;
                eq(want, PreviewImage.brightness(70 + dh, 70, parity, 0), "height step " + dh + ", parity " + parity);
            }
        }
        eq(MapColor.Brightness.HIGH, PreviewImage.brightness(72, 70, 0, 0), "higher than the north block is brighter");
        eq(MapColor.Brightness.LOW, PreviewImage.brightness(68, 70, 1, 0), "lower than the north block is darker");
    }

    private static void render() {
        // 2 x 2 blocks at 2 px, north up: grass, nothing / nothing, stone.
        MapColor[] colors = {MapColor.GRASS, MapColor.NONE, null, MapColor.STONE};
        int[] img = PreviewImage.render(2, 2, colors, new int[] {5, 0, 0, 3}, 2);
        int g = MapColor.GRASS.calculateARGBColor(MapColor.Brightness.NORMAL);
        int s = MapColor.STONE.calculateARGBColor(MapColor.Brightness.NORMAL);
        eq(new int[] {g, g, 0, 0, g, g, 0, 0, 0, 0, s, s, 0, 0, s, s}, img, "colours, transparent where nothing, north up");
        int[] column = PreviewImage.render(1, 2, new MapColor[] {MapColor.STONE, MapColor.STONE}, new int[] {10, 8}, 1);
        eq(MapColor.STONE.calculateARGBColor(MapColor.Brightness.NORMAL), column[0], "north row is not shaded");
        eq(MapColor.STONE.calculateARGBColor(MapColor.Brightness.LOW), column[1], "lower than its north block: darker");
    }

    private static void pngRoundTrip() throws Exception {
        Random random = new Random(42);
        int[] argb = new int[7 * 5];
        for (int i = 0; i < argb.length; i++) {
            argb[i] = random.nextInt();
        }
        argb[0] = 0;
        argb[1] = 0xFFFFFFFF;
        argb[2] = 0x80FF0000;
        eq(argb, decode(PngWriter.encode(7, 5, argb), 7, 5), "7x5 pixels with alpha read back by ImageIO");
        int[] big = new int[512 * 512];
        for (int i = 0; i < big.length; i++) {
            big[i] = random.nextInt();
        }
        eq(big, decode(PngWriter.encode(512, 512, big), 512, 512), "512x512 noise reads back");
        throwsIae(() -> PngWriter.encode(0, 1, new int[0]), "zero width refused");
        throwsIae(() -> PngWriter.encode(2, 2, new int[3]), "wrong pixel count refused");
    }

    private static int[] decode(byte[] png, int w, int h) throws Exception {
        BufferedImage img = ImageIO.read(new ByteArrayInputStream(png));
        check(img != null && img.getWidth() == w && img.getHeight() == h, "ImageIO reads a " + w + "x" + h + " PNG");
        return img == null ? new int[0] : img.getRGB(0, 0, w, h, null, 0, w);
    }

    /** Chunk order and CRCs, checked by hand (ImageIO does not check CRCs). */
    private static void pngChunks() {
        byte[] png = PngWriter.encode(3, 2, new int[6]);
        byte[] signature = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
        boolean sig = png.length > 8;
        for (int i = 0; i < 8 && sig; i++) {
            sig = png[i] == signature[i];
        }
        check(sig, "PNG signature");
        ByteBuffer b = ByteBuffer.wrap(png, 8, png.length - 8);
        List<String> types = new ArrayList<>();
        while (b.remaining() >= 12) {
            byte[] typeAndData = new byte[4 + b.getInt()];
            b.get(typeAndData);
            CRC32 crc = new CRC32();
            crc.update(typeAndData);
            String type = new String(typeAndData, 0, 4, StandardCharsets.US_ASCII);
            check((int) crc.getValue() == b.getInt(), type + " CRC");
            types.add(type);
            if (type.equals("IHDR")) {
                ByteBuffer ihdr = ByteBuffer.wrap(typeAndData, 4, typeAndData.length - 4);
                eq("3x2 depth 8 type 6", ihdr.getInt() + "x" + ihdr.getInt() + " depth " + ihdr.get() + " type " + ihdr.get(),
                    "IHDR: 8-bit RGBA");
            }
        }
        eq(List.of("IHDR", "IDAT", "IEND"), types, "chunk order");
        eq(0, b.remaining(), "nothing after IEND");
    }

    /** Our PNG works as the picture of a share file, and ShareFiles reads the building back. */
    private static void shareRoundTrip() throws Exception {
        ShareModel model = new ShareModel(2, 1, 1);
        model.set(1, 0, 0, "minecraft:stone");
        int[] picture = {0xFF336699, 0};
        byte[] file = ShareFiles.writePng(model, PngWriter.encode(2, 1, picture));
        ShareModel back = ShareFiles.read(file);
        eq("minecraft:stone", back.get(1, 0, 0), "block read back from the PNG");
        eq("minecraft:air", back.get(0, 0, 0), "air read back");
        eq(picture, decode(file, 2, 1), "the picture is still our preview");
    }
}
