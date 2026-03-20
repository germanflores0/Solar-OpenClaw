/**
 * Solar Agent Gateway
 *
 * Reverse proxy for OpenClaw adapted for the Solar orchestration platform.
 * Based on the SimplestClaw gateway pattern.
 *
 * Handles:
 * - HTTP proxying to OpenClaw's internal port
 * - WebSocket upgrade proxying for real-time communication
 * - Health checks for deployment platforms (Railway, etc.)
 * - Header rewriting to make connections appear local to OpenClaw
 * - Passing SOLAR_* env vars to OpenClaw so the plugin can read them
 *
 * Architecture:
 * [Internet] -> [PORT] -> [This Proxy] -> [OpenClaw :18789]
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY       - (required) Anthropic Claude API key
 *   SOLAR_API_URL           - Solar API base URL (for plugin communication)
 *   SOLAR_TOKEN             - Solar authentication token
 *   SOLAR_AGENT_ID          - Solar agent identifier
 *   OPENCLAW_GATEWAY_TOKEN  - Gateway authentication token
 *   PORT                    - HTTP server port (default: 3000)
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT || 3000;
const OPENCLAW_PORT = 18789;

// =============================================================================
// State
// =============================================================================

let openclawHealthy = false;
let openclawProcess = null;

// =============================================================================
// Environment Validation
// =============================================================================

/**
 * Validates that ANTHROPIC_API_KEY is set.
 * @returns {boolean} True if environment is valid
 */
function validateEnvironment() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('');
    console.error('ERROR: ANTHROPIC_API_KEY is required but not set.');
    console.error('Set it in your deployment platform environment variables.');
    console.error('');
    return false;
  }

  console.log('ANTHROPIC_API_KEY configured');

  if (process.env.SOLAR_API_URL) {
    console.log(`SOLAR_API_URL: ${process.env.SOLAR_API_URL}`);
  }
  if (process.env.SOLAR_AGENT_ID) {
    console.log(`SOLAR_AGENT_ID: ${process.env.SOLAR_AGENT_ID}`);
  }
  if (process.env.SOLAR_TOKEN) {
    console.log('SOLAR_TOKEN: [set]');
  }

  return true;
}

// =============================================================================
// OpenClaw Process Management
// =============================================================================

/**
 * Starts OpenClaw gateway as a child process.
 * Passes SOLAR_* env vars so the plugin extension can read them.
 */
function startOpenClaw() {
  console.log('Starting OpenClaw gateway...');

  const args = [
    'openclaw',
    'gateway',
    '--port',
    String(OPENCLAW_PORT),
    '--bind',
    'lan',
    '--allow-unconfigured',
  ];

  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    args.push('--token', process.env.OPENCLAW_GATEWAY_TOKEN);
  }

  openclawProcess = spawn('npx', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_OPTIONS: '--max-old-space-size=2048',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      SOLAR_API_URL: process.env.SOLAR_API_URL,
      SOLAR_TOKEN: process.env.SOLAR_TOKEN,
      SOLAR_AGENT_ID: process.env.SOLAR_AGENT_ID,
      OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN,
    },
  });

  openclawProcess.stdout.on('data', (data) => {
    console.log(`[openclaw] ${data.toString().trim()}`);
    if (data.toString().includes('listening') || data.toString().includes('started')) {
      openclawHealthy = true;
    }
  });

  openclawProcess.stderr.on('data', (data) => {
    console.error(`[openclaw] ${data.toString().trim()}`);
  });

  openclawProcess.on('close', (code) => {
    console.log(`OpenClaw exited with code ${code}`);
    openclawHealthy = false;
    setTimeout(startOpenClaw, 5000);
  });

  // Fallback health mark if log detection misses the startup message
  setTimeout(() => {
    openclawHealthy = true;
  }, 5000);
}

// =============================================================================
// HTTP Proxy
// =============================================================================

/**
 * Filters out proxy-related headers so OpenClaw treats connections as local.
 * Prevents "pairing required" / Control UI origin errors.
 *
 * @param {Object} headers - Original request headers
 * @returns {Object} Filtered headers
 */
function filterProxyHeaders(headers) {
  const filtered = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (
      !lowerKey.startsWith('x-forwarded') &&
      !lowerKey.startsWith('x-real') &&
      lowerKey !== 'forwarded'
    ) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Proxies an HTTP request to OpenClaw's internal port.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function proxyRequest(req, res) {
  const options = {
    hostname: 'localhost',
    port: OPENCLAW_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...filterProxyHeaders(req.headers),
      host: `localhost:${OPENCLAW_PORT}`,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway', message: 'OpenClaw not available' }));
  });

  req.pipe(proxyReq);
}

// =============================================================================
// HTTP Server
// =============================================================================

const server = http.createServer((req, res) => {
  // Health check
  if (req.url === '/health') {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    if (openclawHealthy && hasKey) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          gateway: 'Solar Agent Gateway',
          openclaw: 'running',
          wsPort: OPENCLAW_PORT,
        })
      );
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: hasKey ? 'starting' : 'misconfigured',
          gateway: 'Solar Agent Gateway',
          error: hasKey ? null : 'ANTHROPIC_API_KEY not configured',
        })
      );
    }
    return;
  }

  // Root returns JSON status (no HTML welcome page)
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        gateway: 'Solar Agent Gateway',
        status: openclawHealthy ? 'ready' : 'starting',
        health: '/health',
      })
    );
    return;
  }

  // Proxy everything else to OpenClaw
  proxyRequest(req, res);
});

// =============================================================================
// WebSocket Proxy
// =============================================================================

/**
 * Handles WebSocket upgrade requests by proxying to OpenClaw.
 * Rewrites headers to make the connection appear local.
 */
server.on('upgrade', (req, socket, head) => {
  const proxySocket = net.connect(OPENCLAW_PORT, 'localhost', () => {
    const rewrittenHeaders = Object.entries(req.headers)
      .filter(([key]) => {
        const lowerKey = key.toLowerCase();
        return (
          !lowerKey.startsWith('x-forwarded') &&
          !lowerKey.startsWith('x-real') &&
          lowerKey !== 'forwarded'
        );
      })
      .map(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'host') {
          return `${key}: localhost:${OPENCLAW_PORT}`;
        }
        if (lowerKey === 'origin') {
          return `${key}: http://localhost:${OPENCLAW_PORT}`;
        }
        return `${key}: ${value}`;
      })
      .join('\r\n');

    const upgradeRequest = [`${req.method} ${req.url} HTTP/1.1`, rewrittenHeaders, '', ''].join(
      '\r\n'
    );

    proxySocket.write(upgradeRequest);

    if (head && head.length > 0) {
      proxySocket.write(head);
    }

    socket.pipe(proxySocket);
    proxySocket.pipe(socket);
  });

  proxySocket.on('error', (err) => {
    console.error(`WebSocket proxy error: ${err.message}`);
    socket.end();
  });

  socket.on('error', (err) => {
    console.error(`Client socket error: ${err.message}`);
    proxySocket.end();
  });
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  if (openclawProcess) {
    openclawProcess.kill('SIGTERM');
  }
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  if (openclawProcess) {
    openclawProcess.kill('SIGTERM');
  }
  server.close(() => process.exit(0));
});

// =============================================================================
// Startup
// =============================================================================

console.log('');
console.log('Solar Agent Gateway');
console.log('OpenClaw reverse proxy for Solar orchestration platform');
console.log('');

const envValid = validateEnvironment();

// Start OpenClaw even if env is invalid (health check will report misconfigured)
startOpenClaw();

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log(`Proxy listening on port ${PORT}`);
  console.log(`OpenClaw on internal port ${OPENCLAW_PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log('');
});
