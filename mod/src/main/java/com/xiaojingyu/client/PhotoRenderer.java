package com.xiaojingyu.client;

import java.util.ArrayList;
import java.util.List;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import com.xiaojingyu.furniture.FurnitureBlock;
import com.xiaojingyu.furniture.FurnitureShapes;
import com.xiaojingyu.photo.Photo;
import com.xiaojingyu.photo.PhotoDisplayBlockEntity;
import com.xiaojingyu.photo.PhotoSlots;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;

/**
 * Draws the photos of the photo frame and the picture frames (docs/PHOTOS.md §3, §4), the 26.1 way: extract
 * what to draw into a render state, then submit it (NEOFORGE-26.1-API.md §15).
 *
 * <p>Each photo is a flat quad on the rectangle of its photoSlots row, in the north-facing model's pixels; the
 * whole piece turns with {@code facing} around the main cell's centre, like the model. The rules both sides
 * follow (PHOTOS.md §3): the quad sits 0.01 pixel in front of the face at {@code z} (towards −z), the photo is
 * upright (seen from the front its left edge is at x1, its right edge at x0, its top at y1), and a rectangle that
 * is not square shows the middle of the photo (cover, not stretched). Drawn like a map in an item frame (the
 * {@code text} render type: lit by block light, no shading), with a polygon offset as well so it never flickers
 * against the model behind it, even far away.
 */
final class PhotoRenderer implements BlockEntityRenderer<PhotoDisplayBlockEntity, PhotoRenderer.State> {
    /** How far in front of the model face the photo is (pixels, PHOTOS.md §3 rule 1). */
    static final float FRONT = 0.01F;

    /** One photo quad: model pixels relative to the main cell (cell offset included) and its texture part. */
    record Quad(Identifier texture, float x0, float y0, float x1, float y1, float z, float u0, float v0, float u1, float v1) {
    }

    static final class State extends BlockEntityRenderState {
        int quarterTurns;
        final List<Quad> quads = new ArrayList<>();
    }

    PhotoRenderer(BlockEntityRendererProvider.Context context) {
    }

    @Override
    public State createRenderState() {
        return new State();
    }

    @Override
    public void extractRenderState(PhotoDisplayBlockEntity be, State state, float partialTicks, Vec3 cameraPosition,
                                   ModelFeatureRenderer.@Nullable CrumblingOverlay breakProgress) {
        BlockEntityRenderer.super.extractRenderState(be, state, partialTicks, cameraPosition, breakProgress);
        state.quads.clear();
        BlockState blockState = be.getBlockState();
        if (!(blockState.getBlock() instanceof FurnitureBlock block) || !blockState.hasProperty(HorizontalDirectionalBlock.FACING)) {
            return;
        }
        String id = block.spec().id();
        state.quarterTurns = FurnitureShapes.quarterTurns(blockState.getValue(HorizontalDirectionalBlock.FACING).getSerializedName());
        double[][] rows = PhotoSlots.of(id);
        for (int i = 0; i < Math.min(rows.length, be.slotCount()); i++) {
            Photo photo = be.photo(i);
            if (photo == null) {
                continue;
            }
            Identifier texture = PhotoTextures.get(photo);
            if (texture == null) {
                continue;
            }
            double[] r = rows[i];
            int[] cell = PhotoSlots.cell(id, (int) r[0]);
            double x0 = Math.min(r[1], r[3]);
            double x1 = Math.max(r[1], r[3]);
            double y0 = Math.min(r[2], r[4]);
            double y1 = Math.max(r[2], r[4]);
            double[] uv = PhotoSlots.cover(x1 - x0, y1 - y0);
            state.quads.add(new Quad(texture,
                (float) (cell[0] * 16 + x0), (float) (cell[1] * 16 + y0),
                (float) (cell[0] * 16 + x1), (float) (cell[1] * 16 + y1),
                (float) (cell[2] * 16 + r[5]) - FRONT,
                (float) uv[0], (float) uv[1], (float) uv[2], (float) uv[3]));
        }
    }

    @Override
    public void submit(State state, PoseStack poseStack, SubmitNodeCollector collector, CameraRenderState camera) {
        if (state.quads.isEmpty()) {
            return;
        }
        int light = state.lightCoords;
        poseStack.pushPose();
        // Turn like the model: clockwise seen from above (blockstate y 90 for east) around the main cell's centre.
        poseStack.translate(0.5F, 0.0F, 0.5F);
        poseStack.mulPose(Axis.YP.rotationDegrees(-90.0F * state.quarterTurns));
        poseStack.translate(-0.5F, 0.0F, -0.5F);
        poseStack.scale(1.0F / 16, 1.0F / 16, 1.0F / 16);
        for (Quad q : state.quads) {
            // Counter-clockwise as seen from the front (from −z): bottom-left (x1), bottom-right (x0), top-right, top-left.
            collector.submitCustomGeometry(poseStack, RenderTypes.textPolygonOffset(q.texture()), (pose, buffer) -> {
                buffer.addVertex(pose, q.x1(), q.y0(), q.z()).setColor(-1).setUv(q.u0(), q.v1()).setLight(light);
                buffer.addVertex(pose, q.x0(), q.y0(), q.z()).setColor(-1).setUv(q.u1(), q.v1()).setLight(light);
                buffer.addVertex(pose, q.x0(), q.y1(), q.z()).setColor(-1).setUv(q.u1(), q.v0()).setLight(light);
                buffer.addVertex(pose, q.x1(), q.y1(), q.z()).setColor(-1).setUv(q.u0(), q.v0()).setLight(light);
            });
        }
        poseStack.popPose();
    }

    /** The picture frames reach into a second cell (and slots may reach past it), so take the cells around too. */
    @Override
    public AABB getRenderBoundingBox(PhotoDisplayBlockEntity be) {
        return new AABB(be.getBlockPos()).inflate(1.0);
    }
}
