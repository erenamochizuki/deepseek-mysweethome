package com.xiaojingyu.furniture;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import com.xiaojingyu.XiaojingyuMod;
import com.xiaojingyu.photo.PhotoBlockEntities;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.block.state.properties.NoteBlockInstrument;
import net.minecraft.world.level.material.MapColor;
import net.minecraft.world.level.material.PushReaction;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * The furniture blocks (docs/FURNITURE.md, P5): blocks, their items and the creative tab
 * 「小鲸鱼之家」. Registration as in NeoForge 26.1 (docs/NEOFORGE-26.1-API.md §11): the
 * DeferredRegister helpers set the registry id on the Properties before the constructor runs.
 */
public final class ModFurniture {
    private static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(XiaojingyuMod.MOD_ID);
    private static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(XiaojingyuMod.MOD_ID);
    private static final DeferredRegister<CreativeModeTab> TABS = DeferredRegister.create(Registries.CREATIVE_MODE_TAB, XiaojingyuMod.MOD_ID);

    public static final DeferredBlock<LittleBedBlock> BED = BLOCKS.registerBlock("bed", LittleBedBlock::new, p -> wood(p).pushReaction(PushReaction.DESTROY));
    public static final DeferredBlock<DiningTableBlock> DINING_TABLE = BLOCKS.registerBlock("dining_table", DiningTableBlock::new, ModFurniture::wood);
    public static final DeferredBlock<ShellCaseBlock> SHELL_CASE = BLOCKS.registerBlock("shell_case", ShellCaseBlock::new, p -> wood(p).pushReaction(PushReaction.DESTROY));

    public static final DeferredItem<TwoCellBlockItem> BED_ITEM = blockItem("bed", p -> new TwoCellBlockItem(BED.get(), p));
    public static final DeferredItem<BlockItem> DINING_TABLE_ITEM = blockItem("dining_table", p -> new BlockItem(DINING_TABLE.get(), p));
    public static final DeferredItem<TwoCellBlockItem> SHELL_CASE_ITEM = blockItem("shell_case", p -> new TwoCellBlockItem(SHELL_CASE.get(), p));

    /**
     * Rounds 2 and 3 (FURNITURE.md §8.2, §9.1): one FurnitureBlock per FurnitureSpec (FurnitureShapes.KINDS), by id,
     * in creative-tab order. The name stays ROUND2_* from round 2.
     */
    public static final Map<String, DeferredBlock<FurnitureBlock>> ROUND2_BLOCKS;
    public static final Map<String, DeferredItem<BlockItem>> ROUND2_ITEMS;

    static {
        Map<String, DeferredBlock<FurnitureBlock>> blocks = new LinkedHashMap<>();
        Map<String, DeferredItem<BlockItem>> items = new LinkedHashMap<>();
        for (FurnitureSpec spec : FurnitureSpecs.all()) {
            // The album table, the photo frame and the picture frames carry photos (docs/PHOTOS.md): same block plus a block entity.
            DeferredBlock<FurnitureBlock> block = BLOCKS.registerBlock(spec.id(),
                    p -> PhotoBlockEntities.isPhotoBlock(spec.id()) ? new PhotoFurnitureBlock(spec, p) : new FurnitureBlock(spec, p),
                    p -> furnitureProperties(p, spec));
            blocks.put(spec.id(), block);
            items.put(spec.id(), blockItem(spec.id(),
                    p -> spec.count() > 1 ? new FurnitureBlockItem(block.get(), p) : new BlockItem(block.get(), p)));
        }
        ROUND2_BLOCKS = Collections.unmodifiableMap(blocks);
        ROUND2_ITEMS = Collections.unmodifiableMap(items);
    }

    /** Creative tab 「小鲸鱼之家」 / Xiao Jing Yu's Home (lang key itemGroup.xiaojingyu.home): round 1, then rounds 2 and 3. */
    public static final DeferredHolder<CreativeModeTab, CreativeModeTab> TAB = TABS.register("home", () -> CreativeModeTab.builder()
            .title(Component.translatable("itemGroup.xiaojingyu.home"))
            .icon(() -> BED_ITEM.get().getDefaultInstance())
            .displayItems((parameters, output) -> {
                output.accept(BED_ITEM.get());
                output.accept(DINING_TABLE_ITEM.get());
                output.accept(SHELL_CASE_ITEM.get());
                ROUND2_ITEMS.values().forEach(item -> output.accept(item.get()));
            })
            .build());

    private ModFurniture() {
    }

    /** Called from the mod constructor with the mod event bus. */
    public static void register(IEventBus modEventBus) {
        BLOCKS.register(modEventBus);
        ITEMS.register(modEventBus);
        TABS.register(modEventBus);
        PhotoBlockEntities.register(modEventBus);
        WindChimes.register();
    }

    /**
     * Wood like oak planks (Blocks.OAK_PLANKS): colour on maps, note block bass, hardness 2 / blast
     * resistance 3, wood sounds, burns from lava. Plus: does not hide the faces of the blocks around it
     * and lets light through (noOcclusion). Axe mining comes from the tag minecraft:mineable/axe
     * (data/minecraft/tags/block/mineable/axe.json).
     */
    private static BlockBehaviour.Properties wood(BlockBehaviour.Properties p) {
        return p.mapColor(MapColor.WOOD)
                .instrument(NoteBlockInstrument.BASS)
                .strength(2.0F, 3.0F)
                .sound(SoundType.WOOD)
                .ignitedByLava()
                .noOcclusion();
    }

    /**
     * Soft furnishings sound like wool when placed, walked on or broken (the user asked for it on
     * 2026-11-07); everything else keeps the wood sound. Hardness and tools stay like wood.
     * Round 3 adds the step mat and the towel (FURNITURE.md §9, chosen by mod3 like the door mat).
     */
    private static final Set<String> SOFT = Set.of(
            "living_rug", "door_mat", "floor_cushions", "window_seat", "beanbag", "sofa",
            "step_mat", "towel_hook");

    /**
     * Round 3 (FURNITURE.md §9, chosen by mod3): the terracotta pots sound like a decorated pot and are
     * quick to break with a pickaxe (data/minecraft/tags/block/mineable/pickaxe.json), they do not catch
     * fire from lava, map colour terracotta.
     */
    private static final Set<String> POTTERY = Set.of("potted_fern", "flower_pot", "succulents");

    /** Round 3: the wall lanterns sound like the vanilla lantern, pickaxe, map colour metal, no fire from lava. */
    private static final Set<String> LANTERN = Set.of("wall_lantern");

    /** Round 3: the shell wind chime sounds like an amethyst cluster when placed or broken (it rings by itself, WindChimes). */
    private static final Set<String> CHIME = Set.of(WindChimes.ID);

    /**
     * Pieces made from FurnitureSpec (rounds 2 and 3): wood like round 1, soft ones sound like wool (SOFT),
     * pots and lanterns are not wood (POTTERY, LANTERN), the chime sounds like amethyst (CHIME); hardness
     * stays 2 / 3 like planks for all and no tool is needed for the drop. More than one cell breaks when
     * pushed by a piston (like the bed); block light from the spec, per part.
     */
    private static BlockBehaviour.Properties furnitureProperties(BlockBehaviour.Properties p, FurnitureSpec spec) {
        String id = spec.id();
        if (POTTERY.contains(id)) {
            p.mapColor(MapColor.TERRACOTTA_ORANGE).instrument(NoteBlockInstrument.BASEDRUM).strength(2.0F, 3.0F)
                    .sound(SoundType.DECORATED_POT).noOcclusion();
        } else if (LANTERN.contains(id)) {
            p.mapColor(MapColor.METAL).strength(2.0F, 3.0F).sound(SoundType.LANTERN).noOcclusion();
        } else {
            wood(p);
            if (SOFT.contains(id)) {
                p.sound(SoundType.WOOL);
            } else if (CHIME.contains(id)) {
                p.sound(SoundType.AMETHYST_CLUSTER);
            }
        }
        if (spec.count() > 1) {
            p.pushReaction(PushReaction.DESTROY);
        }
        boolean lit = false;
        for (FurnitureSpec.Cell cell : spec.cells()) {
            lit |= cell.light() > 0;
        }
        if (lit) {
            p.lightLevel(FurnitureBlock.lightFunction(spec));
        }
        return p;
    }

    /** A block item: setId is done by registerItem, the name comes from the block (block.xiaojingyu.*). */
    private static <I extends BlockItem> DeferredItem<I> blockItem(String name, Function<Item.Properties, I> factory) {
        return ITEMS.registerItem(name, factory, p -> p.useBlockDescriptionPrefix());
    }
}
