/**
 * analysis-flags.js
 * -------------------
 * Tiny feature-flag SDK (the idea behind LaunchDarkly / Meta Gatekeeper / Google Experiments):
 * deterministic percentage rollouts, per-environment targeting, instant kill switch.
 * Works in the browser and in Node. No dependencies.
 *
 *   const flags = AnalysisFlags.create([
 *     { key: 'new-chat-ui', on: true, rollout: 25, env: ['prod'] }
 *   ], { env: 'prod' });
 *   if (flags.isOn('new-chat-ui')) { ... }
 *
 * The same visitor always lands in the same bucket, so a 25% rollout is stable
 * across page loads and grows monotonically when you raise the percentage.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnalysisFlags = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function hash(str) {                       // FNV-1a, 32-bit
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function bucket(visitor, key) { return hash(key + ':' + visitor) % 100; }

  function evaluate(flag, visitor, env) {
    if (!flag || !flag.on) return false;                                   // kill switch
    if (flag.env && flag.env.length && env && flag.env.indexOf(env) < 0) return false;
    if (flag.allow && flag.allow.indexOf(visitor) >= 0) return true;       // explicit allow-list
    return bucket(visitor, flag.key) < Math.max(0, Math.min(100, Number(flag.rollout) || 0));
  }

  function visitorId() {
    try {
      var k = 'tg_visitor_id', v = root.localStorage.getItem(k);
      if (!v) { v = 'v_' + Math.random().toString(36).slice(2, 12); root.localStorage.setItem(k, v); }
      return v;
    } catch (e) { return 'v_anonymous'; }
  }

  function create(flags, opts) {
    opts = opts || {};
    var id = opts.visitor || visitorId(), env = opts.env || null, map = {};
    (flags || []).forEach(function (f) { map[f.key] = f; });
    return {
      visitor: id,
      isOn: function (key, fallback) { return map[key] ? evaluate(map[key], id, env) : !!fallback; },
      all: function () { var o = {}; Object.keys(map).forEach(function (k) { o[k] = evaluate(map[k], id, env); }); return o; },
      bucket: function (key) { return bucket(id, key); }
    };
  }

  return { hash: hash, bucket: bucket, evaluate: evaluate, create: create, visitorId: visitorId };
});
