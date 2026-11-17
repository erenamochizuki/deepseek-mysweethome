// 58-cabin-tools.js — V3.cabinTools：给「对话里的她」用的工具（2026-11-17）。页面只负责执行；怎么把工具交给模型、
// 怎么把调用送到页面、怎么把结果送回同一段对话，由本机桥接决定（见 docs/CABIN-TOOLS-BRIDGE.md）。
//   register({ name, description, parameters, run(args, ctx) → { ok, text, result?, image? } })   各功能模块自己登记（69-sand-tray 的 sand_tray）
//   list() → [{ name, description, parameters }]            parameters 是 JSON Schema（draft 2020-12 的常用子集），桥接据此注册给模型
//   call(name, args, { via }) → Promise<{ ok, text, result?, image?, error? }>   永远不抛异常；via = 对话会话 id（只记录，不鉴权）
//     text：给模型看的文字（看不了图的模型只看它就够）；image：'data:image/jpeg;base64,…'（可选，能看图的模型用）
//   connect(transport)：桥接把自己的传输接进来（可选的便利写法）：transport = { next() → Promise<{ callId, name, args, via } | null>,
//     reply(callId, result) → Promise }；页面会一直 next() → call() → reply()，直到 disconnect()。不用它、自己调 call() 也行。
// 同一时间只执行一个调用（排队），免得两个调用同时改同一个沙盘。
(function (V3) {
  'use strict';
  const tools = new Map();
  let queue = Promise.resolve(), link = null;
  function register(t) {
    if (!t || typeof t.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(t.name) || typeof t.run !== 'function') throw new Error('cabinTools.register: bad tool');
    tools.set(t.name, t);
  }
  const list = () => [...tools.values()].map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  function call(name, args, ctx = {}) {
    const job = queue.then(async () => {
      const t = tools.get(name);
      if (!t) return { ok: false, error: 'unknown_tool', text: `没有叫 ${name} 的工具。` };
      try {
        const r = await t.run(args && typeof args === 'object' ? args : {}, { via: ctx.via ? String(ctx.via).slice(0, 128) : undefined });
        return r && typeof r === 'object' ? r : { ok: false, error: 'no_result', text: '工具没有返回结果。' };
      } catch (e) {
        V3.err('cabinTools ' + name + ': ' + (e && (e.stack || e.message) || e));
        return { ok: false, error: 'tool_failed', text: '工具执行出错：' + (e && e.message || e) };
      }
    });
    queue = job.catch(() => {});
    return job;
  }
  function connect(transport) {
    disconnect();
    if (!transport || typeof transport.next !== 'function' || typeof transport.reply !== 'function') throw new Error('cabinTools.connect: transport needs next() and reply()');
    const me = link = { transport, on: true };
    void (async () => {
      while (me.on) {
        let job = null;
        try { job = await transport.next(); } catch (e) { await new Promise((r) => setTimeout(r, 3000)); continue; }
        if (!me.on) break;
        if (!job || !job.callId) { await new Promise((r) => setTimeout(r, 1000)); continue; }   // 这次没有调用：歇一下再问（next 自己不长轮询时不至于空转）
        const result = await call(job.name, job.args, { via: job.via });
        try { await transport.reply(job.callId, result); } catch (e) { V3.err('cabinTools reply: ' + (e && e.message || e)); }
      }
    })();
    return () => disconnect();
  }
  function disconnect() { if (link) { link.on = false; link = null; } }
  V3.cabinTools = { register, list, call, connect, disconnect, get connected() { return !!link; } };
})(window.V3);
