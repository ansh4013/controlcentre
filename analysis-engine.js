/**
 * analysis-engine.js
 * -----------------
 * Analysis Ranking System — multi-factor, self-arranging ranking engine.
 * Independent of any analysis page. Works in the browser and in Node 18+.
 *
 * Data (all produced by tracker.js, read from the public counter API):
 *   <key>                lifetime views
 *   <key>_YYYYMMDD       views per UTC day         (history for trend maths)
 *   <key>_sessions       unique sessions
 *   <key>_engaged        sessions that stayed >= engagedSeconds
 *
 * Algorithms (see algorithms.js): PageRank, Elo league, HN-style hot score, IMDb Bayesian
 * rating, Wilson bound, Reciprocal Rank Fusion.
 *
 * Score model (each metric 0-100, then weighted):
 *   Reach        log-scaled lifetime views, relative to the field leader
 *   Traction     exponential moving average of daily views (recent days weigh more)
 *   Momentum     week-over-week growth, Bayesian-smoothed, squashed with tanh (50 = flat)
 *   Consistency  recency-weighted active days combined with low volatility
 *   Engagement   Wilson lower bound (95%) of engaged / sessions, IMDb-shrunk toward the field mean
 *   Authority    PageRank over the site link graph
 *   Freshness    Hacker-News-style gravity: today's views count far more than last week's
 *   Elo          daily head-to-head league rating (more views that day = win, margin-of-victory aware)
 *
 *   Two methods: 'weighted' (weighted sum) and 'fusion' (weighted Reciprocal Rank Fusion).
 *
 *   Small samples are damped toward the field average (confidence = views / (views + K))
 *   and are never boosted above their raw score, so a brand-new site cannot jump to 1st.
 *   Ties break on: score > traction > lifetime views > name.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NexoraRanking = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var NODE = typeof module === 'object' && module.exports;
  var CFG = NODE ? require('./analysis-config.js') : root.NEXORA_RANKING_CONFIG;
  var ALG = NODE ? require('./analysis-algorithms.js') : root.NexoraAlgorithms;

  var METRICS = [
    { id: 'reach',       label: 'Reach',       color: '#22d3ee', hint: 'Lifetime views (log scale)' },
    { id: 'traction',    label: 'Traction',    color: '#a78bfa', hint: 'Recent daily traffic (moving average)' },
    { id: 'momentum',    label: 'Momentum',    color: '#3ed598', hint: 'This week vs last week' },
    { id: 'consistency', label: 'Consistency', color: '#ffb74d', hint: 'Steady daily activity' },
    { id: 'engagement',  label: 'Engagement',  color: '#f472b6', hint: 'Visitors who stay 30s+ (Wilson + Bayesian)' },
    { id: 'authority',   label: 'Authority',   color: '#60a5fa', hint: 'PageRank from site links' },
    { id: 'freshness',   label: 'Freshness',   color: '#fb923c', hint: 'Hot score: recent views decay slowly' },
    { id: 'elo',         label: 'Elo',         color: '#e879f9', hint: 'Daily head-to-head rating' }
  ];

  /* ---------- small helpers ---------- */
  var sum = function (a) { return a.reduce(function (t, v) { return t + v; }, 0); };
  var round = function (v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  function ordinal(n) {
    if (!n) return '—';
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function dayStamp(ms) { return new Date(ms).toISOString().slice(0, 10).replace(/-/g, ''); }
  function lastDays(n, now) {
    var a = [];
    for (var i = n - 1; i >= 0; i--) a.push(dayStamp(now - i * 86400000));
    return a;
  }
  function makeStorage() {
    try {
      if (root.localStorage) {
        root.localStorage.setItem('__nx', '1'); root.localStorage.removeItem('__nx');
        return root.localStorage;
      }
    } catch (e) { /* fall through */ }
    var mem = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }
  var STORE = makeStorage();
  var CACHE_KEY = 'nexora_rank_cache_v2', HISTORY_KEY = 'nexora_rank_history_v2';
  function readJSON(k, fb) { try { return JSON.parse(STORE.getItem(k)) || fb; } catch (e) { return fb; } }
  function writeJSON(k, v) { try { STORE.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } }

  /* ---------- data layer ---------- */
  async function fetchCount(cfg, key) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, cfg.timeoutMs || 8000);
    try {
      var res = await fetch(cfg.api + '/get/' + encodeURIComponent(key), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (res.status === 404) return 0;           // key not created yet = no hits
      if (!res.ok) return null;                   // service problem
      var d = await res.json();
      if (d && d.value !== undefined && d.value !== null) return Number(d.value) || 0;
      return d && d.error ? 0 : null;
    } catch (e) { return null; } finally { clearTimeout(timer); }
  }

  async function pool(tasks, limit) {
    var out = new Array(tasks.length), i = 0;
    async function worker() { while (i < tasks.length) { var n = i++; out[n] = await tasks[n](); } }
    var workers = [];
    for (var w = 0; w < Math.min(limit, tasks.length); w++) workers.push(worker());
    await Promise.all(workers);
    return out;
  }

  /**
   * Fetch raw metrics for every configured site.
   * Past days never change, so they are cached permanently; only today + totals refetch.
   */
  async function collectMetrics(cfg, opts) {
    cfg = cfg || CFG; opts = opts || {};
    var now = opts.now || Date.now();
    var days = lastDays(Math.max(14, cfg.historyDays || 14), now);
    var today = days[days.length - 1];
    var cache = readJSON(CACHE_KEY, {});
    var anyFailed = false, anyStale = false;

    async function get(key, permanent) {
      if (permanent && cache[key] !== undefined) return { v: cache[key], stale: false };
      var v = await fetchCount(cfg, key);
      if (v === null) {
        anyFailed = true;
        if (cache[key] !== undefined) { anyStale = true; return { v: cache[key], stale: true }; }
        return { v: null, stale: false };
      }
      cache[key] = v;
      return { v: v, stale: false };
    }

    var plan = [];
    cfg.sites.forEach(function (s) {
      plan.push({ s: s, t: 'total', key: s.key, perm: false });
      plan.push({ s: s, t: 'sessions', key: s.key + '_sessions', perm: false });
      plan.push({ s: s, t: 'engaged', key: s.key + '_engaged', perm: false });
      days.forEach(function (d) { plan.push({ s: s, t: 'day', d: d, key: s.key + '_' + d, perm: d !== today }); });
    });
    var results = await pool(plan.map(function (p) { return function () { return get(p.key, p.perm); }; }), cfg.concurrency || 6);

    var bySite = {};
    cfg.sites.forEach(function (s) {
      bySite[s.id] = { id: s.id, name: s.name, url: s.url, total: null, sessions: 0, engaged: 0, days: days, daily: days.map(function () { return 0; }), stale: false };
    });
    plan.forEach(function (p, i) {
      var m = bySite[p.s.id], r = results[i];
      if (r.stale) m.stale = true;
      if (p.t === 'total') m.total = r.v;
      else if (p.t === 'sessions') m.sessions = r.v || 0;
      else if (p.t === 'engaged') m.engaged = r.v || 0;
      else m.daily[days.indexOf(p.d)] = r.v || 0;
    });
    // trim cache to what we still need
    var keep = {};
    cfg.sites.forEach(function (s) {
      [s.key, s.key + '_sessions', s.key + '_engaged'].concat(days.map(function (d) { return s.key + '_' + d; }))
        .forEach(function (k) { if (cache[k] !== undefined) keep[k] = cache[k]; });
    });
    writeJSON(CACHE_KEY, keep);

    var list = cfg.sites.map(function (s) {
      var m = bySite[s.id];
      m.unavailable = m.total === null;
      if (m.total === null) m.total = 0;
      return m;
    });
    var status = list.every(function (m) { return m.unavailable; }) ? 'offline'
      : (anyFailed ? (anyStale ? 'cached' : 'partial') : 'live');
    return { metrics: list, status: status, at: now };
  }

  /* ---------- scoring ---------- */
  function features(m, cfg) {
    var d = m.daily, n = d.length, alpha = cfg.emaAlpha || 0.35;
    var recent = sum(d.slice(-7)), prior = sum(d.slice(-14, -7));
    var ema = 0;
    d.forEach(function (v, i) { ema = i === 0 ? v : alpha * v + (1 - alpha) * ema; });
    var wSum = 0, wActive = 0;
    d.forEach(function (v, i) { var w = Math.pow(0.9, n - 1 - i); wSum += w; if (v > 0) wActive += w; });
    var mean = sum(d) / n;
    var sd = Math.sqrt(sum(d.map(function (v) { return (v - mean) * (v - mean); })) / n);
    var cv = mean > 0 ? sd / mean : 0;
    var consistency = mean > 0 ? 100 * (0.6 * (wActive / wSum) + 0.4 / (1 + cv)) : 0;
    var momentum = (recent + prior) === 0 ? 0
      : 50 + 50 * Math.tanh(Math.log((recent + 2) / (prior + 2)));
    var engagement = m.sessions > 0 ? 100 * ALG.wilsonLowerBound(m.engaged, m.sessions) : null;
    return { recent: recent, prior: prior, ema: ema, consistency: consistency, momentum: momentum, engagement: engagement };
  }

  function trendLabel(f) {
    if (f.recent + f.prior === 0) return 'No data';
    if (f.momentum >= 70) return 'Surging';
    if (f.momentum >= 55) return 'Rising';
    if (f.momentum >= 45) return 'Steady';
    if (f.momentum >= 25) return 'Cooling';
    return 'Fading';
  }

  /**
   * Pure function: raw metrics + weights  ->  ranked rows. Safe to call on every slider move.
   * opts.method: 'weighted' | 'fusion'
   */
  function scoreSites(metrics, weights, opts) {
    opts = opts || {};
    var cfg = Object.assign({}, CFG, opts);
    var method = cfg.method === 'fusion' ? 'fusion' : 'weighted';
    var live = metrics.filter(function (m) { return !m.unavailable; });
    var down = metrics.filter(function (m) { return m.unavailable; });
    var ids = live.map(function (m) { return m.id; });

    var feats = live.map(function (m) { return features(m, cfg); });
    var maxTotal = Math.max.apply(null, [0].concat(live.map(function (m) { return m.total; })));
    var maxEma = Math.max.apply(null, [0].concat(feats.map(function (f) { return f.ema; })));
    var hasEngagement = feats.some(function (f) { return f.engagement !== null; });

    // --- cross-site algorithms ---
    var pr = ALG.pageRank(ids, cfg.links || []);
    var maxPr = Math.max.apply(null, [0].concat(ids.map(function (id) { return pr[id]; })));
    var series = {}; live.forEach(function (m) { series[m.id] = m.daily; });
    var elo = ALG.eloLeague(series);
    var eloMean = ids.length ? ids.reduce(function (t, id) { return t + elo[id]; }, 0) / ids.length : 1500;
    var hot = {}; live.forEach(function (m) { hot[m.id] = ALG.hotScore(m.daily, { gravity: cfg.hotGravity }); });
    var maxHot = Math.max.apply(null, [0].concat(ids.map(function (id) { return hot[id]; })));
    // IMDb-style shrink of engagement rate toward the field mean
    var rates = live.filter(function (m) { return m.sessions > 0; }).map(function (m) { return m.engaged / m.sessions; });
    var meanRate = rates.length ? sum(rates) / rates.length : 0;

    var w = {}, wTotal = 0;
    METRICS.forEach(function (k) {
      var v = Math.max(0, Number(weights && weights[k.id]) || 0);
      if (k.id === 'engagement' && !hasEngagement) v = 0;
      w[k.id] = v; wTotal += v;
    });
    if (wTotal === 0) { METRICS.forEach(function (k) { w[k.id] = k.id === 'reach' ? 1 : 0; }); wTotal = 1; }
    METRICS.forEach(function (k) { w[k.id] = w[k.id] / wTotal; });

    var rows = live.map(function (m, i) {
      var f = feats[i], eng = f.engagement;
      if (eng !== null) {
        var wl = ALG.wilsonLowerBound(m.engaged, m.sessions);
        eng = 100 * ALG.bayesianRating(wl, m.sessions, cfg.bayesM || 20, meanRate * 0.7);
      }
      var scores = {
        reach: maxTotal > 0 ? 100 * Math.log1p(m.total) / Math.log1p(maxTotal) : 0,
        traction: maxEma > 0 ? 100 * Math.log1p(f.ema) / Math.log1p(maxEma) : 0,
        momentum: f.momentum,
        consistency: f.consistency,
        engagement: eng === null ? 0 : eng,
        authority: maxPr > 0 ? 100 * pr[m.id] / maxPr : 0,
        freshness: maxHot > 0 ? 100 * Math.log1p(hot[m.id]) / Math.log1p(maxHot) : 0,
        elo: 100 / (1 + Math.pow(10, (eloMean - elo[m.id]) / 400))
      };
      var composite = 0;
      METRICS.forEach(function (k) { composite += w[k.id] * scores[k.id]; });
      return { m: m, f: f, scores: scores, composite: composite, elo: elo[m.id], pr: pr[m.id], hot: hot[m.id] };
    });

    // --- per-metric rankings + weighted Reciprocal Rank Fusion ---
    var kRRF = Math.max(2, rows.length);
    var rankings = [], metricRanks = {};
    METRICS.forEach(function (k) {
      var sc = {}; rows.forEach(function (r) { sc[r.m.id] = r.scores[k.id]; });
      var rk = ALG.ranksFromScores(sc, 1);
      metricRanks[k.id] = rk;
      if (w[k.id] > 0) rankings.push({ weight: w[k.id], ranks: rk });
    });
    var rrf = ALG.reciprocalRankFusion(rankings, kRRF);
    var rrfMax = sum(rankings.map(function (r) { return r.weight / (kRRF + 1); })) || 1;
    rows.forEach(function (r) {
      r.fusion = 100 * (rrf[r.m.id] || 0) / rrfMax;
      r.base = method === 'fusion' ? r.fusion : r.composite;
    });

    var fieldMean = rows.length ? sum(rows.map(function (r) { return r.base; })) / rows.length : 0;
    var K = cfg.confidenceK || 30;
    rows.forEach(function (r) {
      r.confidence = r.m.total / (r.m.total + K);
      var shrunk = fieldMean * (1 - r.confidence) + r.base * r.confidence;
      r.score = Math.min(r.base, shrunk); // small samples can be damped, never boosted
      var scale = r.base > 0 ? r.score / r.base : 0;
      r.contrib = {};
      METRICS.forEach(function (k) {
        var part = method === 'fusion'
          ? 100 * (w[k.id] / (kRRF + metricRanks[k.id][r.m.id])) / rrfMax
          : w[k.id] * r.scores[k.id];
        r.contrib[k.id] = part * scale;
      });
    });

    rows.sort(function (a, b) {
      return (b.score - a.score) || (b.f.ema - a.f.ema) || (b.m.total - a.m.total) || a.m.name.localeCompare(b.m.name);
    });

    var out = [], rank = 0;
    rows.forEach(function (r, i) {
      var prev = rows[i - 1], next = rows[i + 1];
      var tie = prev && round(prev.score, 2) === round(r.score, 2) && round(prev.f.ema, 3) === round(r.f.ema, 3) && prev.m.total === r.m.total;
      if (!tie) rank = i + 1;
      var active = METRICS.filter(function (k) { return w[k.id] > 0; });
      var best = active.slice().sort(function (a, b) { return r.scores[b.id] - r.scores[a.id]; })[0];
      var worst = active.slice().sort(function (a, b) { return r.scores[a.id] - r.scores[b.id]; })[0];
      var gapUp = prev ? prev.score - r.score : null;
      var mr = {}; METRICS.forEach(function (k) { mr[k.id] = metricRanks[k.id][r.m.id]; });
      out.push({
        id: r.m.id, name: r.m.name, url: r.m.url, rank: rank, ordinal: ordinal(rank),
        score: round(r.score, 1), rawScore: round(r.base, 1),
        weightedScore: round(r.composite, 1), fusionScore: round(r.fusion, 1), method: method,
        confidence: round(r.confidence, 2),
        scores: Object.keys(r.scores).reduce(function (o, k) { o[k] = round(r.scores[k], 1); return o; }, {}),
        contrib: Object.keys(r.contrib).reduce(function (o, k) { o[k] = round(r.contrib[k], 2); return o; }, {}),
        metricRanks: mr, eloRating: round(r.elo, 0), pageRank: round(r.pr, 4), hot: round(r.hot, 2),
        total: r.m.total, recent7: r.f.recent, prior7: r.f.prior, ema: round(r.f.ema, 2),
        sessions: r.m.sessions, engaged: r.m.engaged,
        daily: r.m.daily, days: r.m.days,
        trend: trendLabel(r.f),
        strength: best ? best.label : null, weakness: worst ? worst.label : null,
        gapUp: gapUp === null ? null : round(gapUp, 1),
        leadOver: next ? round(r.score - next.score, 1) : null,
        catchUp7: prev ? Math.max(0, prev.f.recent - r.f.recent) + 1 : 0,
        closeRace: (gapUp !== null && gapUp < (cfg.closeRaceGap || 2)) || (next && r.score - next.score < (cfg.closeRaceGap || 2)) || false,
        stale: !!r.m.stale, unavailable: false, movement: null
      });
    });
    down.forEach(function (m) {
      out.push({ id: m.id, name: m.name, url: m.url, rank: null, ordinal: '—', score: null, rawScore: null, weightedScore: null, fusionScore: null,
        method: method, confidence: 0, scores: {}, contrib: {}, metricRanks: {}, eloRating: null, pageRank: null, hot: 0,
        total: 0, recent7: 0, prior7: 0, ema: 0, sessions: 0, engaged: 0, daily: m.daily, days: m.days,
        trend: 'Unavailable', strength: null, weakness: null, gapUp: null, leadOver: null, catchUp7: 0, closeRace: false,
        stale: false, unavailable: true, movement: null });
    });
    return { rows: out, weights: w, hasEngagement: hasEngagement, method: method };
  }

  /* ---------- rank movement (persisted in this browser) ---------- */
  function applyMovement(rows, now, minAgeMs) {
    now = now || Date.now(); minAgeMs = minAgeMs || 600000;
    var hist = readJSON(HISTORY_KEY, []);
    var ref = null;
    for (var i = hist.length - 1; i >= 0; i--) { if (now - hist[i].t >= minAgeMs) { ref = hist[i]; break; } }
    rows.forEach(function (r) {
      if (r.rank && ref && ref.ranks[r.id]) r.movement = ref.ranks[r.id] - r.rank;
      else r.movement = null;
    });
    var ranks = {};
    rows.forEach(function (r) { if (r.rank) ranks[r.id] = r.rank; });
    if (Object.keys(ranks).length && (!hist.length || now - hist[hist.length - 1].t >= minAgeMs)) {
      hist.push({ t: now, ranks: ranks });
      writeJSON(HISTORY_KEY, hist.slice(-100));
    }
    return rows;
  }

  /**
   * Read many counters at once (used by the workspace for chatbot / audience / vitals data).
   * opts.permanent = { key: true } marks keys that can never change again (past days) so they are cached for good.
   * Returns { values: {key: number|null}, failed: boolean }.
   */
  var EXT_CACHE = 'nexora_ext_cache_v1';
  async function fetchMany(keys, opts) {
    opts = opts || {};
    var cfg = Object.assign({}, CFG, opts.config || {}), cache = readJSON(EXT_CACHE, {}), perm = opts.permanent || {}, failed = false;
    var tasks = keys.map(function (k) {
      return async function () {
        if (perm[k] && cache[k] !== undefined) return cache[k];
        var v = await fetchCount(cfg, k);
        if (v === null) { failed = true; return cache[k] !== undefined ? cache[k] : null; }
        cache[k] = v; return v;
      };
    });
    var vals = await pool(tasks, cfg.concurrency || 6), out = {};
    keys.forEach(function (k, i) { out[k] = vals[i]; });
    writeJSON(EXT_CACHE, cache);
    return { values: out, failed: failed };
  }

  /** One call: fetch -> score -> movement. */
  async function compute(opts) {
    opts = opts || {};
    var cfg = Object.assign({}, CFG, opts.config || {});
    var data = await collectMetrics(cfg, opts);
    var res = scoreSites(data.metrics, opts.weights || cfg.weights, Object.assign({}, cfg, opts.method ? { method: opts.method } : {}));
    applyMovement(res.rows, data.at);
    return { rows: res.rows, weights: res.weights, hasEngagement: res.hasEngagement, method: res.method, metrics: data.metrics, status: data.status, at: data.at };
  }

  function toCSV(rows) {
    var head = ['rank', 'site', 'score', 'confidence', 'total_views', 'views_7d', 'views_prev_7d', 'trend', 'elo_rating', 'pagerank'].concat(METRICS.map(function (k) { return k.id; }));
    var lines = [head.join(',')];
    rows.forEach(function (r) {
      lines.push([r.rank || '', '"' + r.name + '"', r.score === null ? '' : r.score, r.confidence, r.total, r.recent7, r.prior7, r.trend,
        r.eloRating === null ? '' : r.eloRating, r.pageRank === null ? '' : r.pageRank].concat(METRICS.map(function (k) { return r.scores[k.id] === undefined ? '' : r.scores[k.id]; })).join(','));
    });
    return lines.join('\n');
  }

  return { config: CFG, METRICS: METRICS, ordinal: ordinal, collectMetrics: collectMetrics, scoreSites: scoreSites,
    applyMovement: applyMovement, compute: compute, toCSV: toCSV, dayStamp: dayStamp, lastDays: lastDays, fetchMany: fetchMany };
});
