/**
 * analysis-config.js
 * -----------------
 * Single place to configure the Analysis Ranking System.
 * Works in the browser (window.NEXORA_RANKING_CONFIG) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NEXORA_RANKING_CONFIG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    // Public counter API used by tracker.js
    api: 'https://countapi.mileshilliard.com/api/v1',
    timeoutMs: 8000,
    concurrency: 6,

    refreshMs: 30000,      // auto-refresh interval on analysis.html
    historyDays: 14,       // days of daily history used for trend scoring (min 14)
    engagedSeconds: 30,    // a visit counts as "engaged" after this many seconds
    confidenceK: 30,       // views needed for ~50% confidence in a site's score
    emaAlpha: 0.35,        // smoothing factor for recent-traffic average
    closeRaceGap: 2,       // score gap (points) below which a race is "close"

    sites: [
      { id: 'nexora',     name: 'Nexora AI',      key: 'ansh4013_nexora_views',     url: 'https://ansh4013.github.io/aichatbot-/' },
      { id: 'discipline', name: 'Discipline',     key: 'ansh4013_discipline_views', url: 'https://ansh4013.github.io/dashboard/discipline.html' },
      { id: 'dashboard',  name: 'Main Dashboard', key: 'ansh4013_dashboard_views',  url: 'https://ansh4013.github.io/dashboard/' }
    ],

    // ---- Chatbot analytics (Nexora AI) ----
    chat: {
      siteId: 'nexora',
      topics: [['coding', 'Coding'], ['writing', 'Writing'], ['study', 'Study & learning'], ['business', 'Business & career'], ['general', 'General']],
      latencyBuckets: [['lat_1', '< 1 s', 1000], ['lat_2', '1 – 2 s', 2000], ['lat_4', '2 – 4 s', 4000], ['lat_8', '4 – 8 s', 8000], ['lat_9', '8 s +', 16000]],
      depthBuckets: [['mpc_1', '1 message'], ['mpc_2', '2 messages'], ['mpc_3_5', '3 – 5 messages'], ['mpc_6p', '6+ messages']],
      thresholds: { errorRate: 0.10, csat: 0.60, p95Ms: 8000, minReplies: 20, minVotes: 10 }
    },
    sources: [['direct', 'Direct'], ['search', 'Search'], ['social', 'Social'], ['github', 'GitHub'], ['email', 'Email'], ['other', 'Other']],
    devices: [['desktop', 'Desktop'], ['mobile', 'Mobile']],
    vitals: [['lcp', 'Loading (LCP)', '≤ 2.5 s'], ['cls', 'Layout shift (CLS)', '≤ 0.1'], ['inp', 'Responsiveness (INP)', '≤ 200 ms']],

    // How sites link to each other (feeds PageRank "authority"). from/to are site ids.
    links: [
      { from: 'dashboard', to: 'nexora' },
      { from: 'dashboard', to: 'discipline' }
    ],

    // 'weighted' = weighted sum of metric scores
    // 'fusion'   = weighted Reciprocal Rank Fusion (merge each metric's ranking, like search engines)
    method: 'weighted',
    bayesM: 20,            // IMDb-style prior strength (sessions) for engagement quality
    hotGravity: 1.8,       // Hacker-News-style freshness decay

    // Relative importance of each metric (any scale — normalised automatically)
    weights: { reach: 15, traction: 15, momentum: 10, consistency: 10, engagement: 10, authority: 10, freshness: 15, elo: 15 },

    presets: {
      Balanced:   { reach: 15, traction: 15, momentum: 10, consistency: 10, engagement: 10, authority: 10, freshness: 15, elo: 15 },
      Popularity: { reach: 40, traction: 25, momentum: 0,  consistency: 5,  engagement: 0,  authority: 15, freshness: 5,  elo: 10 },
      Trending:   { reach: 5,  traction: 15, momentum: 30, consistency: 0,  engagement: 0,  authority: 0,  freshness: 35, elo: 15 },
      Quality:    { reach: 5,  traction: 10, momentum: 5,  consistency: 20, engagement: 40, authority: 10, freshness: 0,  elo: 10 },
      Competitive:{ reach: 5,  traction: 15, momentum: 10, consistency: 5,  engagement: 5,  authority: 5,  freshness: 15, elo: 40 }
    }
  };
});
