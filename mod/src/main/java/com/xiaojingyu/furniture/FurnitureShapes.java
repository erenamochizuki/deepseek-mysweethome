// 生成的文件，不要手改：node web/tools/furn-mc.mjs export（源头是 models/furniture/<id>.bbmodel 和 web/src/44-furn-mc.js）。
// 小鲸鱼之家 Xiaojingyu's Home — CC BY-NC-SA 4.0, Moci
package com.xiaojingyu.furniture;

/**
 * 家具的格子、碰撞盒 / 选框、碰撞种类、方块光（接口说明：tmp/furn/shapes-api.md；约定：docs/FURNITURE.md 第 2、8 节）。
 * 盒子 {x0, y0, z0, x1, y1, z1}（和 Block.box 的参数顺序一样）：朝北（正面在 -z；床是床头在 -z），像素单位（一格 16），每格自己的方块内坐标 0..16。
 * box 的格：这一格里所有方块元素的外包盒；thin：贴地 1/16 格 {0, 0, 0, 16, 1, 16}；none：没有盒子。数组是只读的，别改里面的数。
 * 这个类不用任何 Minecraft 的类；按 facing 转用 rotateY。
 */
public final class FurnitureShapes {
    private FurnitureShapes() {}

    // ---- 第 1 轮：床、餐桌、贝壳柜（part 是名字）----
    /** 床（head）：xiaojingyu:bed[part=head] */
    public static final double[][] BED_HEAD = {{0.5, 0, 0.5, 16, 16, 16}};
    /** 床（foot）：xiaojingyu:bed[part=foot] */
    public static final double[][] BED_FOOT = {{0.5, 0, 0, 16, 10, 16}};
    /** 餐桌：xiaojingyu:dining_table */
    public static final double[][] DINING_TABLE = {{0.5, 0, 0.5, 16, 16, 16}};
    /** 贝壳收集柜（left）：xiaojingyu:shell_case[part=left] */
    public static final double[][] SHELL_CASE_LEFT = {{0, 0, 6.5, 16, 16, 16}};
    /** 贝壳收集柜（right）：xiaojingyu:shell_case[part=right] */
    public static final double[][] SHELL_CASE_RIGHT = {{0.5, 0, 6.5, 16, 16, 16}};

    /**
     * 碰撞盒。id = 方块路径（带不带 "xiaojingyu:" 都行）。第 1 轮的 3 件：part = "head" / "foot" / "left" / "right"，餐桌给 null 或 ""；
     * 第 2 轮的：part 给数字的字符串 "0"、"1" …，单格的给 null 或 ""。找不到返回 null。
     */
    public static double[][] boxes(String id, String part) {
        String path = id.startsWith("xiaojingyu:") ? id.substring(11) : id;
        String k = path + (part == null || part.isEmpty() ? "" : "/" + part);
        switch (k) {
            case "bed/head": return BED_HEAD;
            case "bed/foot": return BED_FOOT;
            case "dining_table": return DINING_TABLE;
            case "shell_case/left": return SHELL_CASE_LEFT;
            case "shell_case/right": return SHELL_CASE_RIGHT;
            default: break;
        }
        Kind kd = kind(path);
        if (kd == null) return null;
        if (part == null || part.isEmpty()) return kd.parts() == 1 ? kd.boxes[0] : null;
        try {
            int p = Integer.parseInt(part);
            return p >= 0 && p < kd.parts() ? kd.boxes[p] : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ---- 第 2、3 轮：通用的多格家具（docs/FURNITURE.md 8.1、9.1）----
    /**
     * 一种家具。朝北时本地格子 cx = 0..w-1（往 +x）、cz = 0..d-1（往 +z，往后）、cy = 0..h-1（往上），
     * part = cx + w * (cz + d * cy)，主格 part 0；只有 1 格的方块没有 part 属性（状态只有 facing）。
     * 第 3 轮的遮阳伞、吊篮：模型伸出自己那格（只是画出来），碰撞盒、选框照样只在这一格的 0..16 里。
     */
    public static final class Kind {
        /** 方块路径，比如 "kitchen_counter"（方块 id 是 xiaojingyu:kitchen_counter） */
        public final String id;
        /** 占几格：宽（朝北时沿 +x）、深（沿 +z）、高 */
        public final int w, d, h;
        /** 方块光 0..15（每格都一样；0 = 不亮） */
        public final int light;
        /** 每个 part 的碰撞："box" / "thin" / "none" */
        public final String[] collide;
        /** 每个 part 一组盒子（朝北、像素、这一格自己的 0..16）；none 的格是空数组 */
        public final double[][][] boxes;
        /** 每个 part 的选框盒子（点中、拆的时候用）：不管 collide 是什么，都是模型这一格的外包盒（none、thin 的格也有） */
        public final double[][][] outlines;
        /** true = 模型还没导出，box 的格先用整格占位（export 以后换成模型的外包盒） */
        public final boolean placeholder;

        Kind(String id, int w, int d, int h, int light, String[] collide, double[][][] boxes, double[][][] outlines, boolean placeholder) {
            this.id = id;
            this.w = w;
            this.d = d;
            this.h = h;
            this.light = light;
            this.collide = collide;
            this.boxes = boxes;
            this.outlines = outlines;
            this.placeholder = placeholder;
        }

        /** 一共几格（= part 的个数）。1 = 单格，方块没有 part 属性 */
        public int parts() { return w * d * h; }

        /** 朝北的本地格子 → part */
        public int part(int cx, int cy, int cz) { return cx + w * (cz + d * cy); }

        /** part → 朝北的本地格子 {cx, cy, cz} */
        public int[] cell(int part) { return new int[] {part % w, part / (w * d), (part / w) % d}; }

        /**
         * part 这一格相对主格（part 0）的世界偏移 {dx, dy, dz}；quarterTurns：north 0、east 1、south 2、west 3。
         * 本地 (cx, cz) → north (cx, cz)、east (-cz, cx)、south (-cx, -cz)、west (cz, -cx)（模型跟着顺时针转）。
         */
        public int[] offset(int part, int quarterTurns) {
            int[] c = cell(part);
            int x = c[0], z = c[2];
            switch (((quarterTurns % 4) + 4) % 4) {
                case 1: return new int[] {-z, c[1], x};
                case 2: return new int[] {-x, c[1], -z};
                case 3: return new int[] {z, c[1], -x};
                default: return new int[] {x, c[1], z};
            }
        }

        /**
         * 照片画在哪（docs/PHOTOS.md 第 3 节）：每行 {part, x0, y0, x1, y1, z}，朝北的模型里、相对这一格（part）的像素，
         * x0..x1、y0..y1 是照片那块，z 是那个面（画的时候往 -z 挪 0.01）。行号 = 方块实体里 Slots 的编号。没有照片的家具是空数组。
         */
        public double[][] photoSlots() { return FurnitureShapes.photoSlots(id); }
    }

    /** 床头柜：xiaojingyu:nightstand，1 × 1 × 1 格 */
    public static final Kind NIGHTSTAND = new Kind("nightstand", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{3.5, 0, 8, 13, 13, 16}}},
        new double[][][] {{{3.5, 0, 8, 13, 13, 16}}}, false);
    /** 书架：xiaojingyu:bookshelf，1 × 1 × 2 格 */
    public static final Kind BOOKSHELF = new Kind("bookshelf", 1, 1, 2, 0,
        new String[] {"box", "box"},
        new double[][][] {{{0, 0, 9.5, 16, 16, 16}}, {{0, 0, 8.5, 16, 15, 16}}},
        new double[][][] {{{0, 0, 9.5, 16, 16, 16}}, {{0, 0, 8.5, 16, 15, 16}}}, false);
    /** 厨房台面：xiaojingyu:kitchen_counter，4 × 1 × 1 格 */
    public static final Kind KITCHEN_COUNTER = new Kind("kitchen_counter", 4, 1, 1, 0,
        new String[] {"box", "box", "box", "box"},
        new double[][][] {{{0.5, 0, 5.5, 16, 16, 16}}, {{0, 0, 5.5, 16, 16, 16}}, {{0, 0, 5.5, 16, 16, 16}}, {{0, 0, 5.5, 16, 16, 16}}},
        new double[][][] {{{0.5, 0, 5.5, 16, 16, 16}}, {{0, 0, 5.5, 16, 16, 16}}, {{0, 0, 5.5, 16, 16, 16}}, {{0, 0, 5.5, 16, 16, 16}}}, false);
    /** 调料罐架：xiaojingyu:spice_rack，1 × 1 × 1 格 */
    public static final Kind SPICE_RACK = new Kind("spice_rack", 1, 1, 1, 0,
        new String[] {"none"},
        new double[][][] {{}},
        new double[][][] {{{0.5, 5, 13, 16, 13, 15.5}}}, false);
    /** 小冰箱：xiaojingyu:mini_fridge，1 × 1 × 1 格 */
    public static final Kind MINI_FRIDGE = new Kind("mini_fridge", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{3, 0, 4.5, 13.5, 16, 16}}},
        new double[][][] {{{3, 0, 4.5, 13.5, 16, 16}}}, false);
    /** 餐椅：xiaojingyu:dining_chair，1 × 1 × 1 格 */
    public static final Kind DINING_CHAIR = new Kind("dining_chair", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{4, 0, 2, 12.5, 13, 9.5}}},
        new double[][][] {{{4, 0, 2, 12.5, 13, 9.5}}}, false);
    /** 书桌：xiaojingyu:desk，2 × 1 × 1 格，光 10 */
    public static final Kind DESK = new Kind("desk", 2, 1, 1, 10,
        new String[] {"box", "box"},
        new double[][][] {{{3, 0, 4.5, 16, 16, 15.5}}, {{0, 0, 4.5, 13.5, 16, 15.5}}},
        new double[][][] {{{3, 0, 4.5, 16, 16, 15.5}}, {{0, 0, 4.5, 13.5, 16, 15.5}}}, false);
    /** 书桌椅：xiaojingyu:desk_chair，1 × 1 × 1 格 */
    public static final Kind DESK_CHAIR = new Kind("desk_chair", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{4, 0, 0.5, 12.5, 13.5, 8.5}}},
        new double[][][] {{{4, 0, 0.5, 12.5, 13.5, 8.5}}}, false);
    /** 画框：xiaojingyu:picture_frames，2 × 1 × 1 格 */
    public static final Kind PICTURE_FRAMES = new Kind("picture_frames", 2, 1, 1, 0,
        new String[] {"none", "none"},
        new double[][][] {{}, {}},
        new double[][][] {{{0.5, 0, 14.5, 16, 14.5, 16}}, {{0, 0, 14.5, 16, 14.5, 16}}}, false);
    /** 摇椅：xiaojingyu:rocking_chair，1 × 1 × 1 格 */
    public static final Kind ROCKING_CHAIR = new Kind("rocking_chair", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{0, 0, 1.5, 14, 16, 15.5}}},
        new double[][][] {{{0, 0, 1.5, 14, 16, 15.5}}}, false);
    /** 电视和电视柜：xiaojingyu:tv_stand，2 × 1 × 1 格，光 5 */
    public static final Kind TV_STAND = new Kind("tv_stand", 2, 1, 1, 5,
        new String[] {"box", "box"},
        new double[][][] {{{3.5, 0, 8, 16, 16, 16}}, {{0, 0, 8, 13, 16, 16}}},
        new double[][][] {{{3.5, 0, 8, 16, 16, 16}}, {{0, 0, 8, 13, 16, 16}}}, false);
    /** 双人小沙发：xiaojingyu:sofa，2 × 1 × 1 格 */
    public static final Kind SOFA = new Kind("sofa", 2, 1, 1, 0,
        new String[] {"box", "box"},
        new double[][][] {{{0.5, 0, 3, 16, 12.5, 13.5}}, {{0, 0, 3, 16, 12.5, 13.5}}},
        new double[][][] {{{0.5, 0, 3, 16, 12.5, 13.5}}, {{0, 0, 3, 16, 12.5, 13.5}}}, false);
    /** 地毯和小茶几：xiaojingyu:living_rug，2 × 2 × 1 格 */
    public static final Kind LIVING_RUG = new Kind("living_rug", 2, 2, 1, 0,
        new String[] {"thin", "box", "thin", "thin"},
        new double[][][] {{{0, 0, 0, 16, 1, 16}}, {{0, 0, 0.5, 15.5, 9.5, 16}}, {{0, 0, 0, 16, 1, 16}}, {{0, 0, 0, 16, 1, 16}}},
        new double[][][] {{{0.5, 0, 0.5, 16, 0.5, 16}}, {{0, 0, 0.5, 15.5, 9.5, 16}}, {{0.5, 0, 0, 16, 0.5, 15.5}}, {{0, 0, 0, 15.5, 0.5, 15.5}}}, false);
    /** 大盆栽：xiaojingyu:floor_plant，1 × 1 × 1 格 */
    public static final Kind FLOOR_PLANT = new Kind("floor_plant", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{2, 0, 1, 10, 15, 9}}},
        new double[][][] {{{2, 0, 1, 10, 15, 9}}}, false);
    /** 门口地垫：xiaojingyu:door_mat，1 × 1 × 1 格 */
    public static final Kind DOOR_MAT = new Kind("door_mat", 1, 1, 1, 0,
        new String[] {"thin"},
        new double[][][] {{{0, 0, 0, 16, 1, 16}}},
        new double[][][] {{{0.5, 0, 0, 16, 0.5, 9.5}}}, false);
    /** 相册矮桌：xiaojingyu:photo_album_table，1 × 1 × 1 格 */
    public static final Kind PHOTO_ALBUM_TABLE = new Kind("photo_album_table", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{0.5, 0, 0.5, 16, 6, 16}}},
        new double[][][] {{{0.5, 0, 0.5, 16, 6, 16}}}, false);
    /** 地垫坐垫：xiaojingyu:floor_cushions，2 × 1 × 1 格 */
    public static final Kind FLOOR_CUSHIONS = new Kind("floor_cushions", 2, 1, 1, 0,
        new String[] {"box", "box"},
        new double[][][] {{{5, 0, 5.5, 13.5, 2, 14}}, {{3, 0, 6.5, 11.5, 2, 15}}},
        new double[][][] {{{5, 0, 5.5, 13.5, 2, 14}}, {{3, 0, 6.5, 11.5, 2, 15}}}, false);
    /** 窗边坐垫：xiaojingyu:window_seat，2 × 1 × 1 格 */
    public static final Kind WINDOW_SEAT = new Kind("window_seat", 2, 1, 1, 0,
        new String[] {"box", "box"},
        new double[][][] {{{2, 0, 6, 16, 12.5, 16}}, {{0, 0, 6, 14.5, 12.5, 16}}},
        new double[][][] {{{2, 0, 6, 16, 12.5, 16}}, {{0, 0, 6, 14.5, 12.5, 16}}}, false);
    /** 望远镜：xiaojingyu:telescope，1 × 1 × 1 格 */
    public static final Kind TELESCOPE = new Kind("telescope", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{2.8, 0, 0.74548, 13.2, 14.99798, 12.72533}}},
        new double[][][] {{{2.8, 0, 0.74548, 13.2, 14.99798, 12.72533}}}, false);
    /** 储物箱：xiaojingyu:storage_chests，2 × 1 × 1 格 */
    public static final Kind STORAGE_CHESTS = new Kind("storage_chests", 2, 1, 1, 0,
        new String[] {"box", "box"},
        new double[][][] {{{1, 0, 6.5, 16, 11, 15.5}}, {{0, 0, 6, 16, 11, 16}}},
        new double[][][] {{{1, 0, 6.5, 16, 11, 15.5}}, {{0, 0, 6, 16, 11, 16}}}, false);
    /** 懒人沙发：xiaojingyu:beanbag，1 × 1 × 1 格 */
    public static final Kind BEANBAG = new Kind("beanbag", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{1, 0, 1, 15.5, 8, 16}}},
        new double[][][] {{{1, 0, 1, 15.5, 8, 16}}}, false);
    /** 串灯：xiaojingyu:string_lights，1 × 1 × 1 格，光 12 */
    public static final Kind STRING_LIGHTS = new Kind("string_lights", 1, 1, 1, 12,
        new String[] {"none"},
        new double[][][] {{}},
        new double[][][] {{{0, 10.5, 14.5, 16, 16, 16}}}, false);
    /** 沙滩躺椅（毛巾、人字拖）：xiaojingyu:beach_lounger，1 × 2 × 1 格 */
    public static final Kind BEACH_LOUNGER = new Kind("beach_lounger", 1, 2, 1, 0,
        new String[] {"box", "box"},
        new double[][][] {{{3.5, 0, 1.5, 15.5, 7.5, 16}}, {{3.5, 0, 0, 13, 13.20839, 15.5}}},
        new double[][][] {{{3.5, 0, 1.5, 15.5, 7.5, 16}}, {{3.5, 0, 0, 13, 13.20839, 15.5}}}, false);
    /** 沙滩躺椅（草帽和书）：xiaojingyu:beach_lounger_hat，1 × 2 × 1 格 */
    public static final Kind BEACH_LOUNGER_HAT = new Kind("beach_lounger_hat", 1, 2, 1, 0,
        new String[] {"box", "box"},
        new double[][][] {{{3.5, 0, 1.5, 13, 8.5, 16}}, {{3.5, 0, 0, 13, 13.20839, 15.5}}},
        new double[][][] {{{3.5, 0, 1.5, 13, 8.5, 16}}, {{3.5, 0, 0, 13, 13.20839, 15.5}}}, false);
    /** 白色独脚小圆桌：xiaojingyu:beach_table，1 × 1 × 1 格 */
    public static final Kind BEACH_TABLE = new Kind("beach_table", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{4, 0, 4, 12.5, 12.5, 12.5}}},
        new double[][][] {{{4, 0, 4, 12.5, 12.5, 12.5}}}, false);
    /** 条纹遮阳伞：xiaojingyu:beach_parasol，1 × 1 × 3 格 */
    public static final Kind BEACH_PARASOL = new Kind("beach_parasol", 1, 1, 3, 0,
        new String[] {"box", "box", "box"},
        new double[][][] {{{7, 0, 7, 10, 16, 10}}, {{7.25, 0, 7.25, 9.75, 16, 9.75}}, {{8, 6, 8, 9, 7, 9}}},
        new double[][][] {{{7, 0, 7, 10, 16, 10}}, {{0, 0, 0, 16, 16, 16}}, {{0, 0, 0, 16, 7, 16}}}, false);
    /** 木箱和灯笼：xiaojingyu:crate_lantern，1 × 1 × 1 格，光 12 */
    public static final Kind CRATE_LANTERN = new Kind("crate_lantern", 1, 1, 1, 12,
        new String[] {"box"},
        new double[][][] {{{2, 0, 1.5, 14.5, 16, 15}}},
        new double[][][] {{{2, 0, 1.5, 14.5, 16, 15}}}, false);
    /** 花箱（紫花）：xiaojingyu:flower_box_purple，2 × 1 × 1 格 */
    public static final Kind FLOWER_BOX_PURPLE = new Kind("flower_box_purple", 2, 1, 1, 0,
        new String[] {"box", "box"},
        new double[][][] {{{0, 3, 9, 16, 15, 16}}, {{0, 3, 9, 16, 15, 16}}},
        new double[][][] {{{0, 3, 9, 16, 15, 16}}, {{0, 3, 9, 16, 15, 16}}}, false);
    /** 花箱（粉花）：xiaojingyu:flower_box_pink，2 × 1 × 1 格 */
    public static final Kind FLOWER_BOX_PINK = new Kind("flower_box_pink", 2, 1, 1, 0,
        new String[] {"box", "box"},
        new double[][][] {{{0, 3, 9, 16, 15.5, 16}}, {{0, 3, 9, 16, 15, 16}}},
        new double[][][] {{{0, 3, 9, 16, 15.5, 16}}, {{0, 3, 9, 16, 15, 16}}}, false);
    /** 毛巾和挂钩：xiaojingyu:towel_hook，1 × 1 × 1 格 */
    public static final Kind TOWEL_HOOK = new Kind("towel_hook", 1, 1, 1, 0,
        new String[] {"none"},
        new double[][][] {{}},
        new double[][][] {{{5.5, 1, 13, 11.5, 15.5, 16}}}, false);
    /** 贝壳风铃：xiaojingyu:wind_chime，1 × 1 × 1 格 */
    public static final Kind WIND_CHIME = new Kind("wind_chime", 1, 1, 1, 0,
        new String[] {"none"},
        new double[][][] {{}},
        new double[][][] {{{5.5, 1, 10.5, 11, 12.5, 16}}}, false);
    /** 门边壁灯：xiaojingyu:wall_lantern，1 × 1 × 1 格，光 12 */
    public static final Kind WALL_LANTERN = new Kind("wall_lantern", 1, 1, 1, 12,
        new String[] {"none"},
        new double[][][] {{}},
        new double[][][] {{{6.5, 5, 11.5, 10, 15.5, 16}}}, false);
    /** 盆栽（门廊西角）：xiaojingyu:potted_fern，1 × 1 × 1 格 */
    public static final Kind POTTED_FERN = new Kind("potted_fern", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{3.5, 0, 3.5, 12.5, 9.5, 14.5}}},
        new double[][][] {{{3.5, 0, 3.5, 12.5, 9.5, 14.5}}}, false);
    /** 吊篮：xiaojingyu:hanging_basket，1 × 1 × 1 格 */
    public static final Kind HANGING_BASKET = new Kind("hanging_basket", 1, 1, 1, 0,
        new String[] {"none"},
        new double[][][] {{}},
        new double[][][] {{{4.85, 0, 0, 11.47, 15.5, 9}}}, false);
    /** 花盆（台阶东侧）：xiaojingyu:flower_pot，1 × 1 × 1 格 */
    public static final Kind FLOWER_POT = new Kind("flower_pot", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{5, 0, 4.75, 11.5, 10, 11.25}}},
        new double[][][] {{{5, 0, 4.75, 11.5, 10, 11.25}}}, false);
    /** 多肉小盆栽：xiaojingyu:succulents，1 × 1 × 1 格 */
    public static final Kind SUCCULENTS = new Kind("succulents", 1, 1, 1, 0,
        new String[] {"box"},
        new double[][][] {{{2, 0, 2.5, 14, 5, 13.5}}},
        new double[][][] {{{2, 0, 2.5, 14, 5, 13.5}}}, false);
    /** 台阶下地垫：xiaojingyu:step_mat，2 × 1 × 1 格 */
    public static final Kind STEP_MAT = new Kind("step_mat", 2, 1, 1, 0,
        new String[] {"thin", "thin"},
        new double[][][] {{{0, 0, 0, 16, 1, 16}}, {{0, 0, 0, 16, 1, 16}}},
        new double[][][] {{{3.5, 0, 5.5, 16, 0.5, 15}}, {{0, 0, 5.5, 13, 0.5, 15}}}, false);
    /** 相框：xiaojingyu:photo_frame，1 × 1 × 1 格 */
    public static final Kind PHOTO_FRAME = new Kind("photo_frame", 1, 1, 1, 0,
        new String[] {"none"},
        new double[][][] {{}},
        new double[][][] {{{0.5, 0.5, 14, 15.5, 15.5, 16}}}, false);

    /** 第 2、3 轮的全部家具和第 5 轮的相框（注册方块、物品用；顺序 = FURNITURE.md 8.2、9.1 的表，相框在最后） */
    public static final Kind[] KINDS = {NIGHTSTAND, BOOKSHELF, KITCHEN_COUNTER, SPICE_RACK, MINI_FRIDGE, DINING_CHAIR, DESK, DESK_CHAIR, PICTURE_FRAMES, ROCKING_CHAIR, TV_STAND, SOFA, LIVING_RUG, FLOOR_PLANT, DOOR_MAT, PHOTO_ALBUM_TABLE, FLOOR_CUSHIONS, WINDOW_SEAT, TELESCOPE, STORAGE_CHESTS, BEANBAG, STRING_LIGHTS, BEACH_LOUNGER, BEACH_LOUNGER_HAT, BEACH_TABLE, BEACH_PARASOL, CRATE_LANTERN, FLOWER_BOX_PURPLE, FLOWER_BOX_PINK, TOWEL_HOOK, WIND_CHIME, WALL_LANTERN, POTTED_FERN, HANGING_BASKET, FLOWER_POT, SUCCULENTS, STEP_MAT, PHOTO_FRAME};

    /** 按方块路径找（带不带 "xiaojingyu:" 都行）；第 1 轮的 3 件和找不到的返回 null */
    public static Kind kind(String id) {
        String path = id.startsWith("xiaojingyu:") ? id.substring(11) : id;
        for (Kind k : KINDS) if (k.id.equals(path)) return k;
        return null;
    }

    // ---- 照片（docs/PHOTOS.md 第 3 节）：每行 {part, x0, y0, x1, y1, z}，朝北的模型、相对这一格（part）的像素；行号 = 方块实体里 Slots 的编号 ----
    /** 画框：xiaojingyu:picture_frames 的照片那块（6 个，下排先、从正面看从左到右 = 56-furn-ground 的 FR 顺序） */
    public static final double[][] PICTURE_FRAMES_PHOTO_SLOTS = {{1, 6.5, 1, 15, 6, 15.5}, {1, -4, 1, 4.5, 6, 15.5}, {0, 1, 0.5, 10.5, 6.5, 15.5}, {1, 6.5, 8.5, 15, 13.5, 15.5}, {1, -4.5, 8, 5, 14, 15.5}, {0, 1.5, 8.5, 10, 13.5, 15.5}};
    /** 相框：xiaojingyu:photo_frame 的照片那块 */
    public static final double[][] PHOTO_FRAME_PHOTO_SLOTS = {{0, 2, 2, 14, 14, 15}};
    private static final double[][] NO_PHOTO_SLOTS = {};

    /** 照片画在哪（id 带不带 "xiaojingyu:" 都行）；没有照片的家具和找不到的返回空数组。数组是只读的，别改里面的数 */
    public static double[][] photoSlots(String id) {
        String path = id.startsWith("xiaojingyu:") ? id.substring(11) : id;
        switch (path) {
            case "picture_frames": return PICTURE_FRAMES_PHOTO_SLOTS;
            case "photo_frame": return PHOTO_FRAME_PHOTO_SLOTS;
            default: return NO_PHOTO_SLOTS;
        }
    }

    /**
     * 朝北的盒子转到别的朝向：quarterTurns = 从上往下看顺时针转几个 90°（north 0、east 1、south 2、west 3，
     * 和 blockstate 的 y 旋转 0 / 90 / 180 / 270 一样）。一个 90°：x' = 16 - z，z' = x。返回新数组。
     */
    public static double[] rotateY(double[] box, int quarterTurns) {
        double x0 = box[0], y0 = box[1], z0 = box[2], x1 = box[3], y1 = box[4], z1 = box[5];
        for (int t = ((quarterTurns % 4) + 4) % 4; t > 0; t--) {
            double nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1;
            x0 = nx0;
            x1 = nx1;
            z0 = nz0;
            z1 = nz1;
        }
        return new double[] {x0, y0, z0, x1, y1, z1};
    }

    /** "north" → 0、"east" → 1、"south" → 2、"west" → 3（Direction 的 getSerializedName()）；别的返回 0。 */
    public static int quarterTurns(String facing) {
        switch (facing) {
            case "east": return 1;
            case "south": return 2;
            case "west": return 3;
            default: return 0;
        }
    }
}
