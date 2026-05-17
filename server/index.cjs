/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? '';
// In production set FRONTEND_URL to your public domain, e.g. https://mysite.example.com
const FRONTEND = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// CORS: dev = any localhost; production = exact FRONTEND_URL only
const corsOrigin = IS_PROD
  ? FRONTEND.replace(/\/$/, '')
  : /^http:\/\/localhost(:\d+)?$/;

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '200mb' }));
app.use(express.text({ type: 'text/plain', limit: '200mb' }));

// ─── Static frontend (production only) ───────────────────────────────────────
if (IS_PROD) {
  const distDir = path.join(__dirname, '..', 'dist');
  app.use(express.static(distDir));
}

/**
 * GET /api/file?path=<absolute-path>
 * Returns the raw text content of the requested file.
 */
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path query parameter required' });
  }

  // Basic path safety: only allow .txt files
  if (!filePath.endsWith('.txt')) {
    return res.status(400).json({ error: 'Only .txt files are supported' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(404).json({ error: `Cannot read file: ${String(err)}` });
  }
});

/**
 * POST /api/file?path=<absolute-path>
 * Writes the request body (text/plain) to the file.
 * Creates a .bak backup of the original first.
 */
app.post('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path query parameter required' });
  }

  if (!filePath.endsWith('.txt')) {
    return res.status(400).json({ error: 'Only .txt files are supported' });
  }

  const content = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Request body must be text/plain' });
  }

  try {
    // Create backup before overwriting
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak');
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true, backup: filePath + '.bak' });
  } catch (err) {
    res.status(500).json({ error: `Cannot write file: ${String(err)}` });
  }
});

/**
 * POST /api/github-proxy
 * Proxies a request to api.github.com or raw.githubusercontent.com.
 * This avoids CORS issues in the browser.
 *
 * Request body: { url: string, method?: string, body?: object, token: string }
 * Response:     { ok: boolean, status: number, data: object | string }
 *
 * Special body key __rawContent: the proxy base64-encodes it via
 * Buffer.from(__rawContent, 'utf-8') before forwarding (needed for GitHub
 * commits which require base64-encoded file content).
 */
app.post('/api/github-proxy', async (req, res) => {
  const { url, method = 'GET', body, token } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  if (
    !url.startsWith('https://api.github.com/') &&
    !url.startsWith('https://raw.githubusercontent.com/')
  ) {
    return res.status(400).json({ error: 'url must point to api.github.com or raw.githubusercontent.com' });
  }
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }

  try {
    // Handle the __rawContent special key: base64-encode using Node Buffer
    let requestBody = body;
    if (requestBody && typeof requestBody === 'object' && '__rawContent' in requestBody) {
      const { __rawContent, ...rest } = requestBody;
      requestBody = { ...rest, content: Buffer.from(String(__rawContent), 'utf-8').toString('base64') };
    }

    const ghRes = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: requestBody ? JSON.stringify(requestBody) : undefined,
    });

    const contentType = ghRes.headers.get('content-type') ?? '';
    let data;
    if (contentType.includes('application/json')) {
      data = await ghRes.json();
    } else {
      data = await ghRes.text();
    }

    res.status(ghRes.status).json({ ok: ghRes.ok, status: ghRes.status, data });
  } catch (err) {
    res.status(500).json({ error: `Proxy fetch failed: ${String(err)}` });
  }
});

/**
 * GET /api/ping
 * Health check.
 */
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true });
});

// ─── OAuth ───────────────────────────────────────────────────────────────────

/**
 * GET /auth/login
 * Redirects the browser (or popup) to GitHub OAuth.
 */
app.get('/auth/login', (_req, res) => {
  if (!GITHUB_CLIENT_ID) {
    return res.status(500).send('GITHUB_CLIENT_ID is not configured in .env');
  }
  const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', GITHUB_CLIENT_ID);
  url.searchParams.set('scope', 'repo');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

/**
 * GET /auth/callback
 * GitHub posts the one-time code here. We exchange it for an access token and
 * serve a tiny HTML page that posts the token to the opener window, then closes.
 */
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing code parameter');
  }
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.status(500).send('OAuth app credentials are not configured in .env');
  }
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const data = await tokenRes.json();
    if (data.error) {
      return res.status(400).send(`GitHub OAuth error: ${data.error_description ?? data.error}`);
    }
    // Pass token to frontend via a tiny relay page — token goes in the hash so
    // it is never sent to any server in subsequent requests.
    const token = encodeURIComponent(String(data.access_token));
    res.type('html').send(`<!DOCTYPE html>
<html><head><title>Authenticating…</title></head>
<body><p style="font-family:sans-serif;color:#ccc;background:#0f172a;padding:2rem">
Authenticated! This tab will close automatically.</p>
<script>
(function() {
  var token = decodeURIComponent("${token}");
  if (window.opener) {
    window.opener.postMessage(
      { type: "github_oauth_token", token: token },
      "*"
    );
    setTimeout(function(){ window.close(); }, 300);
  } else {
    window.location.href = window.location.origin.replace(':3001', ':5173') + "/#token=" + encodeURIComponent(token);
  }
})();
</script></body></html>`);
  } catch (err) {
    res.status(500).send(`Token exchange failed: ${String(err)}`);
  }
});

// ─── SPA fallback (production only) ─────────────────────────────────────────
if (IS_PROD) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[server] Map editor API running on port ${PORT}`);
  if (!IS_PROD) console.log(`[server] Frontend expected at http://localhost:5173`);
});
