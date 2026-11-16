# 小鲸鱼 v3 voxel design (target = refs/concept-girl.png)

Measured from the concept front view (feet→ahoge ≈ 618 px ≈ 64 units, ≈ 9.7 px/unit).
Design units: 1 unit = 0.02 m (≈1.25 m tall). +x = her left, +y up, +z = front (she faces +z).
Mirror x ↔ −x around centre column 0. Head (incl. ahoge) ≈ 40 % of height, ≈ 2.9 heads.

## Proportions (design units, inclusive, mirrored unless noted)
- Shoes y 0–4: rbox x 2..6, z −3..4, navy #1c2350, darker sole, strap y 4, gold #d9a640 buckle on outer side.
- Socks y 5–13: white #f4f6fb, x 2.5..5.5, z −2..2 (top hidden in skirt). Leg gap x −1..1.
- Petticoat frill y 12–14: white, flared ring slightly wider than hem, scalloped bottom.
- Skirt y 14–25: navy #24316a frustum, waist half-width 7 (x) / 5.5 (z) → hem 13 / 9; shell 2 thick;
  pleats = radius + cos(angle·N); gold band y 15–18 with cross/bow motifs + thin gold lines.
- Apron y 15–25: white panel 1 cell in front of skirt, half-width 5 → 7.5, scalloped frilled hem/sides;
  navy whale emblem at x 2..5, y 17..19 (NOT mirrored).
- Torso y 25–33: rbox x −6..6, z −4..4; white bib x −3..3 front; navy sash y 25–26;
  white Peter-Pan collar y 32–33; navy bow tie y 30–32 at z≈5 with short tails; 2–3 navy buttons; neck skin y 33–34.
- Arms: sleeve puff navy ellipsoid centre (±8, 29.5, 0) r≈3; white frill cuff y 23.5–25; hand skin x ±(8.5..10.5), y 20..23, z −1..1.
- Head: skull rbox x −9..9, y 34..52, z −9..8, r 4; skin #ffe1d9 face front at z 8 (front surface 8.5).
- Face decal (V3.girlFace): 64×40 px, 3 px/unit → 21.33×13.33 units, centred x 0, y 34.1..47.5, plane at z 8.56.
  Eyes px x 10..27 / 36..53, y 10..28 → design y 37.8–44.2; mouth y ≈35.2–37.2; blush y ≈36.2–37.5.
- Hair cap: rbox shell ≈2 cells around the skull; erase face window (z > 5, |x| ≤ 8, y < 47).
- Bangs: z 8..10 (in front of the decal), x −11..11, top y 51; jagged bottom ≈44–45 over the eyes,
  centre strand down to ≈41, outer strands longer and curving around the temples; per-column depth jitter.
- Side locks: 3 wavy tubes per side from the temple (x ±9..10, y 46) down to y 19–24, widening to x ±14–15,
  wave amplitude ≈1.5, radius 2–3; colour gradient navy → sky blue below y≈30, lighter tips.
- Back hair: cap covers the head above y 38; curtain below the nape x half-width 12 → 14, z −9..−13,
  scalloped bottom y≈18–21, darker vertical strand grooves, same gradient. Bone hairBack.
- Back bow: white, y 24–30, z −10..−13, two loops + knot + tails, drawn over the hair.
- Tail: navy tube (1,21,−5) → down/back (6,15,−12) → up (13,22,−14), radius 3 → 1.8, white underside;
  fluke = two flattened lobes at ≈(14,25,−15). Seen on the viewer's right in front view and in left-side view.
- Ahoge: navy tube from (0,53,0) curling up to y≈58 (hook shape).
- Headband: white frilled arc around (0,43,−1), radius ≈12 in the x-y plane, angle ≈20°..160°, z −1..3,
  alternating puffs; light-blue #4fa8e8 bows at (±11, 47, 2), ≈3×3×2.
- Fin ears: navy #1e2a56, x ±10..±19.5, y 40..46 tapering to the tip (y 44–45), z 3..8 tapering; white bottom 1–2 rows.

## Palette
hair dark #1e2a56 · mid #2c48a0 / #3a5aa9 · light #6fc3f5 · tip #b8e6f8 · dress #24316a · skin #ffe1d9 ·
white #ffffff · frill shade #e6eaf2 · gold #d9a640 · shoe #1c2350 · bow blue #4fa8e8. Credit: whale-girl-sheet
by 上善无形 / ZipZipPipe (CC BY-NC-SA 4.0).

## Bones (pivot design coords, parent index)
0 hips (0,14,0) −1 · 1 chest (0,25,0) 0 · 2 head (0,34,0) 1 · 3 armR (−7,31,0) 1 · 4 armL (7,31,0) 1 ·
5 legR (−4,14,0) 0 · 6 legL (4,14,0) 0 · 7 hairBack (0,38,−9) 2 · 8 tail1 (0,21,−5) 0 · 9 tail2 (6,16,−11) 8 ·
10 tail3 (12,21,−14) 9. Skirt, petticoat, apron, back bow live on hips.

## Part tags (tree order)
小鲸鱼/头/{刘海, 侧发, 头顶头发, 呆毛, 头饰, 蝴蝶结, 鲸鳍耳, 脸, 脸/眼睛, 脸/嘴, 脸/腮红} · 小鲸鱼/后发 ·
小鲸鱼/身体/{领子, 领结, 上衣, 纽扣, 脖子} · 小鲸鱼/手臂/{泡泡袖, 袖口, 手} ·
小鲸鱼/裙子/{围裙, 围裙/鲸鱼图案, 裙摆, 金色刺绣, 衬裙} · 小鲸鱼/背后蝴蝶结 ·
小鲸鱼/腿/{袜子, 鞋, 鞋扣} · 小鲸鱼/尾巴/{尾巴, 尾鳍, 白色腹面}.

## Views (orbit az/el/dist, target)
front az 0 el 0.08 dist≈4.2 target [0,0.62,0] · side az π/2 (her left, tail visible) · back az π ·
q34 az 0.6 el 0.15 · face target [0,0.88,0] dist 1.6.

## Runtime
Face decal = CanvasTexture W×H, NearestFilter, SRGB; MeshStandardMaterial transparent, alphaTest 0.02,
polygonOffset; child of head bone; userData.part '小鲸鱼/头/脸'; resolveHit uv→px→regions (眼睛/嘴/腮红).
Fallback simple face when V3.girlFace is missing. Idle: chest/head bob, hair + tail sway, random blink;
poses stand / wave / walk; states expr (V3.girlFace.exprs) + pose.
