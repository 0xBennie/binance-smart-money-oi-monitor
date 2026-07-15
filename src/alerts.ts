// Opt-in smart-money alerts. OFF unless SMART_MONEY_ALERT_TG_TOKEN + _CHAT_ID are
// set — nothing is ever sent without the user's own bot token + chat. Evaluation
// reads the local DB window; a per-symbol fingerprint + cooldown stops a plateaued
// move from re-firing every sweep.
//
// Env (all optional):
//   SMART_MONEY_ALERT_TG_TOKEN   Telegram bot token   (required to send)
//   SMART_MONEY_ALERT_TG_CHAT_ID Telegram chat id     (required to send)
//   SMART_MONEY_ALERT_WINDOW_MIN lookback window      (default 30) — also the cooldown
//   SMART_MONEY_ALERT_QTY_PCT    |qty change%| trigger (default 5)
import { getChange } from './tracking.js';

export interface AlertResult { symbol: string; fired: boolean; text?: string; sent?: boolean; reason?: string }

const DISCLAIMER = '仅数据分析,不构成投资建议。';
const fmtPct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
const fmtQty = (v: number) => Math.round(v).toLocaleString('en-US');
// Bucket a percent move so a plateaued value maps to the SAME fingerprint (and is
// suppressed by the cooldown), but a materially larger move crosses into a new
// bucket and re-alerts. Direction is carried separately, so bucket on |pct|.
const bucketOf = (pct: number, size: number) => Math.trunc(Math.abs(pct) / Math.max(1, size));

interface SideLike { fromQty: number; toQty: number; qtyChange: number; qtyChangePct: number | null; whaleAvg: number }

interface BuiltAlert { text: string; fingerprint: string }

/** Core evaluation: returns the message text AND a content fingerprint (for dedup),
 * or null if nothing tripped. A fingerprint is built ONLY from side + direction +
 * bucketed qty% (NOT from price/P&L), so drifting price can't defeat the cooldown. */
function buildAlert(symbol: string, windowMin: number, qtyPctThreshold: number): BuiltAlert | null {
  const chg = getChange(symbol, windowMin);
  if ('error' in chg) return null;

  const events: string[] = [];   // qty-move lines (the actual signal)
  const context: string[] = [];  // whale 均价 vs 现价 P&L lines (optional context)
  const fp: string[] = [];       // fingerprint tokens

  const evalSide = (side: SideLike, zh: string, tag: 'L' | 'S', isLong: boolean) => {
    const { fromQty, toQty, qtyChange, qtyChangePct } = side;
    let fired = false;
    if (qtyChangePct != null && Math.abs(qtyChangePct) >= qtyPctThreshold) {
      const dir = qtyChangePct > 0 ? '加仓' : '减仓';
      events.push(`${zh}${dir} ${fmtPct(qtyChangePct)}`);
      fp.push(`${tag}:${qtyChangePct > 0 ? 'add' : 'cut'}:${bucketOf(qtyChangePct, qtyPctThreshold)}`);
      fired = true;
    } else if (fromQty === 0 && toQty > 0) {
      // Brand-new position (0 → big) — the strongest signal, but qtyChangePct is null
      // (division by zero) so the pct branch above never sees it. Fire on the absolute
      // move instead. Fingerprint carries no magnitude, so it stays one alert until
      // the position ages out of the window (then it becomes a normal pct move).
      events.push(`${zh}新建仓 ${fmtQty(toQty)} 张`);
      fp.push(`${tag}:new`);
      fired = true;
    }
    // Whale P&L context — only for a side that actually tripped, and only when both
    // a current price and a real whale avg-entry exist. Context, not a trigger.
    if (fired && chg.price != null && side.whaleAvg > 0) {
      const pnl = ((isLong ? chg.price - side.whaleAvg : side.whaleAvg - chg.price) / side.whaleAvg) * 100;
      context.push(`${zh}庄家均价 ${side.whaleAvg} vs 现价 ${chg.price}(${pnl >= 0 ? '浮盈' : '浮亏'} ${Math.abs(Math.round(pnl * 10) / 10)}%)`);
    }
  };

  evalSide(chg.long, '多头', 'L', true);
  evalSide(chg.short, '空头', 'S', false);

  if (!events.length) return null;   // need ≥1 real qty move — context alone never fires
  const text =
    `⚠️ <b>${chg.symbol}</b> 聪明钱异动 · 近 ${chg.spanMinutes}m\n` +
    [...events, ...context].join('\n') +
    `\n\n<i>${DISCLAIMER}</i>`;
  return { text, fingerprint: fp.sort().join('|') };
}

/** Evaluate the alert window for one symbol; returns the message text if a threshold
 * tripped, else null. Pure read (no send, no dedup) — kept for backward compat and
 * for callers that just want the text. `maybeAlert` handles delivery + dedup. */
export function evaluateAlert(symbol: string, windowMin = 30, qtyPctThreshold = 5): string | null {
  return buildAlert(symbol, windowMin, qtyPctThreshold)?.text ?? null;
}

// Per-symbol dedup state: the last fingerprint we SENT and when. A repeat of the
// same fingerprint within the cooldown is suppressed (that's the plateau case).
const lastAlert = new Map<string, { lastFiredTs: number; fingerprint: string }>();

async function sendTelegram(token: string, chatId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (resp.ok) return { ok: true };
    // Surface the HTTP status + a snippet of the body (429/4xx) instead of a silent
    // false, so the caller can log WHY the send failed (bad token, chat not found, …).
    let body = '';
    try { body = (await resp.text()).slice(0, 200); } catch { /* ignore */ }
    return { ok: false, reason: `Telegram HTTP ${resp.status}${body ? ` ${body}` : ''}` };
  } catch (e: any) {
    return { ok: false, reason: `network error: ${e?.message ?? e}` };
  }
}

/** Evaluate + (if configured + tripped + not a duplicate) send a Telegram alert. */
export async function maybeAlert(symbol: string): Promise<AlertResult> {
  const token = process.env.SMART_MONEY_ALERT_TG_TOKEN;
  const chatId = process.env.SMART_MONEY_ALERT_TG_CHAT_ID;
  const windowMin = Number(process.env.SMART_MONEY_ALERT_WINDOW_MIN) > 0 ? Number(process.env.SMART_MONEY_ALERT_WINDOW_MIN) : 30;
  const qtyPct = Number(process.env.SMART_MONEY_ALERT_QTY_PCT) > 0 ? Number(process.env.SMART_MONEY_ALERT_QTY_PCT) : 5;
  const built = buildAlert(symbol, windowMin, qtyPct);
  if (!built) return { symbol, fired: false };
  if (!token || !chatId) return { symbol, fired: true, sent: false, reason: 'alerts off (set SMART_MONEY_ALERT_TG_TOKEN + _CHAT_ID)', text: built.text };

  // Dedup: same fingerprint already sent within the cooldown (≥ window) → suppress.
  const cooldownMs = windowMin * 60_000;
  const now = Date.now();
  const prev = lastAlert.get(symbol);
  if (prev && prev.fingerprint === built.fingerprint && now - prev.lastFiredTs < cooldownMs) {
    return { symbol, fired: false };   // still the same move — don't re-fire every sweep
  }

  const res = await sendTelegram(token, chatId, built.text);
  if (res.ok) {
    lastAlert.set(symbol, { lastFiredTs: now, fingerprint: built.fingerprint });
    return { symbol, fired: true, sent: true, text: built.text };
  }
  // A failed send is NOT recorded, so the next sweep retries.
  return { symbol, fired: true, sent: false, reason: res.reason, text: built.text };
}

/** Test/ops hook: clear the dedup memory (so a fresh fingerprint fires immediately). */
export function _resetAlertDedup(): void {
  lastAlert.clear();
}
