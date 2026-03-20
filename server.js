/**
 * Solar OpenClaw Gateway
 *
 * Reverse proxy that spawns OpenClaw as a child process and bridges
 * Railway's single HTTP port to OpenClaw's internal gateway port.
 * Injects the Solar plugin for task management, skill injection, and heartbeat.
 *
 * Architecture:
 *   [Internet] → [Railway :PORT] → [This Proxy] → [OpenClaw :18789]
 *
 * Based on the SimplestClaw gateway pattern with improvements:
 * - Solar plugin injection into OpenClaw extensions
 * - Proper health checks via TCP probe (not stdout matching)
 * - Shutdown-safe restart logic
 * - No XSS/path-traversal vulnerabilities
 *
 * Environment Variables:
 *   REQUIRED (at least one API key):
 *     ANTHROPIC_API_KEY    - Anthropic Claude API key
 *     OPENAI_API_KEY       - OpenAI GPT API key
 *     GOOGLE_API_KEY       - Google Gemini API key
 *     OPENROUTER_API_KEY   - OpenRouter API key
 *
 *   SOLAR INTEGRATION:
 *     SOLAR_API_URL        - Solar backend URL (e.g. https://solar-api.up.railway.app/api)
 *     SOLAR_TOKEN          - Plugin auth token (from agent creation in Solar)
 *     SOLAR_AGENT_ID       - Agent ID in Solar
 *
 *   OPTIONAL:
 *     OPENCLAW_GATEWAY_TOKEN - Gateway auth token (auto-generated or manual)
 *     PORT                   - HTTP port (Railway sets this)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT || 3000;
const OPENCLAW_PORT = 18789;
const HEALTH_PROBE_INTERVAL = 5000;
const RESTART_DELAY = 5000;
const MAX_RESTARTS = 10;

const API_KEY_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY',
];

// =============================================================================
// State
// =============================================================================

let openclawHealthy = false;
let openclawProcess = null;
let hasApiKey = false;
let isShuttingDown = false;
let restartCount = 0;
let healthProbeTimer = null;

// =============================================================================
// Environment Validation
// =============================================================================

function validateEnvironment() {
  hasApiKey = API_KEY_VARS.some((key) => process.env[key]?.trim());

  if (!hasApiKey) {
    console.error('[solar] No API key configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or OPENROUTER_API_KEY.');
  } else {
    const providers = API_KEY_VARS.filter((k) => process.env[k]?.trim()).map((k) => k.replace('_API_KEY', '').toLowerCase());
    console.log(`[solar] API keys: ${providers.join(', ')}`);
  }

  if (process.env.SOLAR_API_URL) {
    console.log(`[solar] Solar backend: ${process.env.SOLAR_API_URL}`);
  }
  if (process.env.SOLAR_AGENT_ID) {
    console.log(`[solar] Agent ID: ${process.env.SOLAR_AGENT_ID}`);
  }
}

// =============================================================================
// Plugin Installation
// =============================================================================

/**
 * Copy the bundled Solar plugin into OpenClaw's extensions directory
 * and write the config files so the plugin knows how to reach Solar.
 */
function installPlugin() {
  const pluginSrc = path.join(__dirname, 'extensions', 'solar');

  // 1. Find where openclaw is installed
  let openclawDir;
  try {
    // Try createRequire first (works in CJS-compatible setups)
    const req = createRequire(import.meta.url);
    const openclawPkg = req.resolve('openclaw/package.json');
    openclawDir = path.dirname(openclawPkg);
  } catch {
    // Fallback: check well-known path relative to project root
    const fallback = path.join(__dirname, 'node_modules', 'openclaw');
    if (fs.existsSync(path.join(fallback, 'package.json'))) {
      openclawDir = fallback;
    } else {
      console.warn('[solar] Could not resolve openclaw package path — plugin injection skipped');
      return;
    }
  }

  // 2. Copy plugin to openclaw's extensions dir
  const extensionsDest = path.join(openclawDir, 'extensions', 'solar');
  try {
    fs.mkdirSync(extensionsDest, { recursive: true });
    const files = fs.readdirSync(pluginSrc);
    for (const file of files) {
      fs.copyFileSync(path.join(pluginSrc, file), path.join(extensionsDest, file));
    }
    console.log(`[solar] Plugin installed to ${extensionsDest} (${files.length} files)`);
  } catch (err) {
    console.error(`[solar] Plugin install failed: ${err.message}`);
  }

  // 3. Also copy to ~/.openclaw/hooks/solar/ (belt-and-suspenders)
  const homeDir = os.homedir();
  const hooksDir = path.join(homeDir, '.openclaw', 'hooks', 'solar');
  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    const files = fs.readdirSync(pluginSrc);
    for (const file of files) {
      fs.copyFileSync(path.join(pluginSrc, file), path.join(hooksDir, file));
    }
  } catch {
    // Not critical — extension dir is primary
  }

  // 4. Write solar.config.json so plugin knows how to reach Solar
  const solarConfig = {
    apiUrl: process.env.SOLAR_API_URL || 'http://localhost:3000/api',
    token: process.env.SOLAR_TOKEN || '',
    agentId: process.env.SOLAR_AGENT_ID || '',
  };

  for (const dir of [extensionsDest, hooksDir]) {
    try {
      fs.writeFileSync(path.join(dir, 'solar.config.json'), JSON.stringify(solarConfig, null, 2));
    } catch { /* best effort */ }
  }

  // 5. Write openclaw.json with plugin enabled + Control UI disabled
  const openclawConfig = {
    gateway: {
      mode: 'local',
      port: OPENCLAW_PORT,
      bind: 'lan',
      controlUi: {
        enabled: false,
      },
    },
    agents: {
      defaults: {
        model: {
          primary: 'anthropic/claude-sonnet-4',
        },
      },
      list: [{ id: 'main', default: true }],
    },
  };

  const configDir = path.join(homeDir, '.openclaw');
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'openclaw.json'), JSON.stringify(openclawConfig, null, 2));
    console.log(`[solar] OpenClaw config written to ${configDir}/openclaw.json`);
  } catch (err) {
    console.error(`[solar] Config write failed: ${err.message}`);
  }
}

// =============================================================================
// Health Probe (TCP-based, not stdout matching)
// =============================================================================

function startHealthProbe() {
  healthProbeTimer = setInterval(() => {
    const socket = new net.Socket();
    socket.setTimeout(2000);

    socket.connect(OPENCLAW_PORT, '127.0.0.1', () => {
      openclawHealthy = true;
      socket.destroy();
    });

    socket.on('error', () => {
      openclawHealthy = false;
      socket.destroy();
    });

    socket.on('timeout', () => {
      openclawHealthy = false;
      socket.destroy();
    });
  }, HEALTH_PROBE_INTERVAL);
}

// =============================================================================
// OpenClaw Process Management
// =============================================================================

function startOpenClaw() {
  if (isShuttingDown) return;

  if (restartCount >= MAX_RESTARTS) {
    console.error(`[solar] OpenClaw crashed ${MAX_RESTARTS} times — giving up`);
    return;
  }

  console.log(`[solar] Starting OpenClaw gateway (attempt ${restartCount + 1})...`);

  const args = [
    'openclaw', 'gateway',
    '--port', String(OPENCLAW_PORT),
    '--bind', 'lan',
    '--allow-unconfigured',
  ];

  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    args.push('--token', process.env.OPENCLAW_GATEWAY_TOKEN);
  }

  openclawProcess = spawn('npx', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_OPTIONS: `--max-old-space-size=2048 ${process.env.NODE_OPTIONS || ''}`.trim(),
      // Solar plugin env vars
      SOLAR_API_URL: process.env.SOLAR_API_URL || '',
      SOLAR_TOKEN: process.env.SOLAR_TOKEN || '',
      SOLAR_AGENT_ID: process.env.SOLAR_AGENT_ID || '',
    },
  });

  openclawProcess.stdout.on('data', (data) => {
    console.log(`[openclaw] ${data.toString().trim()}`);
  });

  openclawProcess.stderr.on('data', (data) => {
    console.error(`[openclaw] ${data.toString().trim()}`);
  });

  openclawProcess.on('close', (code) => {
    console.log(`[solar] OpenClaw exited with code ${code}`);
    openclawHealthy = false;
    openclawProcess = null;

    if (!isShuttingDown) {
      restartCount++;
      const delay = Math.min(RESTART_DELAY * restartCount, 30000);
      console.log(`[solar] Restarting in ${delay / 1000}s...`);
      setTimeout(startOpenClaw, delay);
    }
  });

  // Reset restart count on successful sustained run (30s)
  setTimeout(() => {
    if (openclawProcess && !openclawProcess.killed) {
      restartCount = 0;
    }
  }, 30000);
}

// =============================================================================
// HTTP Proxy
// =============================================================================

function filterProxyHeaders(headers) {
  const filtered = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (!k.startsWith('x-forwarded') && !k.startsWith('x-real') && k !== 'forwarded' && k !== 'via') {
      filtered[key] = value;
    }
  }
  return filtered;
}

function proxyRequest(req, res) {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: OPENCLAW_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...filterProxyHeaders(req.headers),
      host: `127.0.0.1:${OPENCLAW_PORT}`,
    },
    timeout: 30000,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway Timeout' }));
    }
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
    }
  });

  req.on('error', () => proxyReq.destroy());
  req.pipe(proxyReq);
}

// =============================================================================
// HTTP Server
// =============================================================================

const server = http.createServer((req, res) => {
  // Health check
  if (req.url === '/health') {
    const status = openclawHealthy && hasApiKey ? 200 : 503;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      gateway: 'Solar OpenClaw Gateway',
      status: openclawHealthy ? 'ok' : 'starting',
      openclaw: openclawHealthy ? 'running' : 'unavailable',
      hasApiKey,
      hasSolarConfig: !!(process.env.SOLAR_API_URL && process.env.SOLAR_TOKEN),
    }));
    return;
  }

  // Status page (root)
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      gateway: 'Solar OpenClaw Gateway',
      status: openclawHealthy ? 'ready' : 'starting',
      solar: {
        apiUrl: process.env.SOLAR_API_URL || null,
        agentId: process.env.SOLAR_AGENT_ID || null,
        connected: !!(process.env.SOLAR_TOKEN),
      },
    }));
    return;
  }

  // Proxy everything else to OpenClaw
  proxyRequest(req, res);
});

// =============================================================================
// WebSocket Proxy
// =============================================================================

server.on('upgrade', (req, socket, head) => {
  const proxySocket = net.connect({ port: OPENCLAW_PORT, host: '127.0.0.1', timeout: 10000 }, () => {
    const rewrittenHeaders = Object.entries(req.headers)
      .filter(([key]) => {
        const k = key.toLowerCase();
        return !k.startsWith('x-forwarded') && !k.startsWith('x-real') && k !== 'forwarded' && k !== 'via';
      })
      .map(([key, value]) => {
        const k = key.toLowerCase();
        if (k === 'host') return `${key}: 127.0.0.1:${OPENCLAW_PORT}`;
        if (k === 'origin') return `${key}: http://127.0.0.1:${OPENCLAW_PORT}`;
        return `${key}: ${value}`;
      })
      .join('\r\n');

    proxySocket.write(`${req.method} ${req.url} HTTP/1.1\r\n${rewrittenHeaders}\r\n\r\n`);
    if (head?.length > 0) proxySocket.write(head);

    socket.pipe(proxySocket);
    proxySocket.pipe(socket);
  });

  proxySocket.on('timeout', () => {
    proxySocket.destroy();
    socket.end();
  });

  proxySocket.on('error', (err) => {
    console.error(`[solar] WebSocket proxy error: ${err.message}`);
    socket.destroy();
  });

  socket.on('error', () => proxySocket.destroy());
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

function shutdown(signal) {
  console.log(`[solar] ${signal} received, shutting down...`);
  isShuttingDown = true;

  if (healthProbeTimer) clearInterval(healthProbeTimer);

  if (openclawProcess) {
    openclawProcess.kill('SIGTERM');
    setTimeout(() => {
      if (openclawProcess && !openclawProcess.killed) {
        openclawProcess.kill('SIGKILL');
      }
    }, 5000);
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// =============================================================================
// Startup
// =============================================================================

console.log('');
console.log('[solar] ╔══════════════════════════════════════╗');
console.log('[solar] ║  Solar OpenClaw Gateway               ║');
console.log('[solar] ╚══════════════════════════════════════╝');
console.log('');

validateEnvironment();
installPlugin();
startOpenClaw();
startHealthProbe();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[solar] Proxy listening on port ${PORT}`);
  console.log(`[solar] OpenClaw gateway on internal port ${OPENCLAW_PORT}`);
  console.log(`[solar] Health check: http://localhost:${PORT}/health`);
});
