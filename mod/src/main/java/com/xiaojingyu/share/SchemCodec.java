package com.xiaojingyu.share;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.TreeSet;
import net.minecraft.nbt.ByteArrayTag;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.IntArrayTag;
import net.minecraft.nbt.IntTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.ShortTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;

/**
 * {@link ShareModel} ⇄ Sponge Schematic v3 NBT, rule by rule as in docs/FORMAT.md §3.
 * No gzip and no PNG here, see {@link ShareFiles}.
 */
public final class SchemCodec {
    public static final int SPONGE_VERSION = 3;

    private SchemCodec() {
    }

    // ---------------------------------------------------------------- write

    /**
     * The root compound {@code {"Schematic": {...}}} for a model. The model is checked with the same
     * rules as reading; it is not changed.
     */
    public static CompoundTag encode(ShareModel model) throws ShareException {
        ShareModel.checkSize(model.width(), model.height(), model.length());
        int badCell = model.firstBadCell();
        if (badCell >= 0) {
            throw ShareException.badSchematic("第 " + badCell + " 格的方块编号不在调色板里",
                "cell " + badCell + " has palette id " + model.cells()[badCell]
                    + ", palette has " + model.palette().size() + " states");
        }
        ShareModel.Canonical canonical = model.canonical();
        List<String> palette = canonical.palette();
        if (palette.size() > ShareModel.MAX_PALETTE) {
            throw ShareException.of(ShareException.TOO_LARGE, palette.size() + " different block states");
        }

        CompoundTag schematic = new CompoundTag();
        schematic.putInt("Version", SPONGE_VERSION);
        schematic.putInt("DataVersion", model.dataVersion());
        if (model.meta() != null) {
            CompoundTag meta = model.meta().copy();
            List<String> mods = requiredMods(palette);
            if (mods.isEmpty()) {
                meta.remove("RequiredMods");
            } else {
                ListTag list = new ListTag();
                for (String mod : mods) {
                    list.add(StringTag.valueOf(mod));
                }
                meta.put("RequiredMods", list);
            }
            schematic.put("Metadata", meta);
        }
        schematic.putShort("Width", (short) model.width());
        schematic.putShort("Height", (short) model.height());
        schematic.putShort("Length", (short) model.length());
        schematic.put("Offset", new IntArrayTag(model.offset()));

        CompoundTag paletteTag = new CompoundTag();
        for (int i = 0; i < palette.size(); i++) {
            paletteTag.putInt(palette.get(i), i);
        }
        ListTag blockEntities = new ListTag();
        for (ShareModel.BlockEntityEntry be : model.blockEntities()) {
            CompoundTag entry = new CompoundTag();
            entry.put("Pos", new IntArrayTag(new int[] {be.x(), be.y(), be.z()}));
            entry.putString("Id", be.id());
            if (be.data() != null) {
                entry.put("Data", be.data().copy());
            }
            blockEntities.add(entry);
        }
        CompoundTag blocks = new CompoundTag();
        blocks.put("Palette", paletteTag);
        blocks.put("Data", new ByteArrayTag(encodeVarints(canonical.cells())));
        blocks.put("BlockEntities", blockEntities);
        schematic.put("Blocks", blocks);

        CompoundTag root = new CompoundTag();
        root.put("Schematic", schematic);
        return root;
    }

    /**
     * Mods a list of block states needs (FORMAT.md §3.1): the namespace of each state (the part
     * before the first ':' of the part before '['; no ':' means minecraft), without minecraft,
     * no duplicates, sorted with {@link String#compareTo}.
     */
    public static List<String> requiredMods(Collection<String> states) {
        TreeSet<String> mods = new TreeSet<>();
        for (String state : states) {
            int bracket = state.indexOf('[');
            String block = bracket < 0 ? state : state.substring(0, bracket);
            int colon = block.indexOf(':');
            String namespace = colon < 0 ? "minecraft" : block.substring(0, colon);
            if (!namespace.equals("minecraft")) {
                mods.add(namespace);
            }
        }
        return List.copyOf(mods);
    }

    // ---------------------------------------------------------------- read

    /**
     * A model from the root compound of a .schem. Checks in the order of FORMAT.md §3 (first
     * problem wins), warnings come last. The model gets the canonical palette and keeps Metadata
     * and block entity Data as they are.
     */
    public static ShareModel decode(CompoundTag root) throws ShareException {
        CompoundTag s;
        Tag schematicTag = root.get("Schematic");
        if (schematicTag != null) {
            if (!(schematicTag instanceof CompoundTag compound)) {
                throw ShareException.badSchematic("Schematic 不是 compound", "Schematic is not a compound");
            }
            s = compound;
        } else if (root.contains("Version")) {
            s = root;
        } else {
            throw ShareException.badSchematic("没有 Schematic", "no Schematic compound and no Version at the root");
        }

        if (!(s.get("Version") instanceof IntTag version)) {
            throw ShareException.badSchematic("没有 Version（int）", "Version missing or not an int");
        }
        if (version.value() != SPONGE_VERSION) {
            throw ShareException.unsupportedVersion(version.value());
        }
        if (!(s.get("DataVersion") instanceof IntTag dataVersion)) {
            throw ShareException.badSchematic("没有 DataVersion（int）", "DataVersion missing or not an int");
        }
        CompoundTag meta = null;
        Tag metaTag = s.get("Metadata");
        if (metaTag != null) {
            if (!(metaTag instanceof CompoundTag compound)) {
                throw ShareException.badSchematic("Metadata 不是 compound", "Metadata is not a compound");
            }
            meta = compound;
        }
        int width = side(s, "Width");
        int height = side(s, "Height");
        int length = side(s, "Length");
        if (!ShareModel.sizeAllowed(width, height, length)) {
            throw ShareException.of(ShareException.TOO_LARGE, "size " + width + "x" + height + "x" + length);
        }
        int[] offset = {0, 0, 0};
        Tag offsetTag = s.get("Offset");
        if (offsetTag != null) {
            if (!(offsetTag instanceof IntArrayTag array) || array.getAsIntArray().length != 3) {
                throw ShareException.badSchematic("Offset 必须是 3 个 int", "Offset is not an int array of 3");
            }
            offset = array.getAsIntArray();
        }
        if (!(s.get("Blocks") instanceof CompoundTag blocks)) {
            throw ShareException.badSchematic("没有 Blocks（compound）", "Blocks missing or not a compound");
        }

        ShareModel model = new ShareModel(width, height, length);
        boolean unusedPalette = readBlocks(blocks, model);
        readBlockEntities(blocks, model);

        model.setOffset(offset[0], offset[1], offset[2]);
        model.setDataVersion(dataVersion.value());
        model.setMeta(meta);

        if (dataVersion.value() != ShareModel.CURRENT_DATA_VERSION) {
            model.addWarning(ShareModel.WARN_DATA_VERSION);
        }
        if (s.contains("Biomes")) {
            model.addWarning(ShareModel.WARN_IGNORED_BIOMES);
        }
        if (s.get("Entities") instanceof ListTag entities && !entities.isEmpty()) {
            model.addWarning(ShareModel.WARN_IGNORED_ENTITIES);
        }
        if (unusedPalette) {
            model.addWarning(ShareModel.WARN_UNUSED_PALETTE);
        }
        if (meta != null && meta.get("Xiaojingyu") instanceof CompoundTag xjy
            && xjy.get("FormatVersion") instanceof IntTag formatVersion
            && formatVersion.value() > ShareModel.FORMAT_VERSION) {
            model.addWarning(ShareModel.WARN_NEWER_FORMAT);
        }
        return model;
    }

    private static int side(CompoundTag s, String key) throws ShareException {
        if (!(s.get(key) instanceof ShortTag tag)) {
            throw ShareException.badSchematic("没有 " + key + "（short）", key + " missing or not a short");
        }
        int value = tag.value() & 0xFFFF;
        if (value < 1) {
            throw ShareException.badSchematic(key + " 不能是 0", key + " is 0");
        }
        return value;
    }

    /** Palette and Data into the model's cells, canonical palette. Returns whether some palette entry was unused. */
    private static boolean readBlocks(CompoundTag blocks, ShareModel model) throws ShareException {
        if (!(blocks.get("Palette") instanceof CompoundTag paletteTag)) {
            throw ShareException.badSchematic("没有 Palette（compound）", "Blocks.Palette missing or not a compound");
        }
        int count = paletteTag.size();
        String[] states = new String[count];
        int[] ids = new int[count];
        int k = 0;
        for (String state : paletteTag.keySet()) {
            if (!(paletteTag.get(state) instanceof IntTag id) || id.value() < 0) {
                throw ShareException.badSchematic("调色板里「" + state + "」的编号不是 0 以上的整数",
                    "palette entry " + state + " is not an int >= 0");
            }
            states[k] = state;
            ids[k] = id.value();
            k++;
        }
        // entry indexes sorted by id, to find duplicates and to look ids up
        Integer[] order = new Integer[count];
        for (int i = 0; i < count; i++) {
            order[i] = i;
        }
        Arrays.sort(order, (a, b) -> Integer.compare(ids[a], ids[b]));
        int[] sortedIds = new int[count];
        int[] sortedEntry = new int[count];
        for (int i = 0; i < count; i++) {
            sortedIds[i] = ids[order[i]];
            sortedEntry[i] = order[i];
            if (i > 0 && sortedIds[i] == sortedIds[i - 1]) {
                throw ShareException.badSchematic("调色板里有两个方块用了同一个编号 " + sortedIds[i],
                    "palette id " + sortedIds[i] + " used twice");
            }
        }
        if (count > ShareModel.MAX_PALETTE) {
            throw ShareException.of(ShareException.TOO_LARGE, "palette has " + count + " entries");
        }

        if (!(blocks.get("Data") instanceof ByteArrayTag dataTag)) {
            throw ShareException.badSchematic("没有 Data（byte array）", "Blocks.Data missing or not a byte array");
        }
        int[] cells = model.cells();
        decodeVarints(dataTag.getAsByteArray(), cells);

        // file palette id -> palette entry (dense table when ids are small, binary search otherwise)
        int maxId = count == 0 ? -1 : sortedIds[count - 1];
        int[] dense = null;
        if (maxId < (1 << 20)) {
            dense = new int[maxId + 1];
            Arrays.fill(dense, -1);
            for (int i = 0; i < count; i++) {
                dense[sortedIds[i]] = sortedEntry[i];
            }
        }
        int[] canonicalOf = new int[count];
        Arrays.fill(canonicalOf, -1);
        List<String> canonicalPalette = new ArrayList<>();
        int lastRaw = -1;
        int lastCanonical = -1;
        for (int i = 0; i < cells.length; i++) {
            int raw = cells[i];
            if (raw != lastRaw) {
                int entry;
                if (dense != null) {
                    entry = raw <= maxId ? dense[raw] : -1;
                } else {
                    int at = Arrays.binarySearch(sortedIds, raw);
                    entry = at >= 0 ? sortedEntry[at] : -1;
                }
                if (entry < 0) {
                    throw ShareException.badSchematic("第 " + i + " 格的方块编号 " + raw + " 不在调色板里",
                        "cell " + i + " has id " + raw + ", not in the palette");
                }
                if (canonicalOf[entry] < 0) {
                    canonicalOf[entry] = canonicalPalette.size();
                    canonicalPalette.add(states[entry]);
                }
                lastRaw = raw;
                lastCanonical = canonicalOf[entry];
            }
            cells[i] = lastCanonical;
        }
        model.setPalette(canonicalPalette);
        return canonicalPalette.size() < count;
    }

    private static void readBlockEntities(CompoundTag blocks, ShareModel model) throws ShareException {
        Tag tag = blocks.get("BlockEntities");
        if (tag == null) {
            return;
        }
        if (!(tag instanceof ListTag list)) {
            throw ShareException.badSchematic("BlockEntities 不是列表", "Blocks.BlockEntities is not a list");
        }
        for (int i = 0; i < list.size(); i++) {
            String where = "第 " + (i + 1) + " 个方块实体";
            if (!(list.get(i) instanceof CompoundTag entry)) {
                throw ShareException.badSchematic(where + "不是 compound", "block entity " + i + " is not a compound");
            }
            if (!(entry.get("Pos") instanceof IntArrayTag posTag) || posTag.getAsIntArray().length != 3) {
                throw ShareException.badSchematic(where + "没有 Pos（3 个 int）", "block entity " + i + ": Pos is not an int array of 3");
            }
            int[] pos = posTag.getAsIntArray();
            if (!model.contains(pos[0], pos[1], pos[2])) {
                throw ShareException.badSchematic(where + "的位置在建筑外面",
                    "block entity " + i + ": Pos " + Arrays.toString(pos) + " outside the size");
            }
            if (!(entry.get("Id") instanceof StringTag id)) {
                throw ShareException.badSchematic(where + "没有 Id（string）", "block entity " + i + ": Id missing or not a string");
            }
            CompoundTag data = null;
            Tag dataTag = entry.get("Data");
            if (dataTag != null) {
                if (!(dataTag instanceof CompoundTag compound)) {
                    throw ShareException.badSchematic(where + "的 Data 不是 compound", "block entity " + i + ": Data is not a compound");
                }
                data = compound;
            }
            if (model.blockEntity(pos[0], pos[1], pos[2]) != null) {
                throw ShareException.badSchematic(where + "和前面的方块实体在同一格",
                    "block entity " + i + ": Pos " + Arrays.toString(pos) + " used twice");
            }
            model.putBlockEntity(pos[0], pos[1], pos[2], id.value(), data);
        }
    }

    // ---------------------------------------------------------------- varints

    /** Unsigned LEB128 varints, one per value (values must be >= 0). */
    static byte[] encodeVarints(int[] values) {
        int size = 0;
        for (int v : values) {
            size += 1 + (31 - Integer.numberOfLeadingZeros(v)) / 7;
        }
        byte[] out = new byte[size];
        int p = 0;
        for (int v : values) {
            while ((v & ~0x7F) != 0) {
                out[p++] = (byte) ((v & 0x7F) | 0x80);
                v >>>= 7;
            }
            out[p++] = (byte) v;
        }
        return out;
    }

    /**
     * Fills {@code out} with exactly {@code out.length} varints from {@code data}: at most 5 bytes
     * and at most 2³¹−1 each, no bytes left over; otherwise {@code bad_schematic}.
     */
    static void decodeVarints(byte[] data, int[] out) throws ShareException {
        int p = 0;
        int n = data.length;
        for (int i = 0; i < out.length; i++) {
            if (p >= n) {
                throw ShareException.badSchematic("Data 太短（应该有 " + out.length + " 格，只有 " + i + " 格）",
                    "Data has " + i + " varints, needs " + out.length);
            }
            int b = data[p++];
            if (b >= 0) {
                out[i] = b;
                continue;
            }
            int value = b & 0x7F;
            int shift = 7;
            while (true) {
                if (p >= n) {
                    throw ShareException.badSchematic("Data 最后一个数没写完", "Data ends inside varint " + i);
                }
                b = data[p++];
                if (shift == 28) {
                    if ((b & 0xFF) > 0x07) {
                        throw ShareException.badSchematic("Data 里第 " + i + " 格的数太大",
                            "varint " + i + " longer than 5 bytes or above 2^31-1");
                    }
                    value |= b << 28;
                    break;
                }
                value |= (b & 0x7F) << shift;
                if (b >= 0) {
                    break;
                }
                shift += 7;
            }
            out[i] = value;
        }
        if (p != n) {
            throw ShareException.badSchematic("Data 比格子数多出 " + (n - p) + " 个字节",
                "Data has " + (n - p) + " bytes after " + out.length + " varints");
        }
    }
}
