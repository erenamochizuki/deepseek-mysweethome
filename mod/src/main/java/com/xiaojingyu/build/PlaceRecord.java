package com.xiaojingyu.build;

import java.util.Arrays;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.IntStream;

import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.codecs.RecordCodecBuilder;

/**
 * What one finished {@code /xjy place} put where (COMMANDS.md §2b), kept so that {@code /xjy capture 上次} can read
 * the same box back in the file's own orientation. Pure data and math, no world access (cmdTest checks it).
 *
 * <p>Cell (x, y, z) of the file went to {@code standing + rot_turns(offset + (x, y, z))}, the same as
 * {@code PlaceCommand} and {@link BuildPlan}: base = standing + rot_turns(offset), then base + rot_turns(x, y, z).
 *
 * @param id           number given when the record is stored ({@link LastPlaces#add}); 0 before that
 * @param file         the file name as found in the buildings folder, e.g. {@code house-v4-b.png}
 * @param dimension    e.g. {@code minecraft:overworld}
 * @param standing     the placer's standing point S' {x, y, z}
 * @param playerFacing the placer's facing 0..3 (north, east, south, west)
 * @param turns        clockwise quarter turns used, 0..3
 * @param mode         what the command asked for: {@code auto}, {@code 0}, {@code 90}, {@code 180} or {@code 270}
 * @param offset       the file's Offset {x, y, z}
 * @param size         the file's Width, Height, Length
 * @param fileFacing   the file's Metadata.Xiaojingyu.Facing 0..3, or −1 when it had none
 * @param time         when the place command ran, milliseconds since 1970-01-01 UTC (kept only once it finished)
 */
public record PlaceRecord(int id, String file, String dimension, int[] standing, int playerFacing, int turns, String mode,
                          int[] offset, int[] size, int fileFacing, long time) {
    public static final String AUTO = "auto";

    private static final Codec<int[]> INT3 = intArray(3);
    private static final Codec<Integer> FACING = Codec.STRING.comapFlatMap(s -> {
        int f = Frame.facingIndex(s);
        return f < 0 ? DataResult.error(() -> "not a facing: " + s) : DataResult.success(f);
    }, Frame::name);
    private static final Codec<Integer> DEGREES = Codec.INT.comapFlatMap(d -> {
        int k = Frame.turnsFromDegrees(d);
        return k < 0 ? DataResult.error(() -> "turn must be 0, 90, 180 or 270: " + d) : DataResult.success(k);
    }, k -> k * 90);

    /**
     * NBT: {@code {id, file, dimension, standing: [I;x,y,z], player_facing, turn: degrees, mode, offset: [I;…],
     * size: [I;w,h,l], file_facing (left out when the file had none), time, box: [I;minX,minY,minZ,maxX,maxY,maxZ]}}.
     * {@code box} is only there for people reading the file; it is worked out again from the rest when read.
     */
    public static final Codec<PlaceRecord> CODEC = RecordCodecBuilder.<PlaceRecord>create(i -> i.group(
            Codec.INT.fieldOf("id").forGetter(PlaceRecord::id),
            Codec.STRING.fieldOf("file").forGetter(PlaceRecord::file),
            Codec.STRING.fieldOf("dimension").forGetter(PlaceRecord::dimension),
            INT3.fieldOf("standing").forGetter(PlaceRecord::standing),
            FACING.fieldOf("player_facing").forGetter(PlaceRecord::playerFacing),
            DEGREES.fieldOf("turn").forGetter(PlaceRecord::turns),
            Codec.STRING.optionalFieldOf("mode", AUTO).forGetter((PlaceRecord r) -> r.mode),
            INT3.fieldOf("offset").forGetter(PlaceRecord::offset),
            INT3.fieldOf("size").forGetter(PlaceRecord::size),
            FACING.optionalFieldOf("file_facing").forGetter((PlaceRecord r) -> r.fileFacing < 0 ? Optional.empty() : Optional.of(r.fileFacing)),
            Codec.LONG.optionalFieldOf("time", 0L).forGetter(PlaceRecord::time),
            intArray(6).optionalFieldOf("box").forGetter((PlaceRecord r) -> Optional.of(r.box())))
        .apply(i, (id, file, dim, standing, pf, turns, mode, offset, size, ff, time, box) ->
            new PlaceRecord(id, file, dim, standing, pf, turns, mode, offset, size, ff.orElse(-1), time)))
        .validate(PlaceRecord::check);

    public PlaceRecord {
        Objects.requireNonNull(file, "file");
        Objects.requireNonNull(dimension, "dimension");
        Objects.requireNonNull(mode, "mode");
        standing = standing.clone();
        offset = offset.clone();
        size = size.clone();
    }

    /** The same record with another id. */
    public PlaceRecord withId(int newId) {
        return new PlaceRecord(newId, file, dimension, standing, playerFacing, turns, mode, offset, size, fileFacing, time);
    }

    /** {@code auto} for −1, else the degrees as text. */
    public static String mode(int degrees) {
        return degrees < 0 ? AUTO : Integer.toString(degrees);
    }

    /** Clockwise degrees the placement turned the file: 0, 90, 180 or 270. */
    public int degrees() {
        return turns * 90;
    }

    /** World position of the file's cell (0, 0, 0): standing + rot_turns(offset). */
    public int baseX() {
        return standing[0] + Frame.rotX(turns, offset[0], offset[2]);
    }

    public int baseY() {
        return standing[1] + offset[1];
    }

    public int baseZ() {
        return standing[2] + Frame.rotZ(turns, offset[0], offset[2]);
    }

    /** The world box the placement filled, {minX, minY, minZ, maxX, maxY, maxZ}, inclusive. */
    public int[] box() {
        return Frame.placeBox(standing[0], standing[1], standing[2], turns, offset[0], offset[1], offset[2],
            size[0], size[1], size[2]);
    }

    /** World {x, y, z} of the file's cell (x, y, z). */
    public int[] worldOf(int x, int y, int z) {
        return new int[] {baseX() + Frame.rotX(turns, x, z), baseY() + y, baseZ() + Frame.rotZ(turns, x, z)};
    }

    public int volume() {
        return size[0] * size[1] * size[2];
    }

    private DataResult<PlaceRecord> check() {
        if (turns < 0 || turns > 3 || playerFacing < 0 || playerFacing > 3 || fileFacing < -1 || fileFacing > 3) {
            return DataResult.error(() -> "bad turn or facing in " + this);
        }
        if (size[0] < 1 || size[1] < 1 || size[2] < 1) {
            return DataResult.error(() -> "bad size in " + this);
        }
        return DataResult.success(this);
    }

    private static Codec<int[]> intArray(int n) {
        return Codec.INT_STREAM.comapFlatMap(s -> {
            int[] a = s.toArray();
            return a.length == n ? DataResult.success(a) : DataResult.error(() -> "need " + n + " numbers: " + Arrays.toString(a));
        }, IntStream::of);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof PlaceRecord r && id == r.id && file.equals(r.file) && dimension.equals(r.dimension)
            && Arrays.equals(standing, r.standing) && playerFacing == r.playerFacing && turns == r.turns
            && mode.equals(r.mode) && Arrays.equals(offset, r.offset) && Arrays.equals(size, r.size)
            && fileFacing == r.fileFacing && time == r.time;
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, file, dimension, Arrays.hashCode(standing), playerFacing, turns, mode,
            Arrays.hashCode(offset), Arrays.hashCode(size), fileFacing, time);
    }

    @Override
    public String toString() {
        return "PlaceRecord[" + id + " " + file + " in " + dimension + " at " + Arrays.toString(standing)
            + " facing " + Frame.name(playerFacing) + ", turned " + degrees() + " (" + mode + "), offset "
            + Arrays.toString(offset) + ", size " + Arrays.toString(size) + ", file facing "
            + (fileFacing < 0 ? "none" : Frame.name(fileFacing)) + ", time " + time + "]";
    }
}
