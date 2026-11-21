// 06-env.js — V3.env：时钟、太阳/月亮位置与月相、日出日落、按太阳高度的天色/光色调色板。
// 移植自 v1 的 06-env.js（天文 + 调色板 + 天气部分；天气：setWeather(v)，实时天气取 Open-Meteo，见文件后部）。
// 颜色一律是 THREE.Color 线性 HDR（直接写 r/g/b，不做色彩空间转换），按 ACES 调过。
// 坐标：sunDir/moonDir 指向天体；北 = −z，东 = +x，上 = +y。地点读 V3.layout.sky（懒读取，40-layout 比本文件晚加载）。
// 每帧由场景调用 V3.env.update(dt)；切换时间由场景调 V3.env.setTime(v)。
(function (V3) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, HOUR = 3600000, DAY = 86400000;
  const DEF = { lat: 35.41, lon: 116.59, tz: 'Asia/Shanghai' };          // 济宁（默认地点）

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const num = (v, d) => { const n = (v === null || v === undefined || v === '') ? NaN : +v; return isFinite(n) ? n : d; };
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const Vec = (x, y, z) => new THREE.Vector3(x, y, z);
  const Col = (r, g, b) => { const c = new THREE.Color(); c.r = r; c.g = g; c.b = b; return c; };   // 线性，不转换
  let chosenSite = null;
  function site() {
    const s = chosenSite || (V3.layout && V3.layout.sky) || {};
    const lon = clamp(num(s.lon, DEF.lon), -180, 180);
    // 没写 tz：在济宁附近就用北京时间，否则按经度估算时区（tz 为空 → Intl 失败 → 走经度）
    const tz = typeof s.tz === 'string' && s.tz ? s.tz : Math.abs(lon - DEF.lon) < 7.5 ? DEF.tz : '';
    return { lat: clamp(num(s.lat, DEF.lat), -89.5, 89.5), lon, tz };
  }

  // ---------------------------------------------------------------- 时区 + 时钟
  const fmtCache = {};
  let offMap = {}, offN = 0;
  function fmt(tz) {
    if (fmtCache[tz] !== undefined) return fmtCache[tz];
    let f = null;
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { f = null; }
    return (fmtCache[tz] = f);
  }
  function tzOff(ms, tz, lon) {            // 时刻 ms 的 UTC 偏移（分钟，东正），每 15 分钟缓存一次
    const f = tz ? fmt(tz) : null, key = tz + '|' + (f ? '' : lon) + '|' + Math.floor(ms / 900000);
    if (offMap[key] !== undefined) return offMap[key];
    let off = Math.round(lon / 15) * 60;   // 兜底：按经度
    if (f) {
      try {
        const p = {};
        for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
        const w = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
        off = Math.round((w - Math.floor(ms / 1000) * 1000) / 60000);
      } catch (e) { /* 保留经度估算 */ }
    }
    if (++offN > 256) { offMap = {}; offN = 0; }
    return (offMap[key] = off);
  }
  function localInfo(ms) {                 // 时刻 ms 在当地的年月日、小时
    const s = site(), off = tzOff(ms, s.tz, s.lon), d = new Date(ms + off * 60000);
    const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1, D = d.getUTCDate();
    return { Y, M, D, off, day: Y + '-' + pad(M) + '-' + pad(D),
      hour: d.getUTCHours() + d.getUTCMinutes() / 60 + (d.getUTCSeconds() + d.getUTCMilliseconds() / 1000) / 3600 };
  }
  function fromLocal(Y, M, D, h) {         // 当地 Y-M-D 的 h 点（可 <0 或 >24，自动跨日）→ 时刻 ms
    const s = site(), guess = Date.UTC(Y, M - 1, D) + h * HOUR;
    const o1 = tzOff(guess, s.tz, s.lon), t = guess - o1 * 60000, o2 = tzOff(t, s.tz, s.lon);
    return o2 === o1 ? t : guess - o2 * 60000;
  }
  // 基准日期：?date=YYYY-MM-DD 固定日历日（预设和 'HH:MM' 都落在这一天），否则用当前场景时刻所在的当地日期
  function baseDay(ms) {
    const q = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(V3.util.qs('date', '') || '').trim());
    return q ? { Y: +q[1], M: +q[2], D: +q[3] } : localInfo(ms);
  }
  function parseTime(v, ms) {              // Date | 毫秒 | 小时数 | 'HH:MM[:SS]' | 'YYYY-MM-DD[ HH:MM]' | ISO → ms
    if (v instanceof Date) return v.getTime();
    const at = (h) => { const L = baseDay(ms); return fromLocal(L.Y, L.M, L.D, h); };
    if (typeof v === 'number') return !isFinite(v) ? NaN : Math.abs(v) > 1e7 ? v : at(clamp(v, 0, 24));
    const s = String(v == null ? '' : v).trim();
    let m;
    if ((m = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/.exec(s)) && (m[2] !== undefined || +m[1] <= 24))
      return at(clamp(+m[1] + num(m[2], 0) / 60 + num(m[3], 0) / 3600, 0, 24));
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)))
      return fromLocal(+m[1], +m[2], +m[3], num(m[4], 12) + num(m[5], 0) / 60 + num(m[6], 0) / 3600);
    if (/^\d+(\.\d+)?$/.test(s)) return parseTime(+s, ms);
    const p = Date.parse(s);
    return isFinite(p) ? p : NaN;
  }

  // ---------------------------------------------------------------- 天文
  // NOAA 太阳位置（赤纬 + 均时差）；低精度月亮（Schlyter 轨道根数 + 主要摄动）→ 高度/方位、月相、被照亮比例
  const jdOf = (ms) => ms / DAY + 2440587.5;
  const utcMinOf = (ms) => (((ms % DAY) + DAY) % DAY) / 60000;
  function solarEq(ms) {                   // { decl（弧度）, eot（分钟）, lam（视黄经，度）, eps（弧度）}
    const T = (jdOf(ms) - 2451545) / 36525;
    const L0 = ((280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360 + 360) % 360;
    const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * D2R;
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const Ceq = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M) * (0.019993 - 0.000101 * T) +
      Math.sin(3 * M) * 0.000289;
    const om = (125.04 - 1934.136 * T) * D2R;
    const lam = L0 + Ceq - 0.00569 - 0.00478 * Math.sin(om);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = (eps0 + 0.00256 * Math.cos(om)) * D2R;
    const L0r = L0 * D2R;
    let y = Math.tan(eps / 2); y *= y;
    const eot = 4 * R2D * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(M) + 4 * e * y * Math.sin(M) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * M));
    return { decl: Math.asin(Math.sin(eps) * Math.sin(lam * D2R)), eot, lam, eps };
  }
  function horiz(latR, decl, H) {          // → { alt, az }（度）；方位从正北顺时针（东 = 90）
    const alt = Math.asin(clamp(Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(H), -1, 1));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR));
    return { alt: alt * R2D, az: ((az * R2D + 180) % 360 + 360) % 360 };
  }
  function sunPos(ms, s) {
    const q = solarEq(ms), tst = utcMinOf(ms) + q.eot + 4 * s.lon;    // 真太阳时（分钟）
    const h = horiz(s.lat * D2R, q.decl, (tst / 4 - 180) * D2R);
    h.decl = q.decl; h.eot = q.eot;
    return h;
  }
  function moonPos(ms, s) {
    const d = jdOf(ms) - 2451543.5, S = Math.sin, Cs = Math.cos;
    const N = (125.1228 - 0.0529538083 * d) * D2R, inc = 5.1454 * D2R, w = (318.0634 + 0.1643573223 * d) * D2R;
    const e = 0.0549, Mm = ((115.3654 + 13.0649929509 * d) % 360) * D2R;
    let E = Mm + e * S(Mm) * (1 + e * Cs(Mm));
    for (let k = 0; k < 4; k++) E -= (E - e * S(E) - Mm) / (1 - e * Cs(E));
    const v = Math.atan2(Math.sqrt(1 - e * e) * S(E), Cs(E) - e), vw = v + w;
    const xh = Cs(N) * Cs(vw) - S(N) * S(vw) * Cs(inc);
    const yh = S(N) * Cs(vw) + Cs(N) * S(vw) * Cs(inc), zh = S(vw) * S(inc);
    let lon = Math.atan2(yh, xh) * R2D, lat = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * R2D;
    const Ms = ((356.047 + 0.9856002585 * d) % 360) * D2R, Ls = Ms + (282.9404 + 4.70935e-5 * d) * D2R;
    const Lm = Mm + w + N, Dm = Lm - Ls, F = Lm - N;
    lon += -1.274 * S(Mm - 2 * Dm) + 0.658 * S(2 * Dm) - 0.186 * S(Ms) - 0.059 * S(2 * Mm - 2 * Dm) -
      0.057 * S(Mm - 2 * Dm + Ms) + 0.053 * S(Mm + 2 * Dm) + 0.046 * S(2 * Dm - Ms) + 0.041 * S(Mm - Ms) -
      0.035 * S(Dm) - 0.031 * S(Mm + Ms) - 0.015 * S(2 * F - 2 * Dm) + 0.011 * S(Mm - 4 * Dm);
    lat += -0.173 * S(F - 2 * Dm) - 0.055 * S(Mm - F - 2 * Dm) - 0.046 * S(Mm + F - 2 * Dm) +
      0.033 * S(F + 2 * Dm) + 0.017 * S(2 * Mm + F);
    const q = solarEq(ms), elong = ((lon - q.lam) % 360 + 360) % 360;   // 0 新月 → 180 满月
    const lr = lon * D2R, br = lat * D2R, eps = q.eps;
    const ra = Math.atan2(S(lr) * Cs(eps) - Math.tan(br) * S(eps), Cs(lr));
    const dec = Math.asin(clamp(S(br) * Cs(eps) + Cs(br) * S(eps) * S(lr), -1, 1));
    const h = horiz(s.lat * D2R, dec, (gmst(ms) + s.lon) * D2R - ra);
    h.alt -= 0.95 * Cs(h.alt * D2R);                                     // 站心视差
    h.phase = elong / 360;
    h.illum = (1 - Cs(br) * Cs(elong * D2R)) / 2;
    return h;
  }
  function gmst(ms) {                     // 格林尼治平恒星时（度），月亮和星图共用
    const d = jdOf(+ms) - 2451545, T = d / 36525;
    return ((280.46061837 + 360.98564736629 * d + 0.000387933 * T * T) % 360 + 360) % 360;
  }
  function solarTimes(Y, M, D, s) {        // 当地 Y-M-D 的晨光始/日出/正午/日落/昏影终（当地小时；极昼/极夜时夹到正午 ±0/12 小时）
    const latR = s.lat * D2R, day0 = fromLocal(Y, M, D, 0);
    let noon = fromLocal(Y, M, D, 12);
    for (let k = 0; k < 3; k++) {          // 太阳正午：真太阳时 = 720 分钟
      const q = solarEq(noon), x = utcMinOf(noon) + q.eot + 4 * s.lon - 720;
      noon -= ((x % 1440 + 2160) % 1440 - 720) * 60000;
    }
    const hourOf = (t) => (t - day0) / HOUR;
    const at = (altDeg, sign) => {
      let t = noon;
      for (let k = 0; k < 2; k++) {
        const dq = solarEq(t).decl;
        const c = (Math.sin(altDeg * D2R) - Math.sin(latR) * Math.sin(dq)) / (Math.cos(latR) * Math.cos(dq));
        t = noon + sign * Math.acos(clamp(c, -1, 1)) * R2D * 240000;   // 时角 1° = 4 分钟
      }
      return hourOf(t);
    };
    return { dawn: at(-6, -1), sunrise: at(-0.833, -1), noon: hourOf(noon), sunset: at(-0.833, 1), dusk: at(-6, 1) };
  }
  function dirOf(alt, az, out) {           // 高度/方位（度）→ 指向天体的单位向量（北 = −z，东 = +x）
    const a = alt * D2R, z = az * D2R, c = Math.cos(a);
    return out.set(c * Math.sin(z), Math.sin(a), -c * Math.cos(z));
  }

  // ---------------------------------------------------------------- 调色板（线性 HDR，按 ACES 调；只有晴天）
  const PAL = [   // 太阳高度（度）| 天顶 rgb | 地平线 rgb
    [-18, 0.010, 0.017, 0.062, 0.016, 0.030, 0.095],         // 夜：藏青
    [-12, 0.012, 0.030, 0.120, 0.030, 0.060, 0.185],         // 蓝调尾声
    [-8, 0.020, 0.040, 0.140, 0.070, 0.065, 0.200],          // 蓝调时刻
    [-6, 0.030, 0.055, 0.185, 0.170, 0.105, 0.230],          // 蓝紫
    [-4, 0.040, 0.070, 0.230, 0.420, 0.210, 0.240],          // 晨昏：玫瑰
    [-1, 0.075, 0.110, 0.330, 0.950, 0.270, 0.210],          // 日落：珊瑚粉
    [2, 0.120, 0.170, 0.420, 1.250, 0.400, 0.180],           // 橙
    [6, 0.150, 0.250, 0.560, 1.200, 0.500, 0.270],           // 黄金时刻：金桃
    [12, 0.110, 0.290, 0.720, 0.850, 0.620, 0.700],          // 淡暖
    [25, 0.075, 0.250, 0.760, 0.360, 0.620, 1.550],          // 上午天蓝（ACES 会压平，所以故意偏饱和）
    [45, 0.055, 0.220, 0.760, 0.320, 0.590, 1.640],          // 正午：深蓝压着天蓝
    [90, 0.045, 0.200, 0.740, 0.300, 0.570, 1.620]];
  const SUN = [[-4, 0, 0, 0], [-1.5, 0.12, 0.035, 0.012], [0, 0.45, 0.14, 0.04], [2, 1.05, 0.42, 0.14],
    [5, 1.6, 0.8, 0.36], [10, 2.0, 1.25, 0.72], [20, 2.35, 1.82, 1.32], [35, 2.5, 2.2, 1.8], [60, 2.6, 2.4, 2.1],
    [90, 2.65, 2.45, 2.2]];
  const MOONC = [0.26, 0.36, 0.62];
  const NIGHT_AMB = [0.022, 0.034, 0.075];   // v3 新增：夜间环境光的深蓝底，墙在夜里是能看清的深蓝而不是死黑
  function tab(T, x, out, o) {             // 按太阳高度分段线性查表
    let i = 0;
    while (i < T.length - 2 && x > T[i + 1][0]) i++;
    const a = T[i], b = T[i + 1], t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
    out.r = lerp(a[o], b[o], t); out.g = lerp(a[o + 1], b[o + 1], t); out.b = lerp(a[o + 2], b[o + 2], t);
    return out;
  }
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const keyDir = (out, d, minY) => { out.copy(d); if (out.y < minY) out.y = minY; return out.normalize(); };
  const FALLBACK = Vec(0.3, 0.78, 0.55).normalize();      // 月亮在地平线下时：南偏东的高空天光
  const tmpD = Vec(0, 1, 0);
  const mixTo = (c, r, g, b, t) => { if (t > 0) { c.r += (r - c.r) * t; c.g += (g - c.g) * t; c.b += (b - c.b) * t; } };
  function palette(st) {
    const a = st.sunAlt, sky = st.sky, z = sky.zenith, h = sky.horizon, wx = st.wx;
    const oc = sstep(0.5, 0.95, wx.cloud), sm = wx.storm, fg = wx.fog, rn = wx.rain;   // 天气（v1 同款）：阴、雷雨、雾、雨
    const mUp = sstep(-2, 12, st.moonAlt) * st.moonIllum;
    const nv = 1 - sstep(-10, -2, a);      // v1 的夜晚系数：天色、调色用
    st.night = 1 - sstep(-7, 4, a);        // v3 对外的 night：日落前后灯就开始亮（场景 lampK 用它）
    tab(PAL, a, z, 1); tab(PAL, a, h, 4);
    st.golden = sstep(-3, 2, a) * (1 - sstep(10, 24, a)) * (1 - 0.85 * oc) * (1 - sm);   // 阴天、雷雨没有金色
    const gw = st.golden * (st.sunAz > 180 ? 1 : -1);                    // 傍晚比清晨更橙一点
    h.r *= 1 + 0.06 * gw; h.b *= 1 - 0.08 * gw;
    const dw = st.sunAz < 180 ? sstep(-9, -5, a) * (1 - sstep(-2, 1, a)) : 0;   // 黎明偏桃玫瑰，黄昏保持紫
    h.r *= 1 + 0.25 * dw; h.g *= 1 + 0.35 * dw; h.b *= 1 - 0.25 * dw; z.r *= 1 + 0.2 * dw;
    z.r += 0.012 * mUp * nv; z.g += 0.022 * mUp * nv; z.b += 0.05 * mUp * nv;   // 月光照亮的夜空
    h.r += 0.02 * mUp * nv; h.g += 0.03 * mUp * nv; h.b += 0.055 * mUp * nv;
    // 天气（v1）：阴天 → 冷灰、略暗；雷雨 → 深石板灰；雾 → 当前天色上的一层白纱；下雨再暗一点
    const Yw = Math.max(0.6 * lum(z) + 0.4 * lum(h), 0.012), tb = lerp(1.04, 1.3, nv), tr = lerp(0.97, 0.8, nv);
    mixTo(z, Yw * 0.85 * tr, Yw * 0.85, Yw * 0.85 * tb, oc * 0.95);
    mixTo(h, Yw * 0.80 * tr, Yw * 0.80, Yw * 0.80 * tb, oc * 0.95);
    mixTo(z, Yw * 0.30, Yw * 0.33, Yw * 0.40, sm * 0.9);           // 雷雨：深石板灰（比 v1 亮一点，房子还看得清；闪电再一亮）
    mixTo(h, Yw * 0.36, Yw * 0.40, Yw * 0.48, sm * 0.88);
    const Yh = lum(h);
    mixTo(h, Yh * 1.15, Yh * 1.15, Yh * 1.18, fg * 0.75); mixTo(z, Yh, Yh, Yh * 1.04, fg * 0.55);
    const rd = 1 - 0.22 * rn * (1 - sm); z.multiplyScalar(rd); h.multiplyScalar(rd);
    sky.ground.copy(h).multiplyScalar(lerp(0.22, 0.45, sstep(-6, 20, a)) * (1 - 0.25 * oc) * (1 - 0.3 * sm));   // 地面反弹 / 地平线下背景
    mixTo(sky.ground, Yh * 0.9, Yh * 0.92, Yh * 0.98, 0.5 * wx.snow);         // 下雪：地面反光更亮
    tab(SUN, a, sky.sun, 1);
    // 云挡太阳：多云少挡一点，阴天几乎全挡，雷雨、雾也挡；阴天的太阳光同时发灰
    const sunVis = (1 - 0.15 * sstep(0.15, 0.6, wx.cloud)) * (1 - 0.88 * oc) * (1 - 0.65 * sm) * (1 - 0.55 * fg);
    const sl = lum(sky.sun); mixTo(sky.sun, sl, sl, sl * 1.04, 0.5 * oc); sky.sun.multiplyScalar(sunVis);
    st.sunVis = sunVis;
    // 月光；月亮在地平线下时退成南方高空的一点天光（云一样挡月光）
    const mk = (0.25 + 0.75 * st.moonIllum) * lerp(0.55, 1, sstep(-2, 10, st.moonAlt)) * sstep(-4, -10, a) * sunVis;
    sky.moon.r = MOONC[0] * mk; sky.moon.g = MOONC[1] * mk; sky.moon.b = MOONC[2] * mk;
    tmpD.copy(FALLBACK).lerp(st.moonDir, sstep(2, 10, st.moonAlt));
    keyDir(st.moonLightDir, tmpD, 0.12);
    keyDir(st.sunLightDir, st.sunDir, 0.08);
    st.key = a > -4 ? 'sun' : 'moon';      // 主光（投影的那一盏）
    st.lightDir.copy(st.key === 'sun' ? st.sunLightDir : st.moonLightDir);
    // 环境光：天顶和地平线各半，去掉 45% 饱和度；入夜后垫一层深蓝底
    const amb = sky.ambient;
    amb.r = 0.5 * (z.r + h.r); amb.g = 0.5 * (z.g + h.g); amb.b = 0.5 * (z.b + h.b);
    const Y = lum(amb), nf = 1 - sstep(-12, -3, a);
    amb.r = lerp(amb.r, Y, 0.45) + NIGHT_AMB[0] * nf;
    amb.g = lerp(amb.g, Y, 0.45) + NIGHT_AMB[1] * nf;
    amb.b = lerp(amb.b, Y, 0.45) + NIGHT_AMB[2] * nf;
    st.fog.color.copy(h).lerp(z, 0.25);
    st.fog.density = 0.004 + 0.003 * oc + 0.003 * rn + 0.002 * sm + 0.013 * fg + 0.005 * wx.snow;   // 雾天远处发白（hero 50 m 处约一半）
    st.stars = sstep(-4, -14, a) * (1 - 0.45 * mUp) * (1 - sstep(0.4, 0.9, wx.cloud)) * (1 - 0.9 * fg);
    st.exposure = lerp(1.85, 1, sstep(-10, 15, a)) * (1 - 0.1 * sstep(15, 40, a))    // 太阳高了再收 10%，正午沙子不发白
      * (1 - 0.06 * oc - 0.06 * sm - 0.04 * rn * (1 - sm));                       // 阴雨天整体暗一点（光已经弱了，曝光只再收一点）
    const gr = st.grade;
    gr.warm = clamp(0.75 * st.golden - 0.12 * nv * (1 - 0.5 * oc), -1, 1);       // 夜里蓝色交给月光，灯保持琥珀色
    gr.sat = clamp(1 + 0.12 * st.golden - 0.25 * oc - 0.15 * sm - 0.2 * fg - 0.08 * nv, 0.4, 1.4);
    gr.lift = 0.02 * nv + 0.03 * fg + 0.015 * oc;
  }

  // ---------------------------------------------------------------- 状态 + API
  const state = {
    ms: Date.now(), hour: 12, day: '', mode: 'manual', preset: 'golden', version: 0,
    // 天气：mode = 选的（'real' | 某一种），kind = 正在下的那种；cloud/rain/snow/fog/storm 0..1 平滑过渡
    wx: { mode: 'clear', kind: 'clear', cloud: 0.08, rain: 0, snow: 0, fog: 0, storm: 0, tempC: null, code: 0, src: 'manual', at: 0 },
    sunVis: 1,                             // 云挡住后剩下的太阳/月亮光（0..1）
    sunDir: Vec(0, 1, 0), sunAlt: 45, sunAz: 180,
    moonDir: Vec(0, -1, 0), moonAlt: -45, moonAz: 0, moonPhase: 0.5, moonIllum: 1,
    sunShow: Vec(0, 1, 0), moonShow: Vec(0, -1, 0), showDip: 0,     // 画日月用的方向（见下面 show()）
    night: 0, golden: 0, stars: 0, exposure: 1,
    sky: { zenith: Col(0.06, 0.22, 0.76), horizon: Col(0.32, 0.59, 1.64), sun: Col(2.5, 2.2, 1.8),
      ambient: Col(0.3, 0.4, 0.7), ground: Col(0.14, 0.26, 0.7), moon: Col(0, 0, 0) },
    key: 'sun', lightDir: Vec(0, 1, 0), sunLightDir: Vec(0, 1, 0), moonLightDir: Vec(0, 1, 0),
    fog: { color: Col(0.25, 0.5, 1.4), density: 0.004 },
    grade: { warm: 0, sat: 1, lift: 0 },
    times: { dawn: 6, sunrise: 6.5, noon: 12, sunset: 17.5, dusk: 18 },
    wind: { speed: 0, gust: 0, dir: [-0.33, -0.94], angle: -1.91, t: 0 },
  };
  let timesKey = '', lastCalc = 0;
  function recalc() {
    const s = site(), L = localInfo(state.ms);
    state.hour = L.hour; state.day = L.day;
    const sp = sunPos(state.ms, s), mp = moonPos(state.ms, s);
    state.sunAlt = sp.alt; state.sunAz = sp.az; dirOf(sp.alt, sp.az, state.sunDir);
    state.moonAlt = mp.alt; state.moonAz = mp.az; dirOf(mp.alt, mp.az, state.moonDir);
    state.moonPhase = mp.phase; state.moonIllum = mp.illum;
    const key = L.day + '|' + s.lat + '|' + s.lon + '|' + s.tz;
    if (key !== timesKey) { timesKey = key; Object.assign(state.times, solarTimes(L.Y, L.M, L.D, s)); }
    palette(state);
    show();                                // 画日月的方向（沿用上一次的 dip；天空每帧会按镜头高度再算一次）
    state.version++;
    lastCalc = performance.now();
  }
  // 预设 → 当地小时（落在基准日期上）。非 real 的预设时间不走。
  const PRESETS = {
    golden: (t) => t.sunset - 50 / 60,     // 日落前 50 分钟（默认）
    dawn: (t) => t.sunrise + 20 / 60,      // 日出后 20 分钟
    morning: () => 9,
    noon: () => 12.5,
    dusk: (t) => t.sunset + 15 / 60,       // 日落后 15 分钟
    night: () => 22,
  };
  function presetMs(name) {
    const B = baseDay(Date.now()), t = solarTimes(B.Y, B.M, B.D, site());   // presets: always today (or ?date=), never the last chosen day
    return fromLocal(B.Y, B.M, B.D, PRESETS[name](t));
  }
  // setTime(预设名 | 'real' | 'HH:MM' | 'YYYY-MM-DD[ HH:MM]' | Date | 毫秒) → 成功 true / 无法解析 false
  function setTime(v) {
    if (v == null || v === '') v = 'golden';
    const k = typeof v === 'string' ? v.trim().toLowerCase() : v;
    let ms, mode = 'manual', preset = 'custom';
    if (k === 'real' || k === 'now') { ms = Date.now(); mode = 'real'; preset = 'real'; }
    else if (typeof k === 'string' && PRESETS[k]) { ms = presetMs(k); preset = k; }
    else ms = parseTime(v, state.ms);
    if (!isFinite(ms)) return false;
    state.ms = ms; state.mode = mode; state.preset = preset;
    recalc();
    try { V3.emit('env', state); } catch (e) { V3.err('env.emit: ' + e); }
    return true;
  }
  // ---------------------------------------------------------------- 风（v3 新增；按帧时间走，和天文时间无关）
  // state.wind = { speed 0..1 总风力（含阵风）, gust 0..1 阵风包络（5–15 秒来一阵）,
  //   dir [x, z] 风吹向的方向（单位向量；默认从东南海上吹向陆地 ≈ 向北略偏西）, angle = atan2(z, x), t 风的时钟（秒） }
  const WIND = {
    scale: 1,            // 总风力（0 = 无风，2 = 大风）；URL ?wind=0..2
    base: 0.3,           // 平时的风
    gust: 0.65,          // 阵风叠加的最大值
    gap: [5, 15],        // 两阵风开始的间隔（秒）
    dir: -1.91,          // 基本方向角 atan2(z, x)
    veer: 0.35,          // 方向慢慢摆动的幅度（弧度）
  };
  try { const q = parseFloat(V3.util && V3.util.qs ? V3.util.qs('wind', '') : ''); if (isFinite(q)) WIND.scale = clamp(q, 0, 2); } catch (e) { /* 没有 URL 参数 */ }
  const wh = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };   // 固定种子：每次打开都一样
  const wn = (x) => { const i = Math.floor(x), f = x - i; return lerp(wh(i), wh(i + 1), f * f * (3 - 2 * f)) * 2 - 1; };   // 平滑噪声 −1..1
  const G = { i: 0, t0: -99, len: 1, amp: 0, next: 2, k: 1 };   // 当前这阵风：序号、开始、持续、强度；下一阵开始的时间；间隔倍数（雷雨更密）
  function gustAt(t) {
    let n = 0;
    while (t >= G.next && n++ < 64) {
      G.t0 = G.next; G.i++;
      const gap = lerp(WIND.gap[0], WIND.gap[1], wh(G.i * 3.1 + 0.5)) * G.k;
      G.len = Math.min(gap * 0.75, 2.5 + 3.5 * wh(G.i * 7.7 + 1.3));   // 2.5–6 秒，总在下一阵之前结束
      G.amp = 0.55 + 0.45 * wh(G.i * 5.3 + 2.9);
      G.next = G.t0 + gap;
    }
    const x = (t - G.t0) / G.len;
    if (!(x >= 0 && x <= 1)) return 0;
    return G.amp * (x < 0.25 ? sstep(0, 0.25, x) : 1 - sstep(0.25, 1, x));   // 快起慢落
  }
  function stepWind(dt) {
    const W = state.wind, P = WIND, k = clamp(+P.scale || 0, 0, 2), wx = state.wx;
    const live = wx.mode === 'real' && LIVE.wind;            // 实时天气：真实风速、风向当底子
    const sm = wx.storm, rn = wx.rain;
    G.k = 1 - 0.5 * sm;                                      // 雷雨：阵风间隔减半
    W.t += clamp(isFinite(dt) ? dt : 0, 0, 0.25);
    const t = W.t, g = gustAt(t);
    const base = clamp((live ? live.base : P.base) + 0.35 * sm + 0.1 * rn, 0, 0.85);   // 雷雨、下雨风更大
    const calm = base * (0.75 + 0.25 * wn(t * 0.07 + 3)) + 0.05 * wn(t * 0.6 + 9);    // 平时的风慢慢起伏
    const flutter = 0.06 * wn(t * 2.3 + 17) * (0.3 + g);                             // 阵风里的抖动
    W.gust = clamp(g * k, 0, 1);
    W.speed = clamp(k * (calm + P.gust * (1 + 0.35 * sm) * g + flutter), 0, 1);
    const a = (live ? live.dir : P.dir) + P.veer * wn(t * 0.05 + 41) + 0.25 * g * wn(G.i * 1.7);   // 方向慢摆，每阵风再偏一点
    W.angle = a; W.dir[0] = Math.cos(a); W.dir[1] = Math.sin(a);
  }
  // ---------------------------------------------------------------- 天气（移植自 v1 的 06-env.js 天气部分）
  // setWeather('real' | 'clear' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'storm' | 'snow')
  // state.wx = { mode, kind, cloud, rain, snow, fog, storm（0..1 平滑过渡）, tempC, code（WMO）, src: 'live'|'cache'|'manual'|'fallback', at（毫秒） }
  // 实时：Open-Meteo（有 CORS，file:// 也行），经纬度用 V3.layout.sky；localStorage 缓存 20 分钟，每 15 分钟刷新；
  // 离线用缓存，没缓存当 clear。截图（navigator.webdriver）不联网也不读缓存，除非 ?wxlive=1 —— 保证截图可复现。
  const WX = {                             // 各天气的目标值 [cloud, rain, storm, snow, fog]（v1 同款，加了小雨）
    clear: [0.08, 0, 0, 0, 0], cloudy: [0.5, 0, 0, 0, 0], overcast: [0.92, 0, 0, 0, 0.08], fog: [0.7, 0, 0, 0, 1],
    drizzle: [0.88, 0.35, 0, 0, 0.12], rain: [0.95, 0.75, 0, 0, 0.15], storm: [1, 1, 1, 0, 0.2], snow: [0.9, 0, 0, 0.8, 0.12],
  };
  const WX_CODE = { clear: 0, cloudy: 2, overcast: 3, fog: 45, drizzle: 53, rain: 63, storm: 95, snow: 73 };
  const WX_CR = { clear: [0, 0.3], cloudy: [0.25, 0.78], overcast: [0.8, 1], fog: [0.5, 1], drizzle: [0.75, 1],
    rain: [0.8, 1], storm: [0.95, 1], snow: [0.8, 1] };             // 真实云量夹在这个范围里
  const WX_RAIN = { 51: 0.25, 53: 0.35, 55: 0.45, 56: 0.3, 57: 0.45, 61: 0.55, 63: 0.75, 65: 0.95, 66: 0.55, 67: 0.9,
    80: 0.6, 81: 0.8, 82: 1 }, WX_SNOW = { 71: 0.5, 73: 0.75, 75: 1, 77: 0.4, 85: 0.6, 86: 0.95 };
  const WXP = { fade: 3, ttl: 20 * 60e3, every: 15 * 60e3, retry: 5 * 60e3, timeout: 8000, key: 'v3.wx.' };
  function wmo(code) {                     // WMO 天气码 → kind
    const c = Math.round(num(code, -1));
    if (c < 0) return null;
    if (c === 0) return 'clear';
    if (c === 1 || c === 2) return 'cloudy';
    if (c === 3) return 'overcast';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95 && c <= 99) return 'storm';
    return 'cloudy';
  }
  function parseWx(j) {                    // Open-Meteo 的 JSON（或它的 current）→ { kind, code, t[5], tempC, ws km/h, wd 度（吹来的方向） }
    let w = j && j.current && typeof j.current === 'object' ? j.current : j;
    if (!w || typeof w !== 'object') return null;
    const code = num(w.weather_code, num(w.weathercode, NaN)), kind = wmo(code);
    if (!kind) return null;
    const c = Math.round(code), t = WX[kind].slice(), R = WX_CR[kind];
    if (WX_RAIN[c] !== undefined) t[1] = WX_RAIN[c];
    if (WX_SNOW[c] !== undefined) t[3] = WX_SNOW[c];
    if (c >= 95) t[2] = c === 95 ? 0.85 : c === 96 ? 0.95 : 1;
    const mm = num(w.precipitation, num(w.rain, NaN)), cc = num(w.cloud_cover, num(w.cloudcover, NaN));
    if (mm > 0 && t[1] > 0) t[1] = clamp(t[1] * 0.5 + (0.3 + mm / 8) * 0.5, 0.25, 1);
    if (isFinite(cc)) t[0] = clamp(lerp(t[0], cc / 100, 0.7), R[0], R[1]);
    return { kind, code: c, t, tempC: num(w.temperature_2m, null),
      ws: num(w.wind_speed_10m, NaN), wd: num(w.wind_direction_10m, NaN) };
  }
  const cacheKey = () => { const s = site(); return WXP.key + (+s.lat).toFixed(2) + ',' + (+s.lon).toFixed(2); };
  function cacheGet() {
    try { const o = JSON.parse(localStorage.getItem(cacheKey()) || 'null'); return o && o.at && o.json ? o : null; } catch (e) { return null; }
  }
  function cachePut(json, at) { try { localStorage.setItem(cacheKey(), JSON.stringify({ at, json })); } catch (e) { /* 隐私模式 */ } }
  const LIVE = { data: null, src: 'fallback', at: 0, next: 0, busy: false, wind: null, bot: null };
  const isBot = () => {
    if (LIVE.bot === null) {
      let b = false;
      try { b = !!(typeof navigator !== 'undefined' && navigator.webdriver) && V3.util.qs('wxlive', '') !== '1'; } catch (e) { b = false; }
      LIVE.bot = b;
    }
    return LIVE.bot;
  };
  function useLive(json, at, src) {        // 记下一份实时数据（含真实风）；返回是否可用
    const d = parseWx(json);
    if (!d) return false;
    LIVE.data = d; LIVE.at = at; LIVE.src = src;
    LIVE.wind = isFinite(d.ws) && isFinite(d.wd) ? {
      base: clamp(0.05 + d.ws / 60, 0.05, 0.8),                          // km/h → 0..1（15 km/h ≈ 平时的 0.3，45 km/h 就是很大的风）
      dir: Math.atan2(Math.cos(d.wd * Math.PI / 180), -Math.sin(d.wd * Math.PI / 180)),   // 吹来的方向 → 吹向的方向角 atan2(z, x)
    } : null;
    return true;
  }
  function fetchLive() {
    if (LIVE.busy || typeof fetch !== 'function') { LIVE.next = Date.now() + WXP.retry; return; }
    const s = site(), requested = cacheKey();
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + (+s.lat).toFixed(3) + '&longitude=' + (+s.lon).toFixed(3) +
      '&current=weather_code,cloud_cover,precipitation,rain,snowfall,wind_speed_10m,wind_direction_10m,temperature_2m&timezone=auto';
    LIVE.busy = true;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const to = setTimeout(() => { try { if (ac) ac.abort(); } catch (e) { /* 忽略 */ } }, WXP.timeout);
    fetch(url, ac ? { signal: ac.signal } : undefined)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => {
        if (requested !== cacheKey()) return;
        const now = Date.now();
        if (!useLive(j, now, 'live')) throw new Error('bad data');
        cachePut(j, now);
        LIVE.next = now + WXP.every;
        if (state.wx.mode === 'real') target('real', false);
      })
      .catch((e) => {                      // 离线 / 超时：留着缓存（或 clear），过一会儿再试；不算错误
        if (requested !== cacheKey()) return;
        LIVE.next = Date.now() + WXP.retry;
        try { console.warn('[env] 实时天气取不到：' + (e && e.message || e)); } catch (e2) { /* 忽略 */ }
      })
      .finally(() => { clearTimeout(to); LIVE.busy = false; });
  }
  let wxGoal = WX.clear.slice(), wxSnap = true, wxT0 = 0;   // 目标值；下一步直接跳到目标（开页、截图）；第一次 setWeather 的时刻
  const WX_CH = ['cloud', 'rain', 'storm', 'snow', 'fog'];
  function target(mode, snap) {            // 按 mode 定目标值和 kind / code / tempC / src / at
    const w = state.wx, before = w.kind + '|' + w.src;
    if (mode === 'real') {
      const d = LIVE.data;
      if (d) { wxGoal = d.t.slice(); w.kind = d.kind; w.code = d.code; w.tempC = d.tempC; w.src = LIVE.src; w.at = LIVE.at; }
      else { wxGoal = WX.clear.slice(); w.kind = 'clear'; w.code = 0; w.tempC = null; w.src = 'fallback'; w.at = 0; }
    } else {
      wxGoal = WX[mode].slice(); w.kind = mode; w.code = WX_CODE[mode]; w.tempC = null; w.src = 'manual'; w.at = Date.now();
    }
    if (snap || isBot() || (wxT0 && performance.now() - wxT0 < 6000)) wxSnap = true;   // 开页头几秒、截图：直接到位，不慢慢变
    if (w.kind + '|' + w.src !== before) { try { V3.emit('wx', w); } catch (e) { V3.err('env.wx: ' + e); } }
  }
  function setWeather(v) {                 // → 成功 true / 不认识 false
    let m = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (m === '' || m === 'auto' || m === 'live') m = 'real';
    if (m !== 'real' && !WX[m]) return false;
    if (!wxT0) wxT0 = performance.now();
    state.wx.mode = m;
    if (m === 'real' && !LIVE.data && !isBot()) {          // 先用缓存顶着（过期的也先用），再去取新的
      const c = cacheGet();
      if (c && useLive(c.json, c.at, 'cache')) LIVE.next = Date.now() - c.at < WXP.ttl ? c.at + WXP.every : 0;
    }
    target(m, false);
    if (m === 'real' && !isBot() && !LIVE.busy && Date.now() >= LIVE.next) fetchLive();
    stepWx(0);
    return true;
  }
  function stepWx(dt) {                    // 各通道指数趋近目标（时间常数 WXP.fade 秒）；有变化才重算调色板
    const w = state.wx;
    const k = wxSnap ? 1 : 1 - Math.exp(-Math.max(0, +dt || 0) / Math.max(0.05, WXP.fade));
    wxSnap = false;
    if (!(k > 0)) return;
    let moved = false;
    for (let i = 0; i < 5; i++) {
      const c = WX_CH[i], g = wxGoal[i], v = w[c];
      if (v === g) continue;
      w[c] = Math.abs(g - v) < 1e-3 ? g : v + (g - v) * k;
      moved = true;
    }
    if (moved) { palette(state); state.version++; }
  }
  function update(dt) {                    // 每帧：风、天气过渡总在走；天文只有 real 模式才走，约每秒重算一次
    stepWind(dt);
    stepWx(dt);
    if (state.wx.mode === 'real' && !LIVE.busy && !isBot() && Date.now() >= LIVE.next) fetchLive();
    if (state.mode !== 'real' || performance.now() - lastCalc < 1000) return;
    state.ms = Date.now();
    recalc();
  }
  function solar() {                       // 当天的日出/日落等（当地小时）
    const t = state.times;
    return { sunrise: t.sunrise, sunset: t.sunset, dawn: t.dawn, noon: t.noon, dusk: t.dusk, day: state.day };
  }
  const hhmm = (h) => {
    if (!isFinite(h)) return '--:--';
    const m = Math.round((((h % 24) + 24) % 24) * 60);
    return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
  };
  // ---------------------------------------------------------------- 画出来的日月（sunShow / moonShow）
  // 轨道镜头总是往下看（hero 画面上沿 ≈ 地平线下 9°），真实的 8.6° 黄昏太阳、38° 中午太阳都在画外。
  // 方位、升落时刻保持真实；只把「画出来的」天空往下挪：地平线压低 dip（≈ 从镜头高度看到的岛边 / 云海线，
  // 镜头越高压得越多），日月高度再压进这条线上方几度的一条带（越高越慢，饱和到 span）。光照、阴影仍用真实方向。
  const SHOW = { on: true, span: 4.0, spanMoon: 2.6, k: 18, rise: 0.83, dist: 74, max: 20, ref: 19.9 };   // hero（y≈19.9）dip ≈15.1°：地平线 ≈ 岛边，画面上沿 ≈ −9°；span 控制日月最多高出地平线几度
  try { if (V3.util && V3.util.qs && V3.util.qs('realsky', '') === '1') SHOW.on = false; } catch (e) { /* 没有 URL 参数 */ }
  const dipFor = (camY) => SHOW.on ? Math.min(SHOW.max, Math.atan(Math.max(0, +camY || 0) / SHOW.dist) * 180 / Math.PI) : 0;
  const showRel = (alt, span, off) => {          // 真实高度（度）→ 压低后的地平线上方多少度
    const a = alt + off;
    return a >= 0 ? span * (1 - Math.exp(-a / SHOW.k)) : a;   // 地平线下按真实速度落下去（马上被云海线挡住）
  };
  let lastDip = NaN;
  function show(dip) {                          // dip（度）：画出来的地平线比真实地平线低多少；省略 = 上一次的（没有就按 hero 镜头高度）
    const s = state;
    if (typeof dip === 'number' && isFinite(dip)) lastDip = dip;
    dip = isFinite(lastDip) ? lastDip : dipFor(SHOW.ref);
    if (!SHOW.on) { s.sunShow.copy(s.sunDir); s.moonShow.copy(s.moonDir); s.showDip = 0; return s; }
    dirOf(showRel(s.sunAlt, SHOW.span, SHOW.rise) - dip, s.sunAz, s.sunShow);
    dirOf(showRel(s.moonAlt, SHOW.spanMoon, 0) - dip, s.moonAz, s.moonShow);
    s.showDip = dip;
    return s;
  }
  function info() {                        // 调试用的一行摘要
    const s = state, f = (x) => x.toFixed(1);
    return s.preset + ' ' + s.day + ' ' + hhmm(s.hour) + ' 日出 ' + hhmm(s.times.sunrise) + ' 日落 ' + hhmm(s.times.sunset) +
      ' | 太阳 ' + f(s.sunAlt) + '°/' + f(s.sunAz) + '° | 月亮 ' + f(s.moonAlt) + '°/' + f(s.moonAz) + '° 相 ' +
      s.moonPhase.toFixed(2) + ' 亮 ' + s.moonIllum.toFixed(2) + ' | night ' + s.night.toFixed(2) +
      ' golden ' + s.golden.toFixed(2) + ' 曝光 ' + s.exposure.toFixed(2) + ' 主光 ' + s.key +
      ' | 风 ' + s.wind.speed.toFixed(2) + ' 阵风 ' + s.wind.gust.toFixed(2) +
      ' | 天气 ' + s.wx.mode + '→' + s.wx.kind + '(' + s.wx.src + ') 云 ' + s.wx.cloud.toFixed(2) + ' 雨 ' + s.wx.rain.toFixed(2) +
      ' 雪 ' + s.wx.snow.toFixed(2) + ' 雾 ' + s.wx.fog.toFixed(2) + ' 雷 ' + s.wx.storm.toFixed(2) + ' 日光 ' + s.sunVis.toFixed(2) +
      ' | 画日 ' + f(Math.asin(s.sunShow.y) * 180 / Math.PI) + '° 画月 ' + f(Math.asin(s.moonShow.y) * 180 / Math.PI) + '° dip ' + f(s.showDip);
  }

  // 设置里的观测地点。换地点只重新计算当地的钟点、日月和天气，保留正在看的那个时刻。
  function setSite(value) {
    if (value != null && (!Number.isFinite(value.lat) || Math.abs(value.lat)>89.5 || !Number.isFinite(value.lon) ||
        Math.abs(value.lon)>180 || typeof value.tz!=='string' || (value.tz && !fmt(value.tz)))) return false;
    chosenSite = value ? {lat:value.lat,lon:value.lon,tz:value.tz} : null;
    Object.assign(LIVE,{data:null,src:'fallback',at:0,next:0,wind:null});
    recalc(); setWeather(state.wx.mode); return true;
  }
  V3.env = {
    state, setTime, update, solar, info, hhmm, setWeather, setSite, show, dipFor,
    presets: ['golden', 'dawn', 'morning', 'noon', 'dusk', 'night', 'real'],
    weathers: ['real', 'clear', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'storm', 'snow'],
    windParams: WIND,                      // 风的参数（控制台可改：V3.env.windParams.scale = 2）
    showParams: SHOW,                      // 画日月压低的参数（?realsky=1 = 不压低）
    wxParams: WXP, wxTargets: WX,          // 天气过渡时间 / 缓存时长、各天气目标值
    wxLive: LIVE,                          // 实时天气的原始解析结果（调试用）
    wxParse: parseWx, wxUse: (json) => { const ok = useLive(json, Date.now(), 'live'); if (ok && state.wx.mode === 'real') { target('real', true); stepWx(0); } return ok; },
    astro: { sunPos, moonPos, solarTimes, localInfo, fromLocal, site, palette, gmst },
  };
  stepWind(0);
  setTime('golden');                       // 默认黄金时刻；house2 建好后会再按它的 time 状态调一次
})(window.V3);
