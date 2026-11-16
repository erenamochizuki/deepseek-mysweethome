package com.xiaojingyu.photo;

import java.util.List;

import org.jspecify.annotations.Nullable;

/**
 * Which album photo a frame shows after a right click (docs/PHOTOS.md §4). The frame's photo is looked up
 * in the album by Id (the first match):
 * <ul>
 *   <li>next (plain right click): found → the one after it; the one after the last is empty; not found or the
 *       frame is empty → the first;</li>
 *   <li>previous (sneaking): found → the one before it; the one before the first is empty; not found or the
 *       frame is empty → the last (lead agreed 2026-11-07).</li>
 * </ul>
 * So a frame goes empty → 1 → 2 → … → last → empty → 1 … and sneaking walks the same circle backwards.
 */
public final class AlbumPaging {
    /** "Show nothing": the frame becomes empty. */
    public static final int EMPTY = -1;

    private AlbumPaging() {
    }

    /**
     * The album index to show next, or {@link #EMPTY}.
     *
     * @param albumIds  the Ids of the album's usable photos, in album order; must not be empty
     * @param currentId the Id of the frame's photo, null if the frame is empty
     * @param back      true for previous (sneaking), false for next
     */
    public static int step(List<String> albumIds, @Nullable String currentId, boolean back) {
        int n = albumIds.size();
        if (n == 0) {
            throw new IllegalArgumentException("empty album");
        }
        int at = currentId == null ? -1 : albumIds.indexOf(currentId);
        if (at < 0) {
            return back ? n - 1 : 0;
        }
        if (back) {
            return at == 0 ? EMPTY : at - 1;
        }
        return at == n - 1 ? EMPTY : at + 1;
    }
}
