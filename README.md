# Dashboard — ansh4013

Personal dashboard, Discipline tracker, Nexora analysis tools, and Supabase login gate.

**Live (GitHub Pages):** https://ansh4013.github.io/dashboard/

---

## Branch: `feature/analysis-login-supabase`

This branch adds:

| Path | Description |
|------|-------------|
| `realtime-analysis.html` | Live visitor counters + security report |
| `analysis-dashboard.html` | Full static analysis template |
| `analyze-sites.js` | CLI analysis script (Node 18+) |
| `nexora-login-supabase.html` | Login gate → saves to Supabase |
| `nexora-gate.js` | Forces login on first visit |
| `tracker.js` | Lightweight page-view tracker |
| `supabase-schema.sql` | Table + RLS for Supabase |
| `SUPABASE-SETUP.md` | Full Supabase setup guide |
| `server.js` | Local static server with friendly routes |
| `package.json` | `npm start` / `npm run analyze` |

---

## Quick start (local)

```bash
git clone https://github.com/ansh4013/dashboard.git
cd dashboard
git checkout feature/analysis-login-supabase

node server.js
# → http://localhost:3000/
```

Or:

```bash
npm start
```

---

## Deploy

### GitHub Pages (already used)

After merging this branch to `main` (or enabling Pages on this branch):

- Dashboard: `https://ansh4013.github.io/dashboard/dashboard.html`
- Discipline: `https://ansh4013.github.io/dashboard/discipline.html`
- Analysis:   `https://ansh4013.github.io/dashboard/realtime-analysis.html`
- Login:      `https://ansh4013.github.io/dashboard/nexora-login-supabase.html`

### Vercel / any static host

Point the project root at this repo. `server.js` is optional (only needed for local Node).

---

## Supabase login

1. Create a free project at https://supabase.com
2. Run `supabase-schema.sql` in the SQL Editor
3. Copy Project URL + `anon` key into `nexora-login-supabase.html`
4. See **SUPABASE-SETUP.md** for the full guide

---

## Live counters

`tracker.js` increments public counters (no signup).  
Add to any page:

```html
<script src="./tracker.js" data-site="dashboard" async></script>
```

`data-site` can be: `nexora` | `discipline` | `dashboard`

Open `realtime-analysis.html` to watch the numbers update every 15s.

---

## Scripts

```bash
npm run analyze   # runs analyze-sites.js against live sites
npm start         # local server on port 3000
```

---

## Original files

- `dashboard.html` — main personal dashboard  
- `discipline.html` — habit / discipline tracker  

## Ranking System (separate from the analysis pages)

Everything lives in ``:

| File | Purpose |
|---|---|
| `analysis-config.js` | Sites, metric weights, presets, thresholds |
| `analysis-algorithms.js` | PageRank, Elo league, HN-style hot score, IMDb Bayesian rating, Wilson bound, Reciprocal Rank Fusion |
| `analysis-engine.js` | Scoring engine (browser + Node), caching, rank movement, CSV |
| `analysis.html` | Leaderboard UI: podium, score breakdown, insights, weight sliders, export |

Each site is scored 0-100 on Reach, Traction, Momentum, Consistency, Engagement, Authority (PageRank),
Freshness (Hacker-News gravity) and Elo (daily head-to-head), combined with adjustable weights or
weighted Reciprocal Rank Fusion, damped for low-sample sites, and ranked 1st, 2nd, 3rd...
`dashboard.html` shows a compact version and re-orders its site cards by rank.
`node analyze-sites.js` prints the same ranking in the terminal.

Add `tracker.js` to every site (Nexora: `data-site="nexora"`) so daily views,
sessions and engaged sessions are recorded. Engagement is scored once that data exists.

## Analysis Workspace (product & project management)

`analysis-workspace.html` is a separate page with the practices big tech teams use:

| Tab | Practice | What it does |
|---|---|---|
| Overview | Weekly business review (Amazon), north-star metric, RAG health, AARRR funnel | One-screen status + auto-generated Markdown report |
| OKRs | Google OKRs | Key results can be **Live** (pulled from your counters); 0.7 = success; confidence per KR |
| Roadmap | Now/Next/Later + RICE (Intercom) | Drag-and-drop lanes, auto-prioritised backlog, quick-win / big-bet tags |
| Sprint | Agile burndown & velocity | Ideal vs actual vs forecast line, velocity history, next-sprint sizing |
| Experiments | A/B testing (Meta, Netflix) | z-test, confidence interval, Bayesian P(best), power check, ship/keep decision |
| Feature flags | Gatekeeper / LaunchDarkly | % rollouts, kill switch, per-environment targeting, tiny SDK (`analysis-flags.js`) |
| Reliability | Google SRE | Uptime/latency probes, SLO, error-budget burn, incident log |
| Decisions & risks | ADRs, risk register | Decision log and likelihood x impact scoring |

Press Ctrl/Cmd + K for the command palette. Data is stored in your browser; use Export backup on the
Overview tab to save or move it.

> Note: `analysis.html` and `analysis-workspace.html` have the engine, config, algorithms (and flags SDK)
> inlined so each page works as a single file, even when opened on its own. The separate `.js` files remain
> for Node (`analyze-sites.js`), `dashboard.html`, and your own sites. If you change a setting in
> `analysis-config.js`, make the same change in the inlined copy inside the two pages.

## More platform features

| Feature | Where | What it does |
|---|---|---|
| Insights | `analysis-workspace.html` → Insights | 7-day traffic forecast with an 80% band (Holt trend + weekday seasonality), robust anomaly detection (median + MAD, completed days only), and a ranked "next best actions" list |
| Alerts | Workspace → Activity (and the bell) | Fires on traffic drops/spikes, SLO breaches, error-budget burn and sprint risk; optional browser notifications |
| Activity feed | Workspace → Activity | Change log of everything done in the workspace |
| Status page | `analysis-status.html` | Public-style status page: overall banner, per-site status, 30-day uptime bars, incidents |
| Privacy | `tracker.js` | Skips visitors who send Do Not Track / Global Privacy Control. Turn off with `data-respect-dnt="false"`. Visitors can call `AnalysisPrivacy.optOut()` |

Extra server routes: `/ranking`, `/workspace`, `/status`.

## Chatbot analytics, audience and more (v2.1)

**Chatbot tab (Nexora AI)** — conversations, messages, satisfaction (thumbs), error rate, reply-time percentiles,
conversation depth, topics, a chatbot health score, a chat funnel and specific "what to improve" advice.
It needs three small additions in the Nexora AI site. Copy the snippet from the tab's *Integration* card:

```js
const chat = window.AnalysisTracker && window.AnalysisTracker.chat;
chat && chat.messageSent(userText);          // text stays on the device; only a topic label is counted
const done = chat && chat.replyStarted();    // around the model call
done && done();                              // or done(false) on failure
chat && chat.feedback("up");                 // thumbs; also chat.regenerate(), chat.copied(), chat.newConversation()
```

| Feature | Where |
|---|---|
| Traffic sources, devices, new vs returning, day-1 / day-7 retention, custom funnels | Workspace -> Audience (tracker records them automatically; `AnalysisTracker.track("login")` for your own events) |
| Core Web Vitals and JavaScript error rate per site | Workspace -> Reliability |
| Chatbot metrics as OKR key results (conversations, satisfaction, error rate, p95 latency) | Workspace -> OKRs -> + KR |
| Alerts to Discord / Slack / Telegram | Workspace -> Activity -> Alert channels |
| Weekly report as Markdown, Print/PDF or email (now includes the chatbot) | Workspace -> Overview |
| Changelog editor + public page | Workspace -> Decisions & risks, `changelog.html`, `changelog.json` |
| Exact percentiles and unique visitors from your own database (optional) | `analytics-events.sql` (run in Supabase), then add `data-supabase-url` and `data-supabase-key` to the tracker tag |
| Demo data to preview any tab | "Show demo data" button |
| Deploy + checks with GitHub Actions | `github-pages-deploy.yml` (move to `.github/workflows/deploy.yml`) |
| Search and sharing | `sitemap.xml`, `robots.txt`, Open Graph tags |
| Accessibility and languages | skip link, tab roles, focus outlines, labelled buttons; English / Hindi / Spanish navigation |

Notes
- Counters are free public counters, so "unique visitors" are approximated by sessions. Use the Supabase option for exact numbers.
- Latency and depth percentiles are estimated from time buckets (< 1 s, 1-2 s, 2-4 s, 4-8 s, 8 s+).
- The language switcher translates the navigation only; page content stays in English.
