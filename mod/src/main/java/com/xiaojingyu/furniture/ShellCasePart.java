package com.xiaojingyu.furniture;

import net.minecraft.util.StringRepresentable;

/**
 * The two cells of the shell case (docs/FURNITURE.md §2): left / right as seen by someone standing
 * in front of it and looking at it. right = left + facing turned 90° counter-clockwise.
 */
public enum ShellCasePart implements StringRepresentable {
    LEFT("left"),
    RIGHT("right");

    private final String name;

    ShellCasePart(String name) {
        this.name = name;
    }

    public ShellCasePart other() {
        return this == LEFT ? RIGHT : LEFT;
    }

    @Override
    public String getSerializedName() {
        return name;
    }

    @Override
    public String toString() {
        return name;
    }
}
