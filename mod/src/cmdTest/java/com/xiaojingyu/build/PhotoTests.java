package com.xiaojingyu.build;

import static com.xiaojingyu.build.CmdTestMain.check;
import static com.xiaojingyu.build.CmdTestMain.eq;

import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Random;

import com.xiaojingyu.furniture.FurnitureShapes;
import com.xiaojingyu.photo.AlbumPaging;
import com.xiaojingyu.photo.Photo;
import com.xiaojingyu.photo.PhotoSlots;
import com.xiaojingyu.photo.Photos;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;

/**
 * Photos and frames (docs/PHOTOS.md): the photo check of §1, the album paging rules of §4 and finding the picture
 * frame under a click for the four facings (§3 photoSlots).
 */
final class PhotoTests {
    private PhotoTests() {
    }

    static void run() throws Exception {
        pngCheck();
        readNbt();
        paging();
        slots();
        clicks();
        cover();
        snapshots();
    }

    private static void snapshots() throws Exception {
        ListTag source = new ListTag();
        byte[] edge = Arrays.copyOf(png(128, 128, 0), Photos.MAX_BYTES);
        for (int i = 0; i < Photos.MAX_ALBUM; i++) {
            source.add(photoTag(edge, "photo-" + i, "name-" + i));
        }
        var snapshot = new com.xiaojingyu.photo.AlbumSnapshot(source);
        String id = snapshot.reference();
        eq(64, id.length(), "full 3MiB album has a 64-character reference");
        check(com.xiaojingyu.photo.AlbumSnapshot.validReference(id), "reference is lowercase SHA-256");
        eq(id, new com.xiaojingyu.photo.AlbumSnapshot(source.copy()).reference(), "equal albums deduplicate");
        ListTag first = (ListTag) snapshot.copyAlbum();
        ListTag second = (ListTag) snapshot.copyAlbum();
        first.getCompoundOrEmpty(0).putString("Name", "edited after placement");
        first.remove(1);
        eq(64, second.size(), "removing from a placed copy keeps all photos in its sibling");
        eq("name-0", second.getCompoundOrEmpty(0).getStringOr("Name", ""), "nested metadata is independently copied");
        source.clear();
        eq(64, ((ListTag) snapshot.copyAlbum()).size(), "source mutation cannot change stored snapshot");
        eq(id, snapshot.reference(), "editing source and copies never changes reference");
        var encoded = com.xiaojingyu.photo.AlbumSnapshot.CODEC.encodeStart(net.minecraft.nbt.NbtOps.INSTANCE, snapshot).getOrThrow();
        var decoded = com.xiaojingyu.photo.AlbumSnapshot.CODEC.parse(net.minecraft.nbt.NbtOps.INSTANCE, encoded).getOrThrow();
        eq(id, decoded.reference(), "SavedData codec round trip keeps content reference");
        eq(snapshot.copyAlbum(), decoded.copyAlbum(), "SavedData codec preserves order, PNGs and metadata");
        check(!id.equals(new com.xiaojingyu.photo.AlbumSnapshot(first).reference()), "editing creates a new snapshot");
        for (String invalid : List.of("", "../evil", "a".repeat(63), "a".repeat(65), "A".repeat(64))) {
            check(!com.xiaojingyu.photo.AlbumSnapshot.validReference(invalid), "reject unsafe/malformed reference: " + invalid);
            check(com.xiaojingyu.photo.AlbumSnapshot.REFERENCE_CODEC.parse(net.minecraft.nbt.NbtOps.INSTANCE,
                StringTag.valueOf(invalid)).error().isPresent(), "persistent item codec rejects malformed reference");
        }
        var wire = io.netty.buffer.Unpooled.buffer();
        try {
            var codec = net.minecraft.network.codec.ByteBufCodecs.stringUtf8(64);
            codec.encode(wire, id);
            eq(65, wire.readableBytes(), "3MiB album reference costs only 65 component payload bytes");
            eq(id, codec.decode(wire), "reference network round trip");
        } finally {
            wire.release();
        }
        var malformed = new com.xiaojingyu.photo.AlbumSnapshot(StringTag.valueOf("old malformed Album"));
        eq(StringTag.valueOf("old malformed Album"), malformed.copyAlbum(), "raw unreadable Album is preserved losslessly");
        CompoundTag ordered = new CompoundTag();
        ordered.putString("Aa", "one");
        ordered.putString("BB", "two");
        CompoundTag reversed = new CompoundTag();
        reversed.putString("BB", "two");
        reversed.putString("Aa", "one");
        eq(new com.xiaojingyu.photo.AlbumSnapshot(ordered).reference(),
            new com.xiaojingyu.photo.AlbumSnapshot(reversed).reference(), "colliding compound keys have a canonical hash");
        snapshotDiskRoundTrip(snapshot);
        snapshotCacheRepair(snapshot);
    }

    private static void snapshotCacheRepair(com.xiaojingyu.photo.AlbumSnapshot original) throws Exception {
        var dir = java.nio.file.Files.createTempDirectory("xjy-album-cache-");
        var registries = net.minecraft.core.HolderLookup.Provider.create(java.util.stream.Stream.empty());
        var type = com.xiaojingyu.photo.AlbumSnapshot.type(original.reference());
        try (var storage = new net.minecraft.world.level.storage.SavedDataStorage(null, dir, null, registries)) {
            var corruptedNbt = new CompoundTag();
            corruptedNbt.putString("Album", "decodes successfully, but does not match the filename hash");
            var corrupt = com.xiaojingyu.photo.AlbumSnapshot.CODEC.parse(net.minecraft.nbt.NbtOps.INSTANCE, corruptedNbt).getOrThrow();
            storage.set(type, corrupt);
            check(!storage.get(type).reference().equals(original.reference()), "fixture is a decodeable snapshot under the wrong hash");
            String reference = com.xiaojingyu.photo.AlbumSnapshot.store(storage, original.copyAlbum());
            eq(original.reference(), reference, "repair keeps the table's content address");
            var repaired = storage.get(type);
            eq(original.copyAlbum(), repaired.copyAlbum(), "corrupt existing snapshot is repaired from table, preserving all bytes");
            check(repaired.isDirty(), "repaired snapshot is scheduled for world save");
            repaired.setDirty(false);
            com.xiaojingyu.photo.AlbumSnapshot.store(storage, original.copyAlbum());
            check(storage.get(type) == repaired, "intact snapshot is reused by identity");
            check(!repaired.isDirty(), "intact immutable snapshot does not trigger redundant rewrite");
            // No game-loader-only SharedConstants encoding here: MC leave/reopen tests the disk lifecycle.
        } finally {
            java.nio.file.Files.delete(dir);
        }
    }

    private static void snapshotDiskRoundTrip(com.xiaojingyu.photo.AlbumSnapshot snapshot) throws Exception {
        var file = java.nio.file.Files.createTempFile("xjy-album-snapshots-", ".dat");
        try {
            var root = new CompoundTag();
            root.put("data", com.xiaojingyu.photo.AlbumSnapshot.CODEC.encodeStart(net.minecraft.nbt.NbtOps.INSTANCE, snapshot).getOrThrow());
            net.minecraft.nbt.NbtIo.writeCompressed(root, file);
            var reloaded = net.minecraft.nbt.NbtIo.readCompressed(file, net.minecraft.nbt.NbtAccounter.unlimitedHeap());
            var loaded = com.xiaojingyu.photo.AlbumSnapshot.CODEC.parse(net.minecraft.nbt.NbtOps.INSTANCE, reloaded.get("data")).getOrThrow();
            eq(snapshot.reference(), loaded.reference(), "reference survives compressed NBT disk round trip");
            eq(snapshot.copyAlbum(), loaded.copyAlbum(), "all PNG bytes and metadata survive disk reload");
        } finally {
            java.nio.file.Files.delete(file);
        }
    }

    /** A 128 × 128 PNG made by our encoder; {@code noise} makes it big (random pixels hardly compress). */
    static byte[] png(int w, int h, long noise) {
        int[] argb = new int[w * h];
        Random r = new Random(noise);
        for (int i = 0; i < argb.length; i++) {
            argb[i] = noise == 0 ? 0xFF000000 | (i % w < w / 2 ? 0xCC3344 : 0x3355AA) : 0xFF000000 | r.nextInt(0x1000000);
        }
        return PngWriter.encode(w, h, argb);
    }

    private static void pngCheck() throws Exception {
        byte[] good = png(128, 128, 0);
        eq(null, Photos.problem(good), "a small 128×128 PNG is fine");
        check(good.length < Photos.MAX_BYTES, "the plain test PNG is small (" + good.length + " bytes)");
        eq(Photos.Problem.MISSING, Photos.problem(null), "no bytes");

        byte[] badHead = good.clone();
        badHead[1] = 'J';
        eq(Photos.Problem.NOT_PNG, Photos.problem(badHead), "wrong signature");
        byte[] jpeg = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 16, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0};
        eq(Photos.Problem.NOT_PNG, Photos.problem(jpeg), "a JPEG");
        eq(Photos.Problem.NOT_PNG, Photos.problem(Arrays.copyOf(good, 20)), "cut after 20 bytes");
        eq(Photos.Problem.NOT_PNG, Photos.problem(new byte[0]), "no bytes at all");
        byte[] noIhdr = good.clone();
        noIhdr[12] = 'X';
        eq(Photos.Problem.NOT_PNG, Photos.problem(noIhdr), "first chunk is not IHDR");
        byte[] ihdrLength = good.clone();
        ihdrLength[11] = 12;
        eq(Photos.Problem.NOT_PNG, Photos.problem(ihdrLength), "IHDR is not 13 bytes");

        eq(Photos.Problem.WRONG_SIZE, Photos.problem(png(64, 64, 0)), "64×64");
        eq(Photos.Problem.WRONG_SIZE, Photos.problem(png(128, 127, 0)), "128×127");
        eq(Photos.Problem.WRONG_SIZE, Photos.problem(png(256, 128, 0)), "256×128");
        byte[] wide = png(129, 128, 0);
        eq(129, Photos.width(wide), "width read from IHDR");
        eq(128, Photos.height(wide), "height read from IHDR");

        byte[] big = png(128, 128, 7);
        check(big.length > Photos.MAX_BYTES, "random 128×128 PNG is over 48 KB (" + big.length + " bytes)");
        eq(Photos.Problem.TOO_LARGE, Photos.problem(big), "over 48 KB");
        byte[] edge = Arrays.copyOf(good, Photos.MAX_BYTES);
        eq(null, Photos.problem(edge), "exactly 48 KB (49152 bytes) is allowed");
        eq(Photos.Problem.TOO_LARGE, Photos.problem(Arrays.copyOf(good, Photos.MAX_BYTES + 1)), "49153 bytes is too large");

        String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(good));
        eq(sha.substring(0, 16), Photos.id(good), "Id = first 16 hex digits of SHA-1");
        check(Photos.id(good).matches("[0-9a-f]{16}"), "Id is 16 lower-case hex digits");
    }

    private static CompoundTag photoTag(byte[] png, String id, String name) {
        CompoundTag t = new CompoundTag();
        if (id != null) {
            t.putString("Id", id);
        }
        t.putByteArray("Png", png);
        if (name != null) {
            t.putString("Name", name);
        }
        t.putLong("Added", 1762500000000L);
        return t;
    }

    private static void readNbt() {
        byte[] good = png(128, 128, 0);
        String id = Photos.id(good);
        Photo p = Photo.read(photoTag(good, id, "海边"), "test");
        check(p != null, "a good photo reads");
        eq(id, p.id(), "Id");
        eq("海边", p.name(), "Name");
        eq(good.length, p.png().length, "Png bytes");
        check(p.tag().contains("Added"), "the whole compound is kept (Added)");
        CompoundTag sync = p.syncTag();
        eq(2, sync.size(), "the client gets only Id and Png");
        eq(id, p.hash(), "hash = Id for a photo with the right Id");

        eq(null, Photo.read(null, "test"), "null: no photo");
        eq(null, Photo.read(new CompoundTag(), "test"), "empty compound: no photo");
        eq(null, Photo.read(StringTag.valueOf("x"), "test"), "not a compound: no photo");
        byte[] bad = good.clone();
        bad[0] = 0;
        eq(null, Photo.read(photoTag(bad, "1234", null), "test"), "bad header: no photo");
        eq(null, Photo.read(photoTag(png(64, 64, 0), "1234", null), "test"), "64×64: no photo");
        eq(null, Photo.read(photoTag(png(128, 128, 7), "1234", null), "test"), "over 48 KB: no photo");
        CompoundTag noPng = new CompoundTag();
        noPng.putString("Id", id);
        eq(null, Photo.read(noPng, "test"), "no Png: no photo");

        Photo noId = Photo.read(photoTag(good, null, null), "test");
        check(noId != null, "a photo without Id still reads");
        eq(id, noId.id(), "missing Id is worked out from the bytes");
        check(!noId.tag().contains("Id"), "the stored compound stays as it was");
        Photo wrongId = Photo.read(photoTag(good, "0000000000000000", null), "test");
        eq("0000000000000000", wrongId.id(), "a stored Id is used for paging as it is");
        eq(id, wrongId.hash(), "but the texture key is the real hash");

        ListTag album = new ListTag();
        byte[] other = png(128, 128, 0);
        other[other.length - 20] ^= 1; // a different PNG (only its bytes matter here)
        album.add(photoTag(good, "a", "1"));
        album.add(photoTag(bad, "b", "2"));
        album.add(new CompoundTag());
        album.add(photoTag(other, "c", "3"));
        List<Photo> photos = Photo.readList(album, Photos.MAX_ALBUM, "test");
        eq(List.of("a", "c"), photos.stream().map(Photo::id).toList(), "album: bad and empty entries are skipped");
        eq(List.of("a"), Photo.readList(album, 1, "test").stream().map(Photo::id).toList(), "album: only the first max entries");
        eq(0, Photo.readList(null, 64, "test").size(), "no album");
        eq(0, Photo.readList(new CompoundTag(), 64, "test").size(), "album that is not a list");
    }

    private static void paging() {
        List<String> ids = List.of("a", "b", "c");
        int empty = AlbumPaging.EMPTY;
        eq(0, AlbumPaging.step(ids, null, false), "next: empty frame → first");
        eq(1, AlbumPaging.step(ids, "a", false), "next: first → second");
        eq(2, AlbumPaging.step(ids, "b", false), "next: second → third");
        eq(empty, AlbumPaging.step(ids, "c", false), "next: last → empty");
        eq(0, AlbumPaging.step(ids, "zzz", false), "next: not in the album → first");
        eq(2, AlbumPaging.step(ids, null, true), "previous: empty frame → last");
        eq(1, AlbumPaging.step(ids, "c", true), "previous: third → second");
        eq(0, AlbumPaging.step(ids, "b", true), "previous: second → first");
        eq(empty, AlbumPaging.step(ids, "a", true), "previous: first → empty");
        eq(2, AlbumPaging.step(ids, "zzz", true), "previous: not in the album → last");
        List<String> one = List.of("x");
        eq(0, AlbumPaging.step(one, null, false), "one photo: empty → it");
        eq(empty, AlbumPaging.step(one, "x", false), "one photo: it → empty");
        eq(empty, AlbumPaging.step(one, "x", true), "one photo, previous: it → empty");
        eq(0, AlbumPaging.step(one, null, true), "one photo, previous: empty → it");
        List<String> twice = List.of("a", "b", "a");
        eq(1, AlbumPaging.step(twice, "a", false), "the same photo twice: the first match counts");
        // walking the whole circle: empty, a, b, c, empty, a
        String cur = null;
        StringBuilder walk = new StringBuilder();
        for (int i = 0; i < 5; i++) {
            int n = AlbumPaging.step(ids, cur, false);
            cur = n == empty ? null : ids.get(n);
            walk.append(cur == null ? "-" : cur);
        }
        eq("abc-a", walk.toString(), "next goes round: a b c empty a");
        try {
            AlbumPaging.step(List.of(), null, false);
            check(false, "an empty album is the caller's case (it says so in the action bar)");
        } catch (IllegalArgumentException e) {
            check(true, "an empty album is the caller's case");
        }
    }

    private static void slots() {
        double[][] frames = PhotoSlots.of("picture_frames");
        eq(6, frames.length, "picture frames: 6 slots");
        check(Arrays.deepEquals(frames, FurnitureShapes.PICTURE_FRAMES_PHOTO_SLOTS), "picture frames: the generated rows");
        eq(1, PhotoSlots.of("xiaojingyu:photo_frame").length, "photo frame: 1 slot (with the namespace)");
        eq(0, PhotoSlots.of("sofa").length, "sofa: no slots");
        for (double[] r : frames) {
            check(r.length == 6, "rows are {part, x0, y0, x1, y1, z}");
        }
        // The turns: world → model → world gives the same point back, and match FurnitureShapes.rotateY.
        double[] pt = {0.3, 0.6, 0.9};
        for (int q = 0; q < 4; q++) {
            double[] m = PhotoSlots.toModel(q, pt[0], pt[1], pt[2]);
            double[] w = PhotoSlots.toWorld(q, m[0], m[1], m[2]);
            check(Math.abs(w[0] - pt[0]) < 1e-9 && Math.abs(w[1] - pt[1]) < 1e-9 && Math.abs(w[2] - pt[2]) < 1e-9,
                "turn " + q + ": world → model → world");
            double[] box = FurnitureShapes.rotateY(new double[] {2, 0, 3, 2, 0, 3}, q);
            double[] mw = PhotoSlots.toWorld(q, 2, 0, 3);
            check(Math.abs(box[0] - mw[0] * 16) < 1e-9 && Math.abs(box[2] - mw[2] * 16) < 1e-9,
                "turn " + q + ": the same as FurnitureShapes.rotateY");
        }
    }

    /**
     * Clicks on the picture frames for each facing: for every slot, the centre of its rectangle on the photo plane
     * is turned into world space (blocks from the main cell's corner) and must find that slot again; clicks on the
     * wood between frames find the nearest one.
     */
    private static void clicks() {
        String id = "picture_frames";
        double[][] rows = PhotoSlots.of(id);
        String[] facings = {"north", "east", "south", "west"};
        for (int q = 0; q < 4; q++) {
            for (int i = 0; i < rows.length; i++) {
                double[] r = rows[i];
                int[] c = PhotoSlots.cell(id, (int) r[0]);
                double mx = c[0] * 16 + (r[1] + r[3]) / 2;
                double my = c[1] * 16 + (r[2] + r[4]) / 2;
                double mz = c[2] * 16 + r[5] - 0.5;
                double[] w = PhotoSlots.toWorld(q, mx, my, mz);
                eq(i, PhotoSlots.find(id, q, w[0], w[1], w[2]), facings[q] + ": centre of slot " + i);
                // near a corner of the rectangle, still inside
                double[] w2 = PhotoSlots.toWorld(q, c[0] * 16 + r[1] + 0.2, c[1] * 16 + r[4] - 0.2, mz);
                eq(i, PhotoSlots.find(id, q, w2[0], w2[1], w2[2]), facings[q] + ": corner of slot " + i);
            }
        }
        // Hand-checked world points (facing east: the wall is west of the frames, part 1 is south of part 0).
        // Slot 2 is part 0, x 1..10.5 → facing east, model x maps to world z (z = x / 16): z 0.06..0.66.
        // Bottom row y 0.5..6.5. A click at world (0.95, 0.2, 0.4) of the main cell → slot 2.
        eq(2, PhotoSlots.find(id, 1, 0.95, 0.2, 0.4), "east: bottom left of part 0 is slot 2");
        // Same height, z 1.6 (part 1, model x 25.6 → slot 0 at x 22.5..31) → slot 0.
        eq(0, PhotoSlots.find(id, 1, 0.95, 0.2, 1.6), "east: bottom of part 1 far end is slot 0");
        // Top row middle: model x 16 (between part 0 and 1), y 11 → slot 4 (x 11.5..21).
        eq(4, PhotoSlots.find(id, 1, 0.95, 11.0 / 16, 1.0), "east: top middle is slot 4");
        // North: model = world. Wood between bottom frames at x 11, y 3 (slot 2 ends at 10.5, slot 1 starts at 12):
        // nearest is slot 2 (0.5 away) not slot 1 (1 away).
        eq(2, PhotoSlots.find(id, 0, 11.0 / 16, 3.0 / 16, 0.95), "north: between slot 2 and 1, nearer 2");
        // South (turned 180°): model (X, Z) → world (16 − X, 16 − Z); part 1 lies west of the main cell (x < 0).
        eq(0, PhotoSlots.find(id, 2, (16 - 26.0) / 16, 0.2, 0.05), "south: slot 0 is west of the main cell");
        // West: model (X, Z) → world (Z, 16 − X); part 1 is north of the main cell (z < 0).
        eq(3, PhotoSlots.find(id, 3, 0.05, 11.0 / 16, (16 - 27.0) / 16), "west: top of part 1 far end is slot 3");
        eq(0, PhotoSlots.find("photo_frame", 2, 0.5, 0.5, 0.95), "photo frame: always slot 0");
        eq(-1, PhotoSlots.find("sofa", 0, 0.5, 0.5, 0.5), "no slots: -1");
    }

    private static void cover() {
        check(Arrays.equals(new double[] {0, 0, 1, 1}, PhotoSlots.cover(12, 12)), "square: whole photo");
        double[] wide = PhotoSlots.cover(8.5, 5);
        check(wide[0] == 0 && wide[2] == 1, "wide rectangle: full width");
        check(Math.abs((wide[3] - wide[1]) - 5 / 8.5) < 1e-9 && Math.abs(wide[1] + wide[3] - 1) < 1e-9,
            "wide rectangle: the middle 5/8.5 of the height");
        double[] tall = PhotoSlots.cover(4, 8);
        check(tall[1] == 0 && tall[3] == 1 && Math.abs(tall[0] - 0.25) < 1e-9 && Math.abs(tall[2] - 0.75) < 1e-9,
            "tall rectangle: the middle half of the width");
    }
}
