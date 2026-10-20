/**
 * Simple static + convenience server for the dashboard repo.
 * Works for local testing and can be deployed on any Node host.
 *
 * Usage:
 *   node server.js
 *   PORT=3000 node server.js
 *
 * Then open:
 *   http://localhost:3000/                 → dashboard
 *   http://localhost:3000/discipline       → discipline
 *   http://localhost:3000/analysis         → realtime analysis
 *   http://localhost:3000/login            → Nexora login (Supabase)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// Friendly routes → real files
const ROUTES = {
  '/': 'dashboard.html',
  '/dashboard': 'dashboard.html',
  '/dashboard.html': 'dashboard.html',
  '/discipline': 'discipline.html',
  '/discipline.html': 'discipline.html',
  '/analysis': 'realtime-analysis.html',
  '/analysis/': 'realtime-analysis.html',
  '/analysis/realtime': 'realtime-analysis.html',
  '/analysis/full': 'analysis-dashboard.html',
  '/login': 'nexora-login-supabase.html',
  '/login/': 'nexora-login-supabase.html',
  '/login/nexora': 'nexora-login-supabase.html',
  '/ranking': 'analysis.html',
  '/workspace': 'analysis-workspace.html',
  '/status': 'analysis-status.html'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function serveFile(res, filePath) {
  const abs = path.normalize(path.join(ROOT, filePath));
  if (!abs.startsWith(ROOT)) {
    return send(res, 403, 'Forbidden');
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') return send(res, 404, 'Not found: ' + filePath);
      return send(res, 500, 'Server error');
    }
    const ext = path.extname(abs).toLowerCase();
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = decodeURIComponent(u.pathname);

  // Health check
  if (pathname === '/health' || pathname === '/api/health') {
    return send(res, 200, JSON.stringify({
      ok: true,
      service: 'ansh4013-dashboard',
      time: new Date().toISOString()
    }), 'application/json');
  }

  // Friendly routes
  if (ROUTES[pathname]) {
    return serveFile(res, ROUTES[pathname]);
  }

  // Direct file access (scripts/, analysis/, login/, root files)
  if (pathname.startsWith('/')) pathname = pathname.slice(1);
  if (!pathname || pathname.includes('..')) {
    return send(res, 400, 'Bad request');
  }

  serveFile(res, pathname || 'dashboard.html');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Dashboard server running');
  console.log('  -----------------------');
  console.log(`  Local:     http://localhost:${PORT}/`);
  console.log(`  Discipline http://localhost:${PORT}/discipline`);
  console.log(`  Analysis:  http://localhost:${PORT}/analysis`);
  console.log(`  Login:     http://localhost:${PORT}/login`);
  console.log(`  Health:    http://localhost:${PORT}/health`);
  console.log('');
});
