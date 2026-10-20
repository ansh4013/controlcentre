/**
 * analysis-algorithms.js
 * -------------
 * Classic ranking algorithms used by large tech platforms, as small pure functions.
 * No network, no DOM: usable in the browser and in Node.
 *
 *  pageRank          Google    – authority from the link graph (damped random surfer)
 *  eloLeague         Chess/FIFA/FiveThirtyEight – head-to-head ratings with margin-of-victory
 *  hotScore          Hacker News – points decay with age (gravity)
 *  bayesianRating    IMDb Top 250 – weighted rating, shrinks small samples toward the mean
 *  wilsonLowerBound  Reddit "best" – confidence-aware proportion
 *  reciprocalRankFusion  search engines (Elastic/Azure/academic IR) – merge many rankings
 *  detectAnomalies   Datadog/Google-style monitoring – robust z-score (median + MAD) on daily traffic
 *  forecast          Holt's linear trend with day-of-week seasonality + prediction band
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NexoraAlgorithms = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** nodes: ['a','b']; edges: [{from,to,w?}]. Returns {id: probability} summing to 1. */
  function pageRank(nodes, edges, opts) {
    opts = opts || {};
    var d = opts.damping === undefined ? 0.85 : opts.damping;
    var n = nodes.length, out = {}, pr = {}, i, k;
    if (!n) return {};
    nodes.forEach(function (id) { out[id] = []; pr[id] = 1 / n; });
    (edges || []).forEach(function (e) {
      if (out[e.from] && out[e.to] !== undefined && e.from !== e.to) out[e.from].push({ to: e.to, w: e.w || 1 });
    });
    for (i = 0; i < (opts.iterations || 100); i++) {
      var next = {}, dangling = 0;
      nodes.forEach(function (id) { next[id] = (1 - d) / n; });
      nodes.forEach(function (id) {
        var links = out[id], tw = links.reduce(function (t, l) { return t + l.w; }, 0);
        if (!tw) { dangling += pr[id]; return; }      // sink: spread evenly
        links.forEach(function (l) { next[l.to] += d * pr[id] * l.w / tw; });
      });
      var diff = 0;
      nodes.forEach(function (id) {
        next[id] += d * dangling / n;
        diff += Math.abs(next[id] - pr[id]);
      });
      pr = next;
      if (diff < 1e-10) break;
    }
    return pr;
  }

  /**
   * Elo league from daily head-to-head results.
   * series: {id: [dailyViews oldest->newest]}. Each day every pair "plays";
   * more views wins. Margin-of-victory multiplier damps blow-outs (FiveThirtyEight style).
   * Returns {id: rating}; start 1500.
   */
  function eloLeague(series, opts) {
    opts = opts || {};
    var K = opts.k || 24, ids = Object.keys(series), rating = {};
    ids.forEach(function (id) { rating[id] = 1500; });
    var days = ids.length ? series[ids[0]].length : 0;
    for (var t = 0; t < days; t++) {
      for (var a = 0; a < ids.length; a++) {
        for (var b = a + 1; b < ids.length; b++) {
          var A = ids[a], B = ids[b], va = series[A][t] || 0, vb = series[B][t] || 0;
          if (va === 0 && vb === 0) continue;               // nobody showed up: no match
          var sa = va > vb ? 1 : (va < vb ? 0 : 0.5);
          var ea = 1 / (1 + Math.pow(10, (rating[B] - rating[A]) / 400));
          var winnerDiff = sa === 1 ? rating[A] - rating[B] : (sa === 0 ? rating[B] - rating[A] : 0);
          var mov = sa === 0.5 ? 1 : Math.log(Math.abs(va - vb) + 1) * (2.2 / (winnerDiff * 0.001 + 2.2));
          var delta = K * Math.max(0.5, mov) * (sa - ea);
          rating[A] += delta; rating[B] -= delta;
        }
      }
    }
    return rating;
  }

  /** Hacker-News-style freshness: each day's views decay with age ((age+offset)^gravity). */
  function hotScore(daily, opts) {
    opts = opts || {};
    var g = opts.gravity || 1.8, off = opts.offset || 1, n = daily.length, s = 0;
    for (var i = 0; i < n; i++) s += (daily[i] || 0) / Math.pow((n - 1 - i) + off, g);
    return s;
  }

  /** IMDb weighted rating: WR = v/(v+m)*R + m/(v+m)*C */
  function bayesianRating(R, v, m, C) { return v / (v + m) * R + m / (v + m) * C; }

  /** Lower bound of the Wilson score interval (Reddit "best"). Returns 0..1. */
  function wilsonLowerBound(success, n, z) {
    if (!n) return 0;
    z = z || 1.96;
    var p = Math.min(1, success / n), d = 1 + z * z / n;
    return Math.max(0, (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d);
  }

  /**
   * Weighted Reciprocal Rank Fusion.
   * rankings: [{weight, ranks: {id: rank}}]. Score = Σ w / (k + rank). Returns {id: score}.
   */
  function reciprocalRankFusion(rankings, k) {
    var out = {};
    rankings.forEach(function (r) {
      Object.keys(r.ranks).forEach(function (id) {
        out[id] = (out[id] || 0) + (r.weight === undefined ? 1 : r.weight) / (k + r.ranks[id]);
      });
    });
    return out;
  }

  /** Competition ranks (1,2,2,4) from {id: value}, higher value = better. */
  function ranksFromScores(scores, precision) {
    var ids = Object.keys(scores), p = Math.pow(10, precision === undefined ? 2 : precision);
    ids.sort(function (a, b) { return scores[b] - scores[a]; });
    var ranks = {}, rank = 0, prev = null;
    ids.forEach(function (id, i) {
      var v = Math.round(scores[id] * p);
      if (v !== prev) { rank = i + 1; prev = v; }
      ranks[id] = rank;
    });
    return ranks;
  }


  var median = function (a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  /**
   * Robust anomaly detection. Each day is compared with the median of the previous `window` days;
   * the median absolute deviation (MAD) makes it immune to earlier spikes. Returns the flagged days.
   */
  function detectAnomalies(daily, opts) {
    opts = opts || {};
    var win = opts.window || 7, thr = opts.threshold || 3.5, minVal = opts.minValue === undefined ? 5 : opts.minValue, out = [];
    for (var i = win; i < daily.length; i++) {
      var prev = daily.slice(i - win, i), med = median(prev);
      var mad = median(prev.map(function (v) { return Math.abs(v - med); }));
      var scale = Math.max(mad / 0.6745, 0.15 * Math.max(1, med), 1);   // floor so flat series don't flag noise
      var z = (daily[i] - med) / scale, rel = med > 0 ? (daily[i] - med) / med : (daily[i] > 0 ? 1 : 0);
      if (Math.abs(z) >= thr && Math.abs(rel) >= 0.5 && Math.max(daily[i], med) >= minVal) {
        out.push({ index: i, value: daily[i], expected: med, z: z, change: rel, type: z > 0 ? 'spike' : 'drop' });
      }
    }
    return out;
  }

  /**
   * Forecast the next `horizon` days. Day-of-week factors (shrunk toward 1) remove weekly rhythm,
   * Holt's double exponential smoothing fits level + trend, and the residual spread gives an 80% band.
   * days: ['YYYYMMDD', ...] aligned with daily (used for weekday seasonality).
   */
  function forecast(daily, days, horizon, opts) {
    opts = opts || {}; horizon = horizon || 7;
    var n = daily.length, a = opts.alpha || 0.5, b = opts.beta || 0.2;
    var dow = function (stamp) { return new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8))).getUTCDay(); };
    var mean = daily.reduce(function (t, v) { return t + v; }, 0) / Math.max(1, n);
    var factor = [1, 1, 1, 1, 1, 1, 1];
    if (days && days.length === n && n >= 14 && mean > 0) {
      // detrend with a least-squares line first, so a steady climb is not mistaken for a weekly pattern
      var sx = 0, sy = 0, sxy = 0, sxx = 0;
      daily.forEach(function (v, i) { sx += i; sy += v; sxy += i * v; sxx += i * i; });
      var den = n * sxx - sx * sx, slope = den ? (n * sxy - sx * sy) / den : 0, icpt = (sy - slope * sx) / n;
      var sums = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
      days.forEach(function (d, i) { var fit = Math.max(icpt + slope * i, 0.25 * mean), w = dow(d); sums[w] += daily[i] / fit; cnt[w]++; });
      var raw = sums.map(function (t, w) { return cnt[w] ? t / cnt[w] : 1; }), avg = raw.reduce(function (t, v) { return t + v; }, 0) / 7;
      factor = raw.map(function (r) { return 1 + 0.5 * (r / (avg || 1) - 1); });
    }
    var adj = daily.map(function (v, i) { var f = days && days.length === n ? factor[dow(days[i])] : 1; return f > 0 ? v / f : v; });
    var level = adj[0] || 0, trend = n > 1 ? (adj[Math.min(n - 1, 6)] - adj[0]) / Math.max(1, Math.min(n - 1, 6)) : 0, sq = 0, k = 0, i;
    for (i = 1; i < n; i++) {
      var pred = level + trend, err = adj[i] - pred; sq += err * err; k++;
      var nl = a * adj[i] + (1 - a) * (level + trend);
      trend = b * (nl - level) + (1 - b) * trend; level = nl;
    }
    var sd = k ? Math.sqrt(sq / k) : 0, pts = [];
    var last = days && days.length === n ? Date.UTC(+days[n - 1].slice(0, 4), +days[n - 1].slice(4, 6) - 1, +days[n - 1].slice(6, 8)) : null;
    for (var h = 1; h <= horizon; h++) {
      var wd = last === null ? 0 : new Date(last + h * 86400000).getUTCDay(), f2 = last === null ? 1 : factor[wd];
      var base = Math.max(0, (level + trend * h) * f2), band = 1.28 * sd * Math.sqrt(h) * f2;
      pts.push({ h: h, value: base, lo: Math.max(0, base - band), hi: base + band, dow: wd });
    }
    return { points: pts, sd: sd, trendPerDay: trend, level: level, total: pts.reduce(function (t, p) { return t + p.value; }, 0) };
  }

  return { detectAnomalies: detectAnomalies, forecast: forecast, median: median, pageRank: pageRank, eloLeague: eloLeague, hotScore: hotScore, bayesianRating: bayesianRating,
    wilsonLowerBound: wilsonLowerBound, reciprocalRankFusion: reciprocalRankFusion, ranksFromScores: ranksFromScores };
});
