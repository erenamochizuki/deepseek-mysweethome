// Read-only texture overrides on top of the existing house resource resolver.
(function (V3) {
  'use strict';
  const T = V3.mcTextureLayer = {};
  const VALID = /^[a-z0-9_.-]+:block\/[a-z0-9_./-]+$/;
  const MAX_PIXELS = 1024 * 1024, MAX_BYTES = 8 * 1024 * 1024;
  const MAX_CACHE = 192, MAX_CACHE_BYTES = 24 * 1024 * 1024;
  const text = new TextDecoder();
  function dimensions(bytes) {
    if (bytes.length < 33 || bytes.length > MAX_BYTES) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint32(0) !== 0x89504e47 || v.getUint32(4) !== 0x0d0a1a0a || v.getUint32(8) !== 13 || v.getUint32(12) !== 0x49484452) return null;
    const w = v.getUint32(16), h = v.getUint32(20);
    if (!w || !h || w > 2048 || h > 2048 || w * h > MAX_PIXELS) return null;
    let seenData = false;
    for (let p = 33; p + 12 <= bytes.length;) {
      const len = v.getUint32(p), type = v.getUint32(p + 4);
      if (len > bytes.length - p - 12 || type === 0x49484452) return null;
      if (type === 0x49444154) seenData ||= len > 0;
      if (type === 0x49454e44) return seenData && !len && p + 12 === bytes.length ? [w, h] : null;
      p += len + 12;
    }
    return null;
  }
  function animation(bytes, w, h) {
    if (!bytes || bytes.length > 65536) return null;
    try {
      const { animation: a } = JSON.parse(text.decode(bytes));
      if (!a || typeof a !== 'object') return null;
      const fw = a.width ?? Math.min(w, h), fh = a.height ?? Math.min(w, h);
      if (!Number.isInteger(fw) || !Number.isInteger(fh) || fw < 1 || fh < 1 || w % fw || h % fh || w / fw * (h / fh) > 2048) return null;
      return { animation: { width: fw, height: fh, frames: Array.isArray(a.frames) ? a.frames.slice(0, 2048) : undefined } };
    } catch (_) { return null; }
  }
  // For vanilla shapes with no client model, keep the built-in geometry but
  // recognize conventional texture names. No guesses are needed for real models.
  T.fallbackNames = (state, quad) => {
    const { ns, id } = state;
    const prefix = ns + ':block/';
    if (ns !== 'minecraft') return [prefix + id];
    let alt = [];
    if (id === 'grass_block') alt = [quad.dir === 1 ? 'grass_block_top' : quad.dir === 0 ? 'dirt' : 'grass_block_side'];
    else if (quad.sprite === 'v3:fallback/rings' && /_(log|stem)$/.test(id)) alt = [id + '_top'];
    else if (quad.sprite === 'v3:fallback/door_upper' || quad.sprite === 'v3:fallback/door_lower') alt = [id + (quad.sprite.endsWith('upper') ? '_top' : '_bottom')];
    else if (/_(stairs|slab)$/.test(id)) {
      const b = id.replace(/_(stairs|slab)$/, '');
      alt = [b + '_planks', b, b + 's'];
    }
    return [...alt, id].map(k => prefix + k);
  };
  T.apply = (base, layers, inflateZlib) => {
    if (!Array.isArray(layers) || !layers.length || typeof inflateZlib !== 'function') return base;
    const J = V3.mcjar;
    base = base || J.makePack(new Map(), { key: 'builtin' });
    const priority = layers.slice().reverse(), cache = new Map();
    let live = 0, cachedBytes = 0;
    function trim() {
      while (cache.size > MAX_CACHE || cachedBytes > MAX_CACHE_BYTES) {
        const id = cache.keys().next().value;
        cachedBytes -= cache.get(id).bytes;
        cache.delete(id);
      }
    }
    const waiters = [];
    async function limited(fn) {
      if (live === 4) await new Promise(resolve => waiters.push(resolve)); else live++;
      try { return await fn(); }
      finally { const next = waiters.shift(); if (next) next(); else live--; }
    }
    function override(id) {
      if (!VALID.test(id) || id.split('/').some(s => s === '..' || s === '.' || !s)) return Promise.resolve(null);
      if (cache.has(id)) {
        const hit = cache.get(id);
        cache.delete(id); cache.set(id, hit);
        return hit.result;
      }
      const path = base.texturePath(id);
      const result = limited(async () => {
        for (const layer of priority) {
          try {
            const bytes = await layer.read(path);
            const size = bytes && dimensions(bytes);
            if (!size) continue;
            const [w, h] = size;
            const img = await J.decodePng(bytes, z => inflateZlib(z, 8 * w * h + 8 * (w + h) + 1024));
            const meta = animation(await layer.read(path + '.mcmeta').catch(() => null), w, h);
            return J.makeSprite(id, img, meta);
          } catch (_) { /* unreadable pack/texture: try the next layer or the built-in resolver */ }
        }
        return null;
      });
      const slot = { result, bytes: 0 };
      cache.set(id, slot);
      trim();
      void result.then(sprite => {
        if (!sprite || cache.get(id) !== slot) return;
        slot.bytes = sprite.data.byteLength + sprite.image.data.byteLength;
        cachedBytes += slot.bytes;
        trim();
      });
      return result;
    }
    return { ...base, key: base.key + '+instance', overrideSprite: override,
      async sprite(id) { return await override(id) || base.sprite(id); },
      async fallbackSprite(state, quad) {
        for (const id of T.fallbackNames(state, quad)) { const sprite = await override(id); if (sprite) return sprite; }
        return null;
      } };
  };
})(window.V3);
