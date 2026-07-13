// Opt-in smart-money alerts. OFF unless SMART_MONEY_ALERT_TG_TOKEN + _CHAT_ID are
// set — nothing is ever sent without the user's own bot token + chat. Evaluation
// is stateless (reads the local DB window), so it's safe to call every sweep.
//
// Env (all optional):
//   SMART_MONEY_ALERT_TG_TOKEN   Telegram bot token   (required to send)
//   SMART_MONEY_ALERT_TG_CHAT_ID Telegram chat id     (required to send)
//   SMART_MONEY_ALERT_WINDOW_MIN lookback window      (default 30)
//   SMART_MONEY_ALERT_QTY_PCT    |qty change%| trigger (default 5)
import { getChange } from './tracking.js';

export interface AlertResult { symbol: string; fired: boolean; text?: string; sent?: boolean; reason?: string }

const DISCLAIMER = '仅数据分析,不构成投资建议。';
const fmtPct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

/** Evaluate the alert window for one symbol; returns the message text if a threshold
 * tripped, else null. Pure read (no send) — `maybeAlert` handles delivery. */
export function evaluateAlert(symbol: string, windowMin = 30, qtyPctThreshold = 5): string | null {
  const chg = getChange(symbol, windowMin);
  if ('error' in chg) return null;
  const triggers: string[] = [];
  const lp = chg.long.qtyChangePct, sp = chg.short.qtyChangePct;
  if (lp != null && Math.abs(lp) >= qtyPctThreshold) triggers.push(`多头${lp > 0 ? '加仓' : '减仓'} ${fmtPct(lp)}`);
  if (sp != null && Math.abs(sp) >= qtyPctThreshold) triggers.push(`空头${sp > 0 ? '加仓' : '减仓'} ${fmtPct(sp)}`);
  // Whale P&L context: current price vs long-whale avg entry.
  if (chg.price != null && chg.long.whaleAvg > 0) {
    const pnl = ((chg.price - chg.long.whaleAvg) / chg.long.whaleAvg) * 100;
    triggers.push(`多头庄家均价 ${chg.long.whaleAvg} vs 现价 ${chg.price}(${pnl >= 0 ? '浮盈' : '浮亏'} ${Math.abs(Math.round(pnl * 10) / 10)}%)`);
  }
  if (triggers.length < 2) return null;   // need a real qty move (trigger[0/1]) + context, not context alone
  return `⚠️ <b>${chg.symbol}</b> 聪明钱异动 · 近 ${chg.spanMinutes}m\n` + triggers.join('\n') + `\n\n<i>${DISCLAIMER}</i>`;
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Evaluate + (if configured + tripped) send a Telegram alert for one symbol. */
export async function maybeAlert(symbol: string): Promise<AlertResult> {
  const token = process.env.SMART_MONEY_ALERT_TG_TOKEN;
  const chatId = process.env.SMART_MONEY_ALERT_TG_CHAT_ID;
  const windowMin = Number(process.env.SMART_MONEY_ALERT_WINDOW_MIN) > 0 ? Number(process.env.SMART_MONEY_ALERT_WINDOW_MIN) : 30;
  const qtyPct = Number(process.env.SMART_MONEY_ALERT_QTY_PCT) > 0 ? Number(process.env.SMART_MONEY_ALERT_QTY_PCT) : 5;
  const text = evaluateAlert(symbol, windowMin, qtyPct);
  if (!text) return { symbol, fired: false };
  if (!token || !chatId) return { symbol, fired: true, sent: false, reason: 'alerts off (set SMART_MONEY_ALERT_TG_TOKEN + _CHAT_ID)', text };
  const sent = await sendTelegram(token, chatId, text);
  return { symbol, fired: true, sent, text };
}
