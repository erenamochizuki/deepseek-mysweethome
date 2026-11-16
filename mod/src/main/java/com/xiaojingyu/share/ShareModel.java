package com.xiaojingyu.share;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.IntArrayTag;
import net.minecraft.nbt.IntTag;
import net.minecraft.nbt.LongTag;
import net.minecraft.nbt.StringTag;

/**
 * One building in memory: a W×H×L box of block states plus block entities, i.e. the content of
 * a share file (docs/FORMAT.md §3–4). Pure data, knows nothing about worlds; turning a world
 * region into a model and back is the caller's job.
 *
 * <p>Cell (x, y, z) has index {@code x + z*W + y*W*L}. Every cell holds a palette id; a new model
 * is all {@code minecraft:air}. Block states are kept as plain strings, exactly as given.
 *
 * <p>Not thread-safe. Models read from files are canonical (palette in first-appearance order,
 * nothing unused); models built in code need not be, the writer canonicalizes.
 */
public final class ShareModel {
    /** Longest allowed side, in cells. */
    public static final int MAX_SIDE = 1024;
    /** Most cells allowed in one model (W×H×L). */
    public static final int MAX_CELLS = 4_194_304;
    /** Most different block states in one file. */
    public static final int MAX_PALETTE = 65_536;
    /** Data version of this game (MC 26.1.2 = 4790); new models start with it. */
    public static final int CURRENT_DATA_VERSION = SharedConstants.WORLD_VERSION;
    /** Version of docs/FORMAT.md that this code writes (Metadata.Xiaojingyu.FormatVersion). */
    public static final int FORMAT_VERSION = 1;
    public static final String AIR = "minecraft:air";

    /** Warning codes (FORMAT.md §5): the file was read, but something was dropped or is newer. */
    public static final String WARN_DATA_VERSION = "data_version";
    public static final String WARN_IGNORED_BIOMES = "ignored_biomes";
    public static final String WARN_IGNORED_ENTITIES = "ignored_entities";
    public static final String WARN_NEWER_FORMAT = "newer_format";
    public static final String WARN_UNUSED_PALETTE = "unused_palette";

    private final int width;
    private final int height;
    private final int length;
    private final int[] cells;
    private final List<String> palette = new ArrayList<>();
    private final Map<String, Integer> paletteIndex = new HashMap<>();
    private final TreeMap<Integer, BlockEntityEntry> blockEntities = new TreeMap<>();
    private final List<String> warnings = new ArrayList<>();
    private int[] offset = {0, 0, 0};
    private int dataVersion = CURRENT_DATA_VERSION;
    private CompoundTag meta;

    /**
     * An all-air model. Sizes must be 1..{@value #MAX_SIDE} with at most {@value #MAX_CELLS} cells
     * (use {@link #checkSize} first to get a player-facing error).
     *
     * @throws IllegalArgumentException if the size is not allowed
     */
    public ShareModel(int width, int height, int length) {
        if (!sizeAllowed(width, height, length)) {
            throw new IllegalArgumentException("size " + width + "x" + height + "x" + length + " not allowed");
        }
        this.width = width;
        this.height = height;
        this.length = length;
        this.cells = new int[width * height * length];
        palette.add(AIR);
        paletteIndex.put(AIR, 0);
    }

    public static boolean sizeAllowed(int width, int height, int length) {
        return width >= 1 && height >= 1 && length >= 1
            && width <= MAX_SIDE && height <= MAX_SIDE && length <= MAX_SIDE
            && (long) width * height * length <= MAX_CELLS;
    }

    /** Throws {@code too_large} (or {@code bad_schematic} for sizes below 1) if a model of this size is not allowed. */
    public static void checkSize(int width, int height, int length) throws ShareException {
        if (width < 1 || height < 1 || length < 1) {
            throw ShareException.badSchematic("每边至少要有 1 格", "size " + width + "x" + height + "x" + length + " below 1");
        }
        if (!sizeAllowed(width, height, length)) {
            throw ShareException.of(ShareException.TOO_LARGE, "size " + width + "x" + height + "x" + length);
        }
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }

    public int length() {
        return length;
    }

    /** Number of cells, W×H×L. */
    public int volume() {
        return cells.length;
    }

    public boolean contains(int x, int y, int z) {
        return x >= 0 && y >= 0 && z >= 0 && x < width && y < height && z < length;
    }

    /** Cell index {@code x + z*W + y*W*L}. */
    public int index(int x, int y, int z) {
        if (!contains(x, y, z)) {
            throw new IndexOutOfBoundsException("cell (" + x + ", " + y + ", " + z + ") outside "
                + width + "x" + height + "x" + length);
        }
        return x + z * width + y * width * length;
    }

    /** Where cell (0,0,0) is, relative to the standing block (FORMAT.md §3.2). A copy. */
    public int[] offset() {
        return offset.clone();
    }

    public void setOffset(int x, int y, int z) {
        offset = new int[] {x, y, z};
    }

    public int dataVersion() {
        return dataVersion;
    }

    public void setDataVersion(int dataVersion) {
        this.dataVersion = dataVersion;
    }

    /** The Metadata compound, or null when there is none. The live object, not a copy. */
    public CompoundTag meta() {
        return meta;
    }

    /** Metadata to write as is (only RequiredMods is recomputed on write); null writes none. Not copied. */
    public void setMeta(CompoundTag meta) {
        this.meta = meta;
    }

    /** Palette ids → block states. Read-only view. */
    public List<String> palette() {
        return Collections.unmodifiableList(palette);
    }

    /** Palette id of a block state, adding it to the palette if it is new. */
    public int paletteId(String state) {
        Objects.requireNonNull(state, "state");
        Integer id = paletteIndex.get(state);
        if (id != null) {
            return id;
        }
        int added = palette.size();
        palette.add(state);
        paletteIndex.put(state, added);
        return added;
    }

    public String get(int x, int y, int z) {
        return palette.get(cells[index(x, y, z)]);
    }

    public void set(int x, int y, int z, String state) {
        cells[index(x, y, z)] = paletteId(state);
    }

    /**
     * The cells (palette ids by cell index), live, for fast loops. Ids written here must exist in
     * {@link #palette()}; the writer checks.
     */
    public int[] cells() {
        return cells;
    }

    /** Block entities, sorted by cell index. Read-only view. */
    public Collection<BlockEntityEntry> blockEntities() {
        return Collections.unmodifiableCollection(blockEntities.values());
    }

    /** The block entity in this cell, or null. */
    public BlockEntityEntry blockEntity(int x, int y, int z) {
        return blockEntities.get(index(x, y, z));
    }

    /**
     * Puts (or replaces) the block entity of a cell.
     *
     * @param data the block entity's NBT without id, x, y, z (see {@link #blockEntityData}); null
     *     for none. Kept as is, not copied.
     */
    public void putBlockEntity(int x, int y, int z, String id, CompoundTag data) {
        blockEntities.put(index(x, y, z), new BlockEntityEntry(x, y, z, id, data));
    }

    public void removeBlockEntity(int x, int y, int z) {
        blockEntities.remove(index(x, y, z));
    }

    /** Warning codes found when this model was read (sorted, no duplicates); empty for models built in code. */
    public List<String> warnings() {
        return Collections.unmodifiableList(warnings);
    }

    void addWarning(String code) {
        if (!warnings.contains(code)) {
            warnings.add(code);
            Collections.sort(warnings);
        }
    }

    /** Replaces the palette (for readers that fill {@link #cells()} themselves). */
    void setPalette(List<String> states) {
        palette.clear();
        paletteIndex.clear();
        for (String state : states) {
            Objects.requireNonNull(state, "state");
            if (paletteIndex.putIfAbsent(state, palette.size()) != null) {
                throw new IllegalArgumentException("duplicate palette state " + state);
            }
            palette.add(state);
        }
    }

    /** Index of the first cell whose palette id does not exist, or -1. */
    int firstBadCell() {
        int n = palette.size();
        for (int i = 0; i < cells.length; i++) {
            if (cells[i] < 0 || cells[i] >= n) {
                return i;
            }
        }
        return -1;
    }

    /**
     * The palette in canonical order (FORMAT.md §4: first appearance by cell index, unused states
     * dropped) and the cells renumbered to it. Call only when {@link #firstBadCell()} is -1.
     * Returns the live cells array when nothing changes.
     */
    Canonical canonical() {
        int[] remap = new int[palette.size()];
        java.util.Arrays.fill(remap, -1);
        List<String> order = new ArrayList<>();
        boolean identity = true;
        int last = -1;
        for (int id : cells) {
            if (id == last) {
                continue;
            }
            last = id;
            if (remap[id] < 0) {
                remap[id] = order.size();
                order.add(palette.get(id));
                identity &= remap[id] == id;
            }
        }
        boolean droppedUnused = order.size() < palette.size();
        if (identity && !droppedUnused) {
            return new Canonical(order, cells, false);
        }
        int[] renumbered = new int[cells.length];
        for (int i = 0; i < cells.length; i++) {
            renumbered[i] = remap[cells[i]];
        }
        return new Canonical(order, renumbered, droppedUnused);
    }

    record Canonical(List<String> palette, int[] cells, boolean droppedUnused) {
    }

    /**
     * A block entity in a cell. {@code data} is its NBT without id, x, y, z, or null.
     */
    public record BlockEntityEntry(int x, int y, int z, String id, CompoundTag data) {
        public BlockEntityEntry {
            Objects.requireNonNull(id, "id");
        }

        /** Full block entity NBT for loading into a world: a copy of data plus id and the world position. */
        public CompoundTag fullNbt(int worldX, int worldY, int worldZ) {
            CompoundTag full = data == null ? new CompoundTag() : data.copy();
            full.putString("id", id);
            full.putInt("x", worldX);
            full.putInt("y", worldY);
            full.putInt("z", worldZ);
            return full;
        }
    }

    /** What goes into a model from a block entity's full NBT: a copy without id, x, y, z (FORMAT.md §3.3). */
    public static CompoundTag blockEntityData(CompoundTag fullNbt) {
        CompoundTag data = fullNbt.copy();
        data.remove("id");
        data.remove("x");
        data.remove("y");
        data.remove("z");
        return data;
    }

    /**
     * A Metadata compound as the mod writes it on capture (FORMAT.md §3.1). The codec never fills
     * these in by itself.
     *
     * @param dateMillis milliseconds since 1970-01-01 UTC
     * @param facing north / south / east / west
     * @param source e.g. "xiaojingyu-mod/0.1.0"
     * @param gameVersion e.g. "26.1.2"; pass it in, do not read SharedConstants here
     */
    public static CompoundTag newMeta(String name, String author, long dateMillis, String facing,
                                      int originX, int originY, int originZ, String dimension,
                                      String source, String gameVersion) {
        if (!List.of("north", "south", "east", "west").contains(facing)) {
            throw new IllegalArgumentException("facing must be north/south/east/west: " + facing);
        }
        CompoundTag xjy = new CompoundTag();
        xjy.put("FormatVersion", IntTag.valueOf(FORMAT_VERSION));
        xjy.put("Facing", StringTag.valueOf(facing));
        xjy.put("Origin", new IntArrayTag(new int[] {originX, originY, originZ}));
        xjy.put("Dimension", StringTag.valueOf(Objects.requireNonNull(dimension, "dimension")));
        xjy.put("Source", StringTag.valueOf(Objects.requireNonNull(source, "source")));
        xjy.put("GameVersion", StringTag.valueOf(Objects.requireNonNull(gameVersion, "gameVersion")));
        CompoundTag meta = new CompoundTag();
        meta.put("Name", StringTag.valueOf(Objects.requireNonNull(name, "name")));
        meta.put("Author", StringTag.valueOf(Objects.requireNonNull(author, "author")));
        meta.put("Date", LongTag.valueOf(dateMillis));
        meta.put("Xiaojingyu", xjy);
        return meta;
    }

    /** Default building name, {@code capture-yyyyMMdd-HHmmss} (FORMAT.md §3.1). */
    public static String defaultName(LocalDateTime time) {
        return "capture-" + time.format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
    }
}
