> 2026-11-05 查资料时整理的 YSM 不加密格式规格（导入器 `src/29-ysm.js` 照它写）。来源：YSM 官方 wiki、Blockbench 的 Bedrock 导入源码、YSM 官方 Blockbench 插件里读取格式的部分（没碰加密 / 导出 .ysm 的代码）、两个本地样本。条目后面标了 [src] [plugin] [BB] [sample] [guess]。

# YSM 2.6.5 — unencrypted model format (importer spec)

**Scope.** Folder, `.zip` and `.7z` (2.5.2+) models. `.ysm` files are encrypted: reject them.

**Tags**

- **[src]** Official wiki or update log. `W` = https://yesstevemodel.github.io (zh pages). Markdown sources: github.com/YesSteveModel/YSM-Wiki-Issues `docs/`.
- **[plugin]** Official `ysm-utils` Blockbench plugin (`W/files/2.6.0/ysm-utils.js`). Only its legacy-import, `info.json` and default-template data were read.
- **[BB]** Blockbench source (`js/formats/bedrock/bedrock.js`, `bedrock_animation.js`, `js/outliner/types/cube.js`, `js/animations/timeline_animators.js`, `js/io/format.ts`). YSM treats Blockbench as the reference: "compliant model ≠ Blockbench render ⇒ mod bug" (`W/wiki/ysm-uv-standard/`).
- **[sample]** The local samples: `rabbit` (legacy layout) and `dsV4P` (spec 2).
- **[guess]** My inference, not confirmed.

## 1. File layouts

### Legacy layout (YSM ≤ 1.2.0)
[src `W/wiki/struct/`]

All files sit flat in the model folder, with fixed names:

- **Required:** `main.json`, `arm.json`, and at least one `*.png`.
- **Optional:** `{main,arm,extra,tac,carryon,slashblade,tlm,arrow}.animation.json`, `arrow.json` + `arrow.png`, `info.json`.
- **Skins:** every png except `arrow.png`. The file name is the display name.
- **Naming:** lowercase letters, digits and `_` only.

Metadata and scale [plugin]:

- **`info.json`:** `{name, tips, authors:[string], license:string, free:bool, extra_animation_names:[8 → extra0..7]}`.
- **Older "1.1.4" models:** the same object is in `main.json` → `geometry[0].description.ysm_extra_info`.
- **Scale:** that description also holds `ysm_height_scale` / `ysm_width_scale`. Both default to 0.7.

### Spec 2 layout (YSM 2.2.1+)
[src `W/wiki/struct/`; matches dsV4P]

- `ysm.json` sits in the model root (UTF-8, no BOM) and indexes every other file.
- Paths are free-form and **case-sensitive**. Typical folders: `models/`, `animations/`, `textures/`, `avatar/`, `controller/`.
- Three folders have default names, each overridable with a `files.*_path` key:
  - `sounds/` (ogg only)
  - `functions/` (`*.molang`)
  - `lang/` (`<locale>.json`)

### Detecting the layout

The plugin checks in this order [plugin]:

1. `ysm.json` → spec 2.
2. Otherwise `info.json` → legacy 1.1.5.
3. Otherwise `main.json` → legacy 1.1.4.

Assume the mod does the same [guess].

- Model ID = folder name [src]; for an archive, its file name [guess]. Discovery searches up to 16 levels deep [src `W/wiki/type/`].
- In an archive, use the shallowest `ysm.json` / `main.json` [guess]. The rabbit zip is flat.

### Converting legacy to spec 2

The plugin's converter maps fields as follows [plugin]:

- textures = root `*.png` except `arrow.png`
- name = `info.name`, falling back to the folder name
- authors → `[{name}]`
- license → `{type}`
- `extra_animation_names[i]` → `extra_animation["extra"+i]`
- `arrow.json` → `projectiles` entry with `match:["#minecraft:arrows"]`

### Model packs (2.5.0)
[src `W/wiki/model-pack/`]

- A pack is a folder or zip of models plus `ysm-pack.json` / `ysm-pack.png` (cover, 52:90).
- A zipped pack must contain at least one of those two files.
- `ysm-pack.json` = `{name, description, lang:{"zh_cn":{name,description}}}`.

## 2. `ysm.json` (spec 2)

Sources: [src `W/wiki/struct/`, `W/wiki/roulette/`, `/log/264/`]. Example = the dsV4P file plus fields the docs describe:

```jsonc
{ "spec": 2,                                   // required, must be 2
  "metadata": { "name": "DeepSeek酱", "tips": "a\nb", "license": { "type": "ARR", "desc": "…" },
    "authors": [ { "name": "羊毛", "avatar": "avatar/icon.png", "role": "…", "comment": "…", "contact": { "BiliBili": "https://…" } } ],
    "link": { "home": "…", "donate": "…" } },
  "properties": { "height_scale": 0.65, "width_scale": 0.65,          // default 0.7
    "extra_animation": { "extra1": "#wazi", "extra2": "", "#cat1": "Label", "#return": "Back" },
    "extra_animation_classify": [ { "id": "cat1", "extra_animation": { "extra3": "Wave" } } ],
    "extra_animation_buttons": [ { "id": "wazi", "name": "设置", "config_forms": [
      { "type": "range", "title": "…", "description": "…", "value": "v.roaming.Size", "step": 0.1, "min": 0.1, "max": 4 },
      { "type": "checkbox", "title": "…", "value": "v.roaming.Tail" },
      { "type": "radio", "title": "…", "value": "v.type", "labels": { "A": "v.type=0;", "B": "v.type=1;" } } ] } ],
    "preview_animation": "MainAnim", "default_texture": "default", "free": false, "render_layers_first": false,
    "disable_preview_rotation": true, "gui_no_lighting": false, "gui_foreground": "textures/gui/fg.png",
    "gui_background": "textures/gui/bg.png", "all_cutout": true, "merge_multiline_expr": true },
  "files": {                                   // required
    "player": { "model": { "main": "models/main.json", "arm": "models/arm.json" },
      "animation": { "main": "…", "arm": "…", "extra": "…", "tac": "…", "carryon": "…", "parcool": "…", "swem": "…",
        "slashblade": "…", "tlm": "…", "immersive_melodies": "…", "irons_spell_books": "…", "fp_arm": "…" },
      "animation_controllers": [ "controller/main.animation_controllers.json" ],
      "texture": [ "textures/default.png", { "uv": "textures/blue.png", "normal": "…_n.png", "specular": "…_s.png" } ] },
    "projectiles": [ { "match": ["minecraft:arrow", "#minecraft:arrows"], "model": "…", "animation": "…", "controller": "…", "texture": "…" } ],
    "vehicles":    [ { "match": ["minecraft:boat"], "model": "…", "animation": "…", "controller": "…", "texture": "…" } ],
    "sound_path": "sounds", "function_path": "functions", "language_path": "lang" } }
```

Rules:

- **`metadata`** is optional. Inside it, only `name` is required, plus `license.type` when `license` exists.
  - `tips` and `license.desc` may contain `\n`.
  - Order is preserved for authors, contacts and `extra_animation`.
- **`extra_animation`** maps animation name → wheel label. No count limit; only the first 8 entries get hotkeys.
  - Label `""` → use the animation name or the lang key `properties.extra_animation.<name>`.
  - Label `"#id"` → the slot also gets a config button from `extra_animation_buttons`. In dsV4P, `extra1` opens the "设置" form.
  - Key `"#id"` → a submenu from `extra_animation_classify`.
  - Key `"#return"` → a back button.
- **`config_forms.value`** must be a bare variable.
  - A checkbox writes 0 or 1.
  - A radio shows the label at index = the variable's value. Clicking a label runs its statement.
- **Other `properties`:**
  - `preview_animation`: plays in the selection GUI (legacy: `idle`).
  - `default_texture`: file name without directory or `.png`.
  - `free`: the model can't be made authorization-only.
  - `render_layers_first`: vanilla layers draw before the model.
  - `gui_*`: GUI images, 52×90, at most 260×450.
  - `all_cutout`: forces culling everywhere (for negative-size outlines).
  - `merge_multiline_expr`: joins timeline arrays.
- **`files.player.animation` keys** are all optional. Missing animations fall back to the default model's [src `W/wiki/animation/index/`].
- **`projectiles` / `vehicles` changed shape:**
  - 2.5.2+: an array with `match`.
  - 2.5.0–2.5.1: an object keyed by entity id.
  - Before that: `files.arrow {model, animation, texture}`.

## 3. Geometry → three.js (replicate Blockbench)

### Input

- **Format:** Bedrock geometry, `format_version` **≥ 1.12.0**; the samples are 1.12.0 and 1.21.0 [src `W/wiki/type/`, `/log/221/`]. Use `"minecraft:geometry"[0]` [guess].
- **Fields seen in the samples:**
  - description: `texture_width/height`
  - bone: `name, parent, pivot, rotation, cubes`
  - cube: `origin, size, uv, pivot, rotation, inflate, mirror`
- **Never mentioned by YSM:** `locators`, `poly_mesh`, `uv_rotation`, `material_instance`, `binding`. Parse them as BB does, or ignore them [guess].
- **Units:** 1 px = 1/16 block; angles in degrees.

### Conversion [BB `parseBone` / `parseCube`; Bedrock X is mirrored]

**Bones**

- pivot → `(-px, py, pz)`
- rotation → `(-rx, -ry, +rz)` degrees, Euler order **`'ZYX'`** [BB `format.ts`]

**Cubes**

- `from = (-(ox+sx), oy, oz)`
- pivot → `(-cx, cy, cz)`; rotation → `(-rx, -ry, +rz)`, order ZYX
- Missing cube `pivot`: BB uses `(0,0,0)`; the Bedrock spec says box centre. The samples always set it.
- **Inflate:** per axis `size' = size + 2·inflate` (signed), same centre [BB `adjustFromAndToForInflateAndStretch`]. Use `cube.inflate ?? bone.inflate`.
- **`mirror`:** `cube.mirror ?? bone.mirror`, box UV only.

**Build steps**

1. `bone.position = pivot − parentPivot`; a root bone uses its own pivot.
2. Put each cube in a node at `cubePivot − bonePivot`, rotated by the cube rotation.
3. Create `BoxGeometry(size'.x, size'.y, size'.z)` with **signed** sizes (= BB `setShape(from, to)`), centred at `(from+to')/2 − cubePivot`.
4. Give zero-thickness axes 0.001.

A negative size mirrors the box and flips its winding. Outline "inverted hull" models rely on this, together with culling.

**Resulting frame** [sample + BB]

- +Y is up; the feet sit at y≈0, the entity origin.
- The model **faces −Z**: eye bones have z<0.
- Its right side ends up at +X (`RightArm` pivot x is −4.4 in the JSON).
- Rotate the root 180° about Y to face +Z.

**World size**

- size in blocks = px/16 × scale. Default scale 0.7 [src].
- Applying `height_scale` to Y and `width_scale` to X/Z is a [guess]. Whether vanilla's 0.9375 player scale also applies is unknown.
- Both samples are about 42–43 px tall: ≈1.86 blocks at 0.7, ≈1.75 at 0.65.

### UVs

**UV space.** Divide by `texture_width/height`, not by the PNG size. The PNG may be k× larger; the UV standard defines the UV unit as declared ÷ actual [src]. The samples declare 256 with 256 px images. Use `NearestFilter`, no mipmaps.

**Per-face UV** [BB]: `uv:{north|south|east|west|up|down:{uv:[u,v], uv_size:[w,h], uv_rotation?}}`.

- Rect = `[u, v, u+w, v+h]`. Sizes may be negative; BB exports `down` as `[w,-h]`.
- **For `up` and `down`, swap corners:** `[u+w, v+h, u, v]`.
- A missing face is not drawn.

**Box UV `[u0,v0]`** [BB `cube.js updateUV`]

- Sizes are floored: `w,h,d = floor(size + 1e-7)`. BB's Bedrock format doesn't set `box_uv_float_size`.
- Face names are in BB space: `east` = +X in three.js, which is the JSON −X side.

| Face | Rect `[x1,y1,x2,y2]` |
|---|---|
| east | `[u0, v0+d, u0+d, v0+d+h]` |
| west | `[u0+d+w, v0+d, u0+2d+w, v0+d+h]` |
| up | `[u0+d+w, v0+d, u0+d, v0]` |
| down | `[u0+d+2w, v0, u0+d+w, v0+d]` |
| south | `[u0+2d+w, v0+d, u0+2d+2w, v0+d+h]` |
| north | `[u0+d, v0+d, u0+d+w, v0+d+h]` |

- **`mirror`:** swap x1↔x2 in every rect, then swap the east and west rects.
- BB insets each rect by 1/64 px to prevent bleeding.
- **YSM UV standard (2.6.0+):** every non-empty face needs |size| ≥ 1 UV unit, at integer multiples; anything else renders undefined [src].

**Writing into BoxGeometry**

- Face groups `px,nx,py,ny,pz,nz` = `east,west,up,down,south,north`.
- For each vertex with default uv `(s,t)`:
  - `U = (x1+(x2−x1)·s)/W`
  - `V = 1 − (y1+(y2−y1)·(1−t))/H`
- **`uv_rotation`:** per 90°, corners `[c0,c1,c2,c3]` → `[c2,c0,c3,c1]` [BB].

### Materials

- PNG only. Translucency works but is slow [src `W/wiki/texture/`, `/log/265/`].
- Use DoubleSide normally and FrontSide when `all_cutout` is set [guess].
- **`ysmGlow*`** (case-sensitive prefix): that bone's own cubes are full-bright/unlit; children are not affected [src `W/wiki/tph2yetr/`].
- Cubes scaled to 0 are skipped.

## 4. Bone names YSM gives meaning to

Sources: [src `W/wiki/tph2yetr/`, `/animation/fp/`, `/animation/vehicle/`]

| Bone | Meaning |
|---|---|
| `Head` | Automatic look rotation (the docs call it "legacy") |
| `AllHead` | Hidden in first person (FP Model mod, Better Combat) |
| `ViewLocator` | Pivot Y = eye height (FP Model mod) |
| `LeftHandLocator` / `RightHandLocator` (+`…2`–`…8`, 2.4.0) | Offhand / mainhand item. Missing ⇒ the item is not drawn |
| `ElytraLocator`, `L/RShoulderLocator`, `BackpackLocator` | Elytra; shoulder parrots; backpack |
| `LeftWaistLocator` / `RightWaistLocator` | SlashBlade **main** / **off** hand (sic) |
| `BladeLocator` / `SheathLocator` | SlashBlade blade / sheath (dsV4P: `…Locater`) |
| `PistolLocator` / `RifleLocator` | TACZ holstered gun / gun on back |
| `PassengerLocator[2–8]` | Vehicle models: where the rider attaches |
| `Background` (root bone of `arm.json`) | First-person background, not animated |

### Default skeleton

The official template's tree [plugin]. Keep these names so the default fallback animations fit:

```
Root ─ MAllBody ─ AllBody ─┬ UpBody ─┬ UpperBody ─┬ AllHead ─ MHead ─ Head ─ {Hair…, Face ─ Eyes ─ {Eyebrow, Eyelid ─ L/REyelid
                           │         │            │                          ─ L/REyesBase ─ L/RPupil}, L/RShoulderLocator}
                           │         │            ├ Arm ─ LeftArm ─ LeftForeArm ─ LeftHand ─ {LeftHandLocator, SheathLocator, LeftWaistLocator}
                           │         │            │     └ RightArm ─ RightForeArm ─ RightHand ─ {RightHandLocator, BladeLocator}
                           │         │            └ Breast, Collar, ElytraLocator, RifleLocator, BackpackLocator
                           │         └ PistolLocator, RightWaistLocator
                           └ DownBody ─ {Leg ─ L/RLeg ─ L/RLowerLeg ─ L/RFoot, Skirt…}
Root ─ molang   (empty dummy; animations write assignments into it, e.g. rotation ["v.bv=math.cos(…)*2",0,0])
```

- The `molang` bone implies the Molang evaluator must accept **assignments inside keyframe values**.
- The rabbit sample has no `MAllBody` or `MHead`.

### `arm.json` (first-person arms)
[src `W/wiki/tph2yetr/`, `/animation/first-person-anim/`]

- `LeftArm` and `RightArm` sit at the root with their own rotation set to 0.
- Same texture as `main.json`.
- Only those two subtrees are drawn and animated. dsV4P wraps them in an `Arm` bone.

### Head look

YSM applies it [src]; the details below are a [guess] from the samples.

- Applied additively after animation, in three.js space: `Head.rotation += (pitch, yaw)`. In JSON terms that is `(−ysm.head_pitch, −ysm.head_yaw, 0)`.
- Animations cancel it where needed, e.g. `elytra_fly` sets `Head: ["ysm.head_pitch","ysm.head_yaw",0]`.
- It has no effect at pitch = yaw = 0.

## 5. Animations

### File format

- Bedrock animation JSON, `"format_version":"1.8.0"`, structure `{animations:{name:{...}}}`.
- Ignore `"geckolib_format_version": 2` [guess].
- Names starting with `——` are separators, hidden in the UI [src `/log/221/`].

**Animation fields**

- `loop`: `true` | `"hold_on_last_frame"` | absent/false (play once).
- `animation_length` in seconds; defaults to the last keyframe's time [BB].
- `blend_weight` (Molang, 2.3.0) [src].
- `override_previous_animation`, `anim_time_update`, `start_delay`, `loop_delay`: support unknown.

**Channels**

`bones:{name:{rotation|position|scale: X}}`. Match names exactly [guess]; BB ignores case. `X` can be:

- **(a)** a constant `[x,y,z]` of numbers or Molang strings; a single number or string applies to all axes (e.g. `"scale":"v.roaming.Size"`);
- **(b)** a single keyframe `{post, lerp_mode}` or `{pre, post}`;
- **(c)** a timeline `{"0.0": v, "0.0417": v, …}`, where `v` is an array, a scalar, or `{pre?, post, lerp_mode?}`.

**Interpolation** [BB `interpolate`]

- **Linear** (default): from `before.post` to `after.pre`.
- **Catmull-Rom:** used if either neighbour has `lerp_mode:"catmullrom"`. It runs through before-before / before / after / after-after (`THREE.SplineCurve` over (time, value)). Loop animations with ≥3 keys wrap around.
- **Step:** a key whose `pre` differs from its `post` holds its value. BB exports step as pre/post pairs and bakes Bézier to linear; still accept `"step"`.
- **Edges:** before the first key → its `pre`; exactly on a key → its `pre`; after the last key → its `post`. No wrap-around.
- YSM documents both smooth and step interpolation [src `/log/120/`].

**Applying values** (signs flipped at parse time [BB])

| Channel | Unit | three.js |
|---|---|---|
| rotation | degrees | `rot = rest + (−x, −y, +z)` (Euler components added, order ZYX) |
| position | px | `pos = restOffset + (−x, +y, +z)` |
| scale | factor | `scale *= (x, y, z)` |

### Sound and script keyframes

- **`sound_effects`:** `{t:{effect}}` or `{t:[…]}`. `effect` is a sound file name without `.ogg`, or a Minecraft / resource-pack id such as `minecraft:block.anvil.hit` [src `W/wiki/sound/`].
- **`timeline`:** `{t:"stmt;"}` or `{t:["stmt;",…]}`, run when playback crosses `t`.
  - Join array entries with `\n`; `{…}` blocks are split across entries.
  - A tiny looping length plus a timeline key at `0.0` gives a per-frame script (dsV4P `parallel3`, length 0.0083).
- **`particle_effects`:** support unknown. YSM itself spawns particles with `ysm.particle()`.

### Layer order
[src `/animation/parallel/`, `/condition/arm/`, `/controller/`; order partly a guess]

From low to high priority:

1. `pre_parallel0…7`
2. main state or wheel (extra) animation
3. hand animations: hold (both hands) → swing → use
4. ride / armor / mod animations (position unknown)
5. `parallel0…7`

Combination rules:

- Within a group, a higher index wins.
- A higher layer **replaces** a lower one per bone and channel, but only for the bones it animates.
- **Exception — `parallel*`:** rotation **adds** to the result below; position and scale still replace.
- Inside one controller, scale contributions multiply (2.4.0).
- State switches cross-fade; ~0.1–0.2 s is a [guess].

### When each animation plays

**Main states** [src `W/wiki/animation/main/`]

- **Loop:**
  - `idle`, `walk`, `run`, `jump`
  - `sneak` (moving), `sneaking` (still)
  - `swim`, `swim_stand`
  - `climb` (crawl moving), `climbing` (crawl still)
  - `fly` (creative), `elytra_fly`, `riptide`
  - `sleep`, `sit`, `ride` (horse/donkey), `ride_pig`, `boat`
  - `ladder_up`, `ladder_stillness`, `ladder_down`
- **Play once:**
  - `attacked`
  - `death` (~1 s; held on the last frame in the template)
  - `use_mainhand`, `use_offhand`, `swing_hand`, `swing_offhand`, used as fallbacks when no hand animation matches
- `empty` is a debug animation.
- The legacy rabbit uses `use_righthand` / `use_lefthand`.
- **State priority is undocumented.** The `ctrl.*` list order suggests: death > riptide > sleep > swim > climb > climbing > ladder > fly > elytra_fly > swim_stand > attacked > jump > sneak > sneaking > run > walk > idle [guess].

**Hand animations** (arm file) [src]

- Name = `hold_mainhand` | `hold_offhand` | `use_mainhand` | `use_offhand` | `swing` | `swing_offhand`, followed by `:category`, `$item_id` or `#item_tag`.
- Categories: `empty eat drink sword axe pickaxe shovel hoe shield block bow crossbow charged_crossbow spear lance spyglass toot_horn brush throwable_potion fishing_rod slashblade`, plus `:fishing` (hold_mainhand only).
- A hold animation restarts when the item changes. A swing always finishes.

**Other animations**

- **Wheel:** the keys of `extra_animation` (legacy: `extra0…7`). Each plays with its own loop mode; moving cancels it unless the wheel is locked [src].
- **Selection GUI:** `preview_animation`, `hover`, `hover_fadeout`, `focus`.
- **Riding:** `vehicle$<entity>`, `passenger$<entity>`.
- **Armor:** `head|chest|legs|feet` + `$id` | `#tag` | `:default`.
- **`fp_arm` file:** `parallel0…7` only; shares `v.roaming` with the main model.
- **Mod-compatibility files:** `tac:*`, `carryon:*`, `parcool:*`, `swem:*`, `slashblade:*`, maid, `immersive_melodies`, `irons_spell_books`.

### Animation controllers
[src `W/wiki/controller/`; plugin template]

- Standard Bedrock controller JSON (format 1.19.0). **Keys are slot names, not `controller.animation.*`.**
- Defining a slot replaces its built-in logic.
- Slots:
  - `player.main` / `pre_main` / `post_main`
  - `player.pre_parallel_0…7`, `player.parallel_0…7`
  - `player.hold_mainhand` / `hold_offhand`, `player.pre_hold` / `post_hold`
  - `player.use` / `pre_use` / `post_use`
  - `player.swing` / `pre_swing` / `post_swing`
  - `player.passenger` / `vehicle`
  - `player.armor_head` / `armor_chest` / `armor_legs` / `armor_feet`
  - `player.gui_hover` / `gui_focus`
  - `player.fire` / `carry_on` / `parcool`
  - `fp.arm.*`, `projectile.*`, `vehicle.*`
- Special states (2.6.3): `ysm-builtin` runs the built-in logic; `ysm-entry-<child>` runs the sub-controller `<parent>.<child>`.

### `functions/*.molang` (2.5.0)
[src `W/wiki/molang/script/`; sample]

**Plain functions** — `<name>.molang` is callable as `fn.<name>(…)`.

- The name is case-insensitive.
- Arguments are read with `args[i]`.
- `return` exits the function.
- `t.*` variables are per call; `v.*` variables are shared.

**Event handlers** — `<label>@<event>.molang`, where the label is optional.

- `player_init`: model switch or entity load; runs after `v.roaming` is restored.
- `player_update`: before each animation update.
- `sync`: fired by `ysm.sync(…)`.
- Events fire in that order. When several handlers listen to the same event, their order is random.

**Script controllers** — `@player_ctrl_<slot>.molang`.

- The file name is the controller name with `.` replaced by `_ctrl_`, e.g. `player.parallel_5` → `@player_ctrl_parallel_5`.
- The wiki file-tree example `@ctrl_player_…` contradicts this (likely a typo); the sample and the functions page both use `player_ctrl_…`.
- Runs every frame. Available calls:
  - `ctrl.set_animation('n'[, ctrl.loop|ctrl.play_once|ctrl.hold_on_last_frame])`
  - `ctrl.set_beginning_transition_length(s)`
  - `ctrl.reset`
  - `ctrl.indicate_reload`
- Must end with `return ctrl.state_continue|state_pause|state_stop|state_bypass`. Bypass hands control back to the built-in logic. The reference table writes these as `ysm.state_*`.

**What dsV4P has**

- 3 × `@player_init`, seeding `v.*` / `v.roaming.*` defaults.
- `@player_ctrl_main`: plays `walkBack` while `ctrl.walk && ysm.input_vertical<0.1`.
- `@player_ctrl_parallel_5`: lifts an arm at walls.
- `@player_ctrl_pre_parallel_1`: random blink.

**Importer order** [guess]

1. Run all `*@player_init` once.
2. Then every frame:
   1. `*@player_update`
   2. script controllers (unknown `ctrl.*` calls are no-ops)
   3. animations

## 6. Molang
[src `W/wiki/molang/index/`, `/var/`, `/ref/`]

### Syntax and semantics

- **Syntax:** Bedrock Molang plus strings `'…'`, `??`, `?:`, `{…}` blocks, `loop`, `for_each`, `break`, `continue`, structs (not nested), `->`, `args[i]`, `fn.*`, assignments inside keyframe values, and `//` comments.
- **Null:** an uninitialised variable is `null`, read as 0/false.
- **Aliases:** `q.`=`query.`, `v.`=`variable.`, `t.`=`temp.`; never `v.r.`.
- **Case:** treat identifiers as case-insensitive [guess].
- **Trigonometry:** `math.sin`/`cos` take degrees. Per YSM's reference, `asin`/`acos`/`atan`/`atan2` return **radians** (Bedrock returns degrees).

### Variable lifetime

- **`v.*`:** per entity; reset on model switch, respawn, dimension change or relog.
- **`v.roaming.*`:** saved on the server and synced.
  - Floats only.
  - Up to 64 per model; each model has its own set since 2.5.0.
  - Name length: ≤16 characters per the reference, ≤32 per the 2.4.0 log.

### Common queries and viewer defaults
[src `/wiki/molang/ref/`]

| Name | Meaning / unit | Default |
|---|---|---|
| `q.anim_time` | Per the YSM doc: seconds since the animation started; **doesn't reset on loop** | auto |
| `q.life_time` | Per the YSM doc: seconds into the current loop, ≤ length (**swapped vs Bedrock**) | auto |
| `q.delta_time`, `ysm.time_delta` | Frame dt, seconds | dt |
| `ysm.head_yaw` (= YSM `q.head_x_rotation`) | Head yaw relative to body, degrees. Positive = turned to the model's **left** [guess, from samples] | 0 |
| `ysm.head_pitch` (= YSM `q.head_y_rotation`) | Degrees, −90…90. **Positive = looking up** [src] | 0 |
| `q.ground_speed`, `ysm.ground_speed2` | Horizontal speed, ≥0. Doc: walk ≈1.7, run ≈3.2, fly 20. `ground_speed2` is synced across players | 0 |
| `q.vertical_speed` | m/s, up is positive | 0 |
| `ysm.input_vertical`, `ysm.input_horizontal` | Movement input; >0 = forward / right | 0 |
| `q.is_on_ground` | boolean | 1 |
| `q.is_jumping`, `is_sneaking`, `is_sprinting`, `is_swimming`, `is_riding`, `is_sleeping`, `is_in_water`, `is_first_person` | booleans | 0 |
| `q.health`, `q.max_health`, `ysm.food_level` | stats | 20 |
| `ysm.armor_value`, `q.hurt_time` | stats | 0 |
| `q.body_y_rotation`, `q.yaw_speed` | degrees, deg/s | 0 |
| `q.time_of_day` | 0 = midnight, 0.5 = noon | 0.5 |
| `q.moon_phase` | 0–7 | 0 |
| `ysm.weather` | 0 / 1 / 2 | 0 |
| `q.cardinal_facing_2d` | 2 N, 3 S, 4 W, 5 E | 2 |
| `ysm.is_close_eyes` | blinks about every 4 s; also true while sleeping | animate |
| `ysm.has_helmet`, `has_chest_plate`, `has_leggings`, `has_boots`, `has_elytra`, `has_mainhand`, `has_offhand` | equipment present | 0 (offer as UI toggles) |
| `ysm.person_view` | 0 = first person, 1 = third person back, 2 = third person front | 2 |
| `ysm.rendering_in_inventory`, `ysm.rendering_in_paperdoll` | rendering in a GUI | 0 |
| `ysm.texture_name` | current skin file name, e.g. `'blue.png'` | current |
| `ysm.first_order(name,in,resp)`, `ysm.second_order(name,in,f,c,r)` | Stateful smoothing keyed by `name`; used for physics hair/tails | damped spring, or return `in` [guess] |
| `ctrl.idle`, `walk`, `run`, `sneak`, `jump`, `swim`, `fly`, `elytra_fly`, `sleep`, `death`, `attacked`, `ladder_*`, …, `ctrl.playing_extra_animation` | state booleans | `idle` = 1, rest 0 |
| `ctrl.hold/use/swing(slot,'$id'│'#tag'│':cat')`, `ctrl.armor`, `ctrl.ride`, string `ctrl.*` | matchers / strings | 0 / `''` |

- Side-effect calls (`ysm.play_sound`, `stop_sound`, `particle`, `sync`, `q.debug_output`): implement them or make them no-ops.
- Block, biome and item queries: return 0.

## 7. Textures

**Choosing the skin**

- **Spec 2:** `files.player.texture` lists the skins in UI order. Each entry is a path or `{uv, normal?, specular?}`.
  - The default skin is `properties.default_texture` [src `W/wiki/texture/`].
  - If that is missing, use the first entry [guess].
- **Legacy:** every root `*.png` except `arrow.png`.
  - Undocumented default: prefer `default.png`, otherwise the first alphabetically [guess].
  - The rabbit sample has `rabbit1.png` and `rabbit2.png`.

**Size:** any integer multiple of `texture_width/height` (§3). `main.json` and `arm.json` share the texture.

**PBR maps** follow **LabPBR**, according to YSM's PBR page [src `W/wiki/pbr/`]. A viewer may ignore them.

- `_s` (specular):
  - R = smoothness; roughness = (1−R)²
  - G = F0, with ≥230 meaning metal
  - B = porosity / subsurface scattering
  - A = emission; 255 = none
- `_n` (normal):
  - RG = normal, DirectX (Y−)
  - B = ambient occlusion
  - A = height

## 8. Not confirmed

1. How the mod detects the layout; only the plugin's logic is known. Also, archives with a top-level folder.
2. How `height_scale` / `width_scale` map to axes, and whether an extra 0.9375 scale applies.
3. Head-look composition, when it is suppressed, and the sign of yaw.
4. State priority; where extras, riding and armor layers sit; the default cross-fade time.
5. Field support:
   - case sensitivity of bone names;
   - `particle_effects`, `override_previous_animation`, `anim_time_update`, `start_delay`, `loop_delay`;
   - `uv_rotation`, `locators`, `poly_mesh`, cubes without a pivot;
   - whether `geckolib_format_version` changes anything.
6. Whether YSM's Catmull-Rom matches BB's curve exactly, and how fractional box-UV sizes render.
7. Default skin when `default_texture` is missing, and for legacy models.
8. Whether a `#id` wheel slot also plays its animation.
9. The YSM docs' claims about `anim_time` / `life_time` and radian-returning inverse trig are untested.
10. Double-sided rendering by default, and exactly what `all_cutout` changes.
11. Any `info.json` fields beyond the ones the plugin reads and writes.
12. Animation names for mod-compatibility files are not listed here (see the default model).
