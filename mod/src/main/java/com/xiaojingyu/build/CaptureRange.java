package com.xiaojingyu.build;

/**
 * How far {@code /xjy capture} reaches from the standing point S (COMMANDS.md §2): {@code front} columns ahead
 * starting with the one in front, {@code back} columns behind starting with S's own column, {@code side} on each
 * side, {@code up} layers starting with the floor under the feet. Pure data, no world access.
 *
 * <p>The numbers the plain {@code /xjy capture} uses come from the mod config ({@code CaptureConfig}); the limits
 * here are the same for the config, the command arguments and the sliders.
 */
public record CaptureRange(int front, int back, int side, int up) {
    /** Most columns / layers in any one direction. */
    public static final int MAX = 64;
    public static final int MIN_FRONT = 1;
    public static final int MIN_BACK = 0;
    public static final int MIN_SIDE = 0;
    public static final int MIN_UP = 1;
    /** What the plain {@code /xjy capture} used before the config existed; still the config's defaults. */
    public static final CaptureRange DEFAULT = new CaptureRange(16, 0, 8, 12);
    /** The biggest box a capture can be: (2·64+1) wide × 64 high × (64+64) long = 1,056,768 cells. */
    public static final int MAX_VOLUME = (2 * MAX + 1) * MAX * (MAX + MAX);

    /** Every number inside its limits. */
    public boolean valid() {
        return front >= MIN_FRONT && front <= MAX && back >= MIN_BACK && back <= MAX
            && side >= MIN_SIDE && side <= MAX && up >= MIN_UP && up <= MAX;
    }

    /** The same range with another back (the command with three numbers keeps the config's back). */
    public CaptureRange withBack(int newBack) {
        return new CaptureRange(front, newBack, side, up);
    }

    /** Columns along the facing: front + back. */
    public int length() {
        return front + back;
    }

    /** Cells in the box: (2·side+1) × up × (front+back). */
    public int volume() {
        return (2 * side + 1) * up * length();
    }

    /** The box for a player standing at (sx, sy, sz) facing this way (0 north … 3 west); see {@link Frame#captureBox}. */
    public int[] box(int sx, int sy, int sz, int facing) {
        return Frame.captureBox(sx, sy, sz, facing, front, back, side, up);
    }

    /** "front back side up", the four numbers of {@code /xjy capture 范围} in the same order. */
    public String numbers() {
        return front + " " + back + " " + side + " " + up;
    }
}
