// Standalone Binance REST rate-limit / circuit-breaker module.
// Extracted from production code that had to survive Binance WAF.
//
// Status code semantics (from real-world incidents):
//   403 = CloudFront WAF IP ban (hard, ~hours to clear)
//   418 = "I'm a teapot" soft rate-limit warning, Retry-After can be ~4 hours
//   429 = Too Many Requests, standard rate-limit
//
// All blocking calls go through `isBinanceApiBlocked()` precheck so per-symbol
// REST calls return `null` instead of slamming a 418 IP.

let _blockedAt = 0;
let _blockTtlMs = 0;
let _consecutiveSoftHits = 0;
let _lastHitAt = 0;
const HARD_BLOCK_TTL_MS = 90 * 60_000;
const SOFT_BLOCK_BASE_MS = 5 * 60_000;
const SOFT_RESET_AFTER_MS = 60 * 60_000;

// Weight budget (X-MBX-USED-WEIGHT-1M)
const WEIGHT_LIMIT_PER_MIN = 2400;
const WEIGHT_HEADROOM_RATIO = 0.7;
let _usedWeight = 0;
let _weightResetAt = Date.now() + 60_000;

export function isBinanceApiBlocked(): boolean {
  if (_blockedAt === 0) return false;
  if (Date.now() - _blockedAt > _blockTtlMs) {
    _blockedAt = 0;
    _blockTtlMs = 0;
    return false;
  }
  return true;
}

export function markBinanceApiBlocked(severity: 'hard' | 'soft' = 'hard'): void {
  markBinanceApiBlockedWithRetry(severity, 0);
}

/**
 * Trip the circuit breaker.
 * - If Binance returned a real `Retry-After` header, honor it exactly
 * - Otherwise: hard → 90min; soft → exponential 5→15→60min
 * - Consecutive soft hits within 1h escalate the backoff
 */
export function markBinanceApiBlockedWithRetry(
  severity: 'hard' | 'soft',
  retryAfterSec: number
): void {
  const now = Date.now();

  if (severity === 'soft') {
    if (now - _lastHitAt > SOFT_RESET_AFTER_MS) _consecutiveSoftHits = 0;
    _consecutiveSoftHits++;
    _lastHitAt = now;
  }

  let ttlMs: number;
  if (retryAfterSec > 0) {
    ttlMs = retryAfterSec * 1000;
  } else if (severity === 'hard') {
    ttlMs = HARD_BLOCK_TTL_MS;
  } else {
    const multiplier = Math.min(Math.pow(3, _consecutiveSoftHits - 1), 12);
    ttlMs = SOFT_BLOCK_BASE_MS * multiplier;
  }

  _blockedAt = now;
  _blockTtlMs = ttlMs;
  console.warn(
    `[binance-blocked] severity=${severity} ttl=${Math.round(ttlMs / 1000)}s ` +
    `retryAfter=${retryAfterSec}s consecutiveSoft=${_consecutiveSoftHits}`
  );
}

export function clearBinanceApiBlocked(): void {
  _blockedAt = 0;
  _blockTtlMs = 0;
  _consecutiveSoftHits = 0;
}

export function detectBinanceBlockStatus(error: any): 'hard' | 'soft' | null {
  const status = error?.response?.status;
  if (status === 403) return 'hard';
  if (status === 418 || status === 429) return 'soft';
  return null;
}

/** Returns {sev, retryAfterSec} parsed from axios error. */
export function detectBinanceBlockDetails(
  error: any
): { sev: 'hard' | 'soft' | null; retryAfterSec: number } {
  const sev = detectBinanceBlockStatus(error);
  if (!sev) return { sev: null, retryAfterSec: 0 };
  const ra = error?.response?.headers?.['retry-after'];
  const retryAfterSec = ra ? parseInt(String(ra), 10) || 0 : 0;
  return { sev, retryAfterSec };
}

// ── Weight budget API ────────────────────────────────────────────────────────

/** Call from axios response interceptor with `headers['x-mbx-used-weight-1m']`. */
export function updateBinanceUsedWeight(usedWeightHeader: string | undefined): void {
  if (!usedWeightHeader) return;
  const w = parseInt(usedWeightHeader, 10);
  if (!Number.isFinite(w)) return;
  const now = Date.now();
  if (now >= _weightResetAt) {
    _usedWeight = w;
    _weightResetAt = now + 60_000;
  } else {
    _usedWeight = Math.max(_usedWeight, w);
  }
}

export function getBinanceWeightUtilization(): number {
  if (Date.now() >= _weightResetAt) return 0;
  return _usedWeight / WEIGHT_LIMIT_PER_MIN;
}

/** Sleep until next 1min window if weight > 70%. */
export async function waitForBinanceWeightHeadroom(): Promise<void> {
  if (getBinanceWeightUtilization() < WEIGHT_HEADROOM_RATIO) return;
  const ms = Math.max(0, _weightResetAt - Date.now() + 500);
  if (ms > 0) {
    console.log(
      `[binance-weight] utilization=${(getBinanceWeightUtilization() * 100).toFixed(0)}%, ` +
      `sleeping ${ms}ms for reset`
    );
    await new Promise(r => setTimeout(r, ms));
    // Open a fresh window on wake: zero the weight AND advance the reset marker
    // together, so getBinanceWeightUtilization() reports a real 0 for a valid
    // window rather than 0 because the window looks expired.
    _usedWeight = 0;
    _weightResetAt = Date.now() + 60_000;
  }
}

// ── Preflight + shared axios ─────────────────────────────────────────────────

import axios from 'axios';
import https from 'node:https';
import http from 'node:http';
import { createRequire } from 'node:module';

/**
 * Shared axios instance with HTTP keep-alive. Every client in this repo
 * (smart-money, top-trader, oi, ticker) should import { binanceHttp } from
 * here instead of using bare axios.
 *
 * Why: bare axios.get() creates a new TCP+TLS connection per call. Pulling
 * 500 symbols × 4 endpoints = 2000 fresh handshakes per cycle, which both
 * (a) costs ~50ms per call to TLS, and (b) looks like a scan to Binance's
 * WAF. Reusing one socket pool drops handshake cost to near-zero and
 * presents as a normal browser-style keep-alive client.
 */
// Proxy support: geo-restricted users (doctor itself advises "use a proxy / VPS")
// need requests to honor HTTP(S)_PROXY / NO_PROXY. axios's built-in env-proxy is
// disabled the moment a custom keep-alive agent is set — so tunnel through the
// proxy ourselves via a proxy agent when the env names one for the Binance host.
// Falls back to a plain keep-alive agent (direct) when no proxy is configured.
const _proxyReq = createRequire(import.meta.url);
function makeHttpsAgent(): https.Agent {
  try {
    const { getProxyForUrl } = _proxyReq('proxy-from-env');
    const proxyUrl: string = getProxyForUrl('https://fapi.binance.com');
    if (proxyUrl) {
      const mod = _proxyReq('https-proxy-agent');
      const Ctor = mod.HttpsProxyAgent || mod.default || mod;   // v5 (module=ctor) & v7 ({HttpsProxyAgent})
      return new Ctor(proxyUrl, { keepAlive: true, maxSockets: 8, maxFreeSockets: 4 });
    }
  } catch {
    /* proxy libs missing → fall through to direct keep-alive agent */
  }
  return new https.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 });
}

export const binanceHttp = axios.create({
  proxy: false,   // we handle proxying via the agent above; axios's own https-proxy is unreliable
  httpsAgent: makeHttpsAgent(),
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 }),
});

/**
 * Pre-flight check: ping fapi once before a cron starts.
 * Failure → mark blocked → caller MUST abort, no further requests.
 *
 * Critical for cross-process cron jobs (each Node process has its own
 * `_blockedAt` state; main process getting 418 doesn't trip the cron's breaker
 * unless it pings first).
 */
export async function preflightBinanceFapi(): Promise<boolean> {
  if (isBinanceApiBlocked()) {
    console.warn('[preflight] binance blocked in current process, skip');
    return false;
  }
  // A transient network blip (socket hang up / ECONNRESET / timeout — common on
  // the FIRST request behind a flaky proxy) should NOT skip the whole sweep on a
  // single try. Retry transient errors a couple times; abort immediately only on
  // a real WAF block (sev set) so we never retry-hammer a 418/403.
  const MAX_ATTEMPTS = 3;
  let lastMsg = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await binanceHttp.get('https://fapi.binance.com/fapi/v1/ping', { timeout: 5_000 });
      updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);
      return true;
    } catch (e: any) {
      const { sev, retryAfterSec } = detectBinanceBlockDetails(e);
      if (sev) {
        markBinanceApiBlockedWithRetry(sev, retryAfterSec);
        console.warn(`[preflight] FAILED sev=${sev} retryAfter=${retryAfterSec}s, abort`);
        return false;
      }
      lastMsg = e.message;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  console.warn(`[preflight] FAILED after ${MAX_ATTEMPTS} attempts: ${lastMsg}`);
  return false;
}
