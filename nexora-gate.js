/**
 * nexora-gate.js
 * --------------
 * Forces first-time visitors through the Nexora login page.
 *
 * Usage (add near the top of <body> on the main Nexora site):
 *
 *   <script
 *     src="https://YOUR-HOST/nexora-gate.js"
 *     data-login-url="https://YOUR-HOST/nexora-login-supabase.html"
 *     defer>
 *   </script>
 */

(function () {
  'use strict';

  const script = document.currentScript;
  const LOGIN_URL = (script && script.dataset.loginUrl) ||
    'https://YOUR-HOST/nexora-login-supabase.html';
  const SESSION_KEY = 'nexora_logged_in';

  // Already passed the gate this session
  if (sessionStorage.getItem(SESSION_KEY)) return;

  // Avoid loop if we are already on a login page
  const href = location.href.toLowerCase();
  if (href.includes('login') || href.includes('nexora-login')) return;

  window.location.replace(
    LOGIN_URL + (LOGIN_URL.includes('?') ? '&' : '?') +
    'return=' + encodeURIComponent(location.href)
  );
})();
