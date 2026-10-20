/**
 * Analysis Tracker v2 — lightweight, privacy-friendly, no cookies, no backend required.
 * ---------------------------------------------------------------------------------
 * Add before </body> on each site (load it BEFORE your own chat code):
 *
 *   <script src="tracker.js" data-site="nexora" async></script>
 *
 * Optional attributes
 *   data-debug="true"            log what is being counted
 *   data-respect-dnt="false"     count visitors even if they send Do Not Track / GPC (default: respect)
 *   data-supabase-url / data-supabase-key / data-supabase-table
 *                                also store rich events in your own Supabase table (see analytics-events.sql)
 *
 * What it records (free public counters; keys are <site key>_<metric>[_YYYYMMDD]):
 *   views, daily views, sessions, engaged sessions (30s+), presence ping      (as before)
 *   src_*  dev_*                 traffic source category and device type
 *   new / returning, ret1_ / ret7_<cohort day>   new vs returning visitors, day-1 and day-7 return
 *   cwv_<lcp|cls|inp>_<good|ni|poor>             Core Web Vitals, one verdict per page load
 *   jserr                        JavaScript errors
 *   ev_<name>                    your own events:  AnalysisTracker.track('signup')
 *   chat_*                       chatbot metrics (see AnalysisTracker.chat below)
 *
 * Chatbot API (for Nexora AI):
 *   const chat = window.AnalysisTracker && window.AnalysisTracker.chat;
 *   chat && chat.messageSent(userText);          // when the user sends a message (text is NOT stored or sent;
 *                                                //   it is only used locally to pick a topic)
 *   const done = chat && chat.replyStarted();    // when you start waiting for the model
 *   done && done();                              // reply finished OK   -> latency + reply counted
 *   done && done(false);                         // reply failed        -> error counted
 *   chat && chat.feedback('up' | 'down');        // thumbs on a reply
 *   chat && chat.regenerate();                   // user pressed "regenerate / try again"
 *   chat && chat.copied();                       // user copied an answer
 *   chat && chat.newConversation();              // user started a new chat (ends the current one)
 */
(function () {
  'use strict';

  const SCRIPT = document.currentScript;
  const ATTR = (n) => (SCRIPT && SCRIPT.dataset[n]) || '';
  const API = 'https://countapi.mileshilliard.com/api/v1';
  const KEYS = {
    nexora: 'ansh4013_nexora_views',
    discipline: 'ansh4013_discipline_views',
    dashboard: 'ansh4013_dashboard_views',
    online: 'ansh4013_online_ping'
  };

  function detectSite() {
    if (ATTR('site')) return ATTR('site').toLowerCase();
    const host = location.hostname + location.pathname;
    if (host.includes('aichatbot') || host.includes('nexora')) return 'nexora';
    if (host.includes('discipline')) return 'discipline';
    if (host.includes('dashboard')) return 'dashboard';
    return 'dashboard';
  }
  const site = detectSite();
  const debug = ATTR('debug') === 'true';
  const log = (...a) => { if (debug) console.log('[AnalysisTracker]', ...a); };
  const base = KEYS[site] || KEYS.dashboard;

  // ---------- privacy ----------
  const respectDnt = ATTR('respectDnt') !== 'false';
  function optedOut() {
    try { if (localStorage.getItem('analysis_optout') === '1') return true; } catch (e) { /* ignore */ }
    return respectDnt && (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true);
  }
  window.AnalysisPrivacy = {
    optOut() { try { localStorage.setItem('analysis_optout', '1'); } catch (e) { /* ignore */ } },
    optIn() { try { localStorage.removeItem('analysis_optout'); } catch (e) { /* ignore */ } },
    isOptedOut: optedOut
  };
  const NOOP = () => {};
  if (optedOut()) {
    log('tracking disabled (privacy signal / opt-out)');
    window.AnalysisTracker = { site, disabled: true, track: NOOP, topic: NOOP,
      chat: { messageSent: NOOP, replyStarted: () => NOOP, replyReceived: NOOP, replyFailed: NOOP, feedback: NOOP, regenerate: NOOP, copied: NOOP, newConversation: NOOP } };
    return;
  }

  // ---------- helpers ----------
  const day = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dayNum = (s) => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 86400000);
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  const store = {
    get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) { /* ignore */ } }
  };
  function rid() { return Math.random().toString(36).slice(2, 12); }
  const visitorId = store.get('an_vid') || (store.set('an_vid', 'v_' + rid()), store.get('an_vid')) || 'v_anon';
  const sessionId = store.get('an_sid', true) || (store.set('an_sid', 's_' + rid(), true), store.get('an_sid', true)) || 's_anon';

  // ---------- counter transport (small queue so bursts never flood the API) ----------
  const queue = []; let active = 0;
  function pump() {
    while (active < 4 && queue.length) {
      const [key, resolve] = queue.shift(); active++;
      fetch(`${API}/hit/${key}`, { mode: 'cors', cache: 'no-store', keepalive: true })
        .then((r) => r.json()).then((d) => { log('hit', key, '→', d.value); resolve(d.value); })
        .catch((e) => { log('hit failed', key, e); resolve(null); })
        .finally(() => { active--; pump(); });
    }
  }
  const hit = (key) => new Promise((resolve) => { queue.push([key, resolve]); pump(); });
  async function get(key) {
    try { const r = await fetch(`${API}/get/${key}`, { mode: 'cors', cache: 'no-store' }); const d = await r.json(); return d.value ?? 0; }
    catch (e) { return 0; }
  }
  // count a metric: total and (optionally) the per-day counter
  function count(metric, daily = true) {
    hit(`${base}_${metric}`);
    if (daily) hit(`${base}_${metric}_${day()}`);
  }

  // ---------- optional Supabase sink (rich events in your own database) ----------
  const SB = { url: ATTR('supabaseUrl').replace(/\/$/, ''), key: ATTR('supabaseKey'), table: ATTR('supabaseTable') || 'analytics_events' };
  function sink(name, props) {
    if (!SB.url || !SB.key) return;
    try {
      fetch(`${SB.url}/rest/v1/${SB.table}`, {
        method: 'POST', keepalive: true,
        headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ site, name, props: props || {}, visitor_id: visitorId, session_id: sessionId })
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // ---------- custom events ----------
  function track(name, props) {
    const n = slug(name); if (!n) return;
    count(`ev_${n}`); sink(n, props); log('event', n, props || '');
  }

  // ---------- chatbot metrics ----------
  const TOPICS = {
    coding: /\b(code|coding|bug|debug|function|javascript|python|java|html|css|api|sql|script|regex|react|node|error|compile|algorithm|git)\b/i,
    writing: /\b(write|essay|email|story|poem|letter|rewrite|grammar|paragraph|blog|caption|summar(y|ise|ize)|translate)\b/i,
    study: /\b(explain|homework|math|solve|exam|science|history|physics|chemistry|biology|learn|study|quiz|equation|theorem)\b/i,
    business: /\b(marketing|startup|resume|cv|interview|career|business|sales|strategy|pitch|invoice|salary|linkedin)\b/i
  };
  function classifyTopic(text) {                       // runs locally; the text itself is never stored or sent
    const t = String(text || '');
    for (const k of Object.keys(TOPICS)) if (TOPICS[k].test(t)) return k;
    return 'general';
  }
  let convo = { started: false, msgs: 0, ended: false };
  function endConversation() {
    if (!convo.started || convo.ended) return;
    convo.ended = true;
    const m = convo.msgs, bucket = m <= 1 ? 'mpc_1' : m === 2 ? 'mpc_2' : m <= 5 ? 'mpc_3_5' : 'mpc_6p';
    hit(`${base}_chat_${bucket}`); sink('chat_conversation_end', { messages: m });
  }
  const latBucket = (ms) => (ms < 1000 ? 'lat_1' : ms < 2000 ? 'lat_2' : ms < 4000 ? 'lat_4' : ms < 8000 ? 'lat_8' : 'lat_9');
  const chat = {
    messageSent(text) {
      if (!convo.started || convo.ended) { convo = { started: true, msgs: 0, ended: false }; count('chat_convos'); sink('chat_conversation_start'); }
      convo.msgs++; count('chat_msgs');
      if (text !== undefined) { const t = classifyTopic(text); hit(`${base}_chat_topic_${t}`); sink('chat_message', { topic: t, n: convo.msgs }); }
      else sink('chat_message', { n: convo.msgs });
    },
    replyStarted() {
      const t0 = performance.now(); let finished = false;
      return (ok = true) => { if (finished) return; finished = true; ok ? chat.replyReceived(performance.now() - t0) : chat.replyFailed(); };
    },
    replyReceived(ms) {
      count('chat_replies'); const m = Math.max(0, Math.round(Number(ms) || 0));
      hit(`${base}_chat_${latBucket(m)}`); sink('chat_reply', { ms: m });
    },
    replyFailed() { count('chat_errors'); sink('chat_error'); },
    feedback(kind) { const k = kind === 'down' ? 'down' : 'up'; count(`chat_${k}`); sink('chat_feedback', { kind: k }); },
    regenerate() { hit(`${base}_chat_regen`); sink('chat_regenerate'); },
    copied() { hit(`${base}_chat_copy`); sink('chat_copy'); },
    newConversation() { endConversation(); convo = { started: false, msgs: 0, ended: false }; }
  };
  window.addEventListener('pagehide', endConversation);

  // ---------- audience: source, device, new / returning, retention ----------
  function sourceCategory() {
    try {
      const q = new URLSearchParams(location.search), utm = (q.get('utm_source') || q.get('ref') || '').toLowerCase();
      const probe = utm || (document.referrer ? new URL(document.referrer).hostname.toLowerCase() : '');
      if (!probe) return 'direct';
      if (/(google|bing|duckduckgo|yahoo|baidu|ecosia|brave|search)/.test(probe)) return 'search';
      if (/(twitter|x\.com|t\.co|facebook|fb\.|instagram|linkedin|lnkd|reddit|youtube|youtu\.be|tiktok|whatsapp|telegram|discord|threads)/.test(probe)) return 'social';
      if (/github/.test(probe)) return 'github';
      if (/(mail|email|newsletter|outlook)/.test(probe)) return 'email';
      if (document.referrer && new URL(document.referrer).hostname === location.hostname) return 'direct';
      return 'other';
    } catch (e) { return 'other'; }
  }
  function audience() {
    hit(`${base}_src_${sourceCategory()}`);
    hit(`${base}_dev_${/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 760 ? 'mobile' : 'desktop'}`);
    const today = day(), first = store.get('an_first');
    if (!first) { store.set('an_first', today); count('new'); return; }
    count('returning');
    const ds = dayNum(today) - dayNum(first), marks = JSON.parse(store.get('an_ret') || '{}');
    if (ds === 1 && !marks.r1) { marks.r1 = 1; hit(`${base}_ret1_${first}`); }
    if (ds >= 6 && ds <= 8 && !marks.r7) { marks.r7 = 1; hit(`${base}_ret7_${first}`); }
    store.set('an_ret', JSON.stringify(marks));
  }

  // ---------- performance (Core Web Vitals) + errors ----------
  function vitals() {
    if (typeof PerformanceObserver === 'undefined') return;
    const v = { lcp: null, cls: 0, inp: null };
    const obs = (type, cb, extra) => { try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe(Object.assign({ type, buffered: true }, extra || {})); } catch (e) { /* unsupported */ } };
    obs('largest-contentful-paint', (e) => { v.lcp = e.startTime; });
    obs('layout-shift', (e) => { if (!e.hadRecentInput) v.cls += e.value; });
    obs('event', (e) => { if (e.interactionId && (v.inp === null || e.duration > v.inp)) v.inp = e.duration; }, { durationThreshold: 40 });
    let sent = false;
    const rate = (x, good, poor) => (x <= good ? 'good' : x <= poor ? 'ni' : 'poor');
    const report = () => {
      if (sent || document.visibilityState !== 'hidden') return; sent = true;
      if (v.lcp !== null) hit(`${base}_cwv_lcp_${rate(v.lcp, 2500, 4000)}`);
      hit(`${base}_cwv_cls_${rate(v.cls, 0.1, 0.25)}`);
      if (v.inp !== null) hit(`${base}_cwv_inp_${rate(v.inp, 200, 500)}`);
      sink('web_vitals', { lcp: v.lcp && Math.round(v.lcp), cls: +v.cls.toFixed(3), inp: v.inp && Math.round(v.inp) });
    };
    document.addEventListener('visibilitychange', report); window.addEventListener('pagehide', report);
  }
  let errCount = 0;
  function errors() {
    const onErr = (msg) => { if (errCount++ < 3) { count('jserr'); sink('js_error', { msg: String(msg).slice(0, 120) }); } };
    window.addEventListener('error', (e) => onErr(e.message || 'error'));
    window.addEventListener('unhandledrejection', (e) => onErr((e.reason && e.reason.message) || 'unhandled rejection'));
  }

  // ---------- main ----------
  function isNewSession() {
    if (store.get('nexora_tracker_session', true)) return false;
    store.set('nexora_tracker_session', Date.now().toString(), true); return true;
  }
  function startPresence() { const ping = () => hit(KEYS.online); ping(); setInterval(ping, 30000); }

  async function init() {
    const views = await hit(base);
    hit(`${base}_${day()}`);
    if (isNewSession()) {
      hit(`${base}_sessions`); audience();
      let visible = 0;
      const tick = setInterval(() => {
        if (document.visibilityState === 'visible') visible += 1;
        if (visible >= 30) { clearInterval(tick); hit(`${base}_engaged`); }
      }, 1000);
    }
    vitals(); errors(); startPresence(); sink('pageview', { path: location.pathname });
    window.__NEXORA_TRACKER__ = { site, views, getViews: () => get(base),
      getAll: async () => ({ nexora: await get(KEYS.nexora), discipline: await get(KEYS.discipline), dashboard: await get(KEYS.dashboard), onlinePings: await get(KEYS.online) }) };
    log('ready for', site, '| total views:', views);
  }

  // public API is available immediately, so chat code can call it before init finishes
  window.AnalysisTracker = { site, track, chat, classifyTopic, visitorId };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
