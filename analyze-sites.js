/**
 * analyze-sites.js
 * ----------------
 * Node / browser-compatible analysis helper for Nexora + Discipline.
 * Run with: node analyze-sites.js   (requires Node 18+)
 * Or paste the browser version from realtime-analysis.html into console.
 */

const sites = [
  {
    name: 'Nexora AI',
    url: 'https://ansh4013.github.io/aichatbot-/',
    key: 'ansh4013_nexora_views'
  },
  {
    name: 'Discipline',
    url: 'https://ansh4013.github.io/dashboard/discipline.html',
    key: 'ansh4013_discipline_views'
  },
  {
    name: 'Main Dashboard',
    url: 'https://ansh4013.github.io/dashboard/dashboard.html',
    key: 'ansh4013_dashboard_views'
  }
];

// Ranking comes from the standalone ranking system (./analysis-engine.js)
const Ranking = require('./analysis-engine.js');

async function checkHeaders(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return {
      status: res.status,
      https: url.startsWith('https'),
      hsts: res.headers.get('strict-transport-security') || null,
      csp: res.headers.get('content-security-policy') || null,
      xcto: res.headers.get('x-content-type-options') || null,
      referrer: res.headers.get('referrer-policy') || null,
      server: res.headers.get('server') || null
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  console.log('\n=== Nexora + Discipline Analysis ===\n');
  console.log(new Date().toISOString());
  console.log('------------------------------------\n');

  const ranked = await Ranking.compute();
  console.log(`Ranking status: ${ranked.status}\n`);
  for (const r of ranked.rows) {
    console.log(`${r.ordinal.padEnd(4)} ${r.name.padEnd(16)} score ${r.score === null ? '—' : r.score.toFixed(1)}  ` +
      `views ${r.total}  7d ${r.recent7}  trend ${r.trend}`);
  }
  console.log('\n------------------------------------\n');

  for (const r of ranked.rows) {
    const site = sites.find(x => x.name === r.name) || { name: r.name, url: r.url };
    const headers = await checkHeaders(site.url);
    const views = r.total;
    console.log(`▶ ${r.ordinal} — ${site.name}`);
    console.log(`  URL: ${site.url}`);

    console.log(`  Views (tracker): ${views}`);
    if (headers.error) {
      console.log(`  Headers: ERROR – ${headers.error}`);
    } else {
      console.log(`  Status: ${headers.status}`);
      console.log(`  HSTS: ${headers.hsts ? '✓' : '✗'}`);
      console.log(`  CSP: ${headers.csp ? '✓' : '✗ missing'}`);
      console.log(`  X-Content-Type-Options: ${headers.xcto || '✗ missing'}`);
      console.log(`  Referrer-Policy: ${headers.referrer || '✗ missing'}`);
      console.log(`  Server: ${headers.server || '—'}`);
    }
    console.log('');
  }

  console.log('Notes:');
  console.log('• Install tracker.js on each live page to start collecting real views.');
  console.log('• Open realtime-analysis.html to watch live counters.');
  console.log('• Add security headers via a meta CSP tag or Cloudflare (GitHub Pages cannot set headers) for production hardening.\n');
}

main().catch(console.error);
