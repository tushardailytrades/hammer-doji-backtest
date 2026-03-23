/**
 * backtester.js — Trade Simulation with Confirmation Filters
 *
 * For each detected pattern signal:
 *
 *   CONFIRMATION (must pass ALL):
 *     1. Entry candle (next candle after pair) closes bullish (green)
 *     2. Hammer volume ≥ average volume of prior N candles
 *
 *   TRADE MECHANICS:
 *     - Entry:  open of the candle AFTER the pattern completes
 *     - SL:     hammer low - (buffer % × hammer range)
 *     - T1/T2/T3: entry + (risk × R-multiple) — tracks all 3 independently
 *     - Exit:   first of SL hit / T2 hit / max hold candles
 *     - Partial booking: logs whether T1 was hit even if trade continues
 *
 *   Tracks per-trade:
 *     - confirmation status, entry, SL, targets, exit type, P&L
 *     - which targets were hit during the trade's lifetime
 */

const { TRADE_CONFIG, CONFIRMATION, toIST } = require("./config");

const r2 = (n) => Math.round(n * 100) / 100;

// ══════════════════════════════════════════════════════════════
//  CONFIRMATION CHECKS
// ══════════════════════════════════════════════════════════════

/**
 * Check if the entry candle (candle after the pattern) is bullish.
 */
function isBullishEntry(entryCandle) {
  return entryCandle.close > entryCandle.open;
}

/**
 * Check if the hammer candle's volume is above average.
 * The hammer is candle1 for H→D patterns, candle2 for D→H patterns.
 */
function isVolumeConfirmed(candles, hammerIdx) {
  const lookback = CONFIRMATION.volumeLookback;
  if (hammerIdx < lookback) return true; // not enough data, pass by default

  let sum = 0;
  for (let i = hammerIdx - lookback; i < hammerIdx; i++) {
    sum += candles[i].volume;
  }
  const avgVol = sum / lookback;
  const hammerVol = candles[hammerIdx].volume;

  return hammerVol >= avgVol * CONFIRMATION.minVolumeMultiple;
}

// ══════════════════════════════════════════════════════════════
//  TRADE SIMULATION
// ══════════════════════════════════════════════════════════════

/**
 * Simulate a single trade from a pattern signal.
 *
 * @param {Object} signal   - Pattern row from scanner (has signalIndex, hammer_low, etc.)
 * @param {Array}  candles  - Full candle array for this stock+interval
 * @param {string} interval - "15min", "30min", "1hour", "1day"
 * @returns {Object|null}   - Trade result or null if skipped
 */
function simulateTrade(signal, candles, interval) {
  const cfg = TRADE_CONFIG[interval];
  if (!cfg) return null;

  const entryIdx = signal.signalIndex + 1; // candle after the pair
  if (entryIdx >= candles.length) return null;

  const entryCandle = candles[entryIdx];

  // ── Confirmation Checks ──

  // Find hammer candle index
  const hammerIdx = signal.pattern === "doji_then_hammer"
    ? signal.signalIndex      // candle2 = hammer
    : signal.signalIndex - 1; // candle1 = hammer

  const confirmBullish = !CONFIRMATION.requireBullishEntry || isBullishEntry(entryCandle);
  const confirmVolume  = isVolumeConfirmed(candles, hammerIdx);
  const confirmed      = confirmBullish && confirmVolume;

  // ── Compute Levels ──

  const entry     = entryCandle.open;
  const slBuffer  = signal.hammer_range * cfg.slBuffer;
  const sl        = signal.hammer_low - slBuffer;
  const risk      = entry - sl;

  // If entry is below SL (weird edge case), skip
  if (risk <= 0) return null;

  const t1 = entry + risk * cfg.t1R;
  const t2 = entry + risk * cfg.t2R;
  const t3 = entry + risk * cfg.t3R;

  const qty = Math.floor(TRADE_CONFIG.capitalPerTrade / entry);
  if (qty <= 0) return null;

  // ── Simulate Candle by Candle ──

  let exitPrice  = null;
  let exitDate   = null;
  let exitType   = null;
  let holdCandles = 0;
  let t1Hit = false, t2Hit = false, t3Hit = false;
  let t1HitDate = "", t2HitDate = "", t3HitDate = "";
  let maxFavorable  = 0; // max profit seen during trade (for MAE/MFE)
  let maxAdverse    = 0; // max drawdown seen during trade

  for (let d = 0; d < cfg.maxHoldCandles; d++) {
    const idx = entryIdx + d;
    if (idx >= candles.length) break;

    const c = candles[idx];
    holdCandles = d + 1;

    // Track MAE/MFE
    const candleMaxProfit = (c.high - entry) / entry * 100;
    const candleMaxLoss   = (entry - c.low) / entry * 100;
    if (candleMaxProfit > maxFavorable) maxFavorable = candleMaxProfit;
    if (candleMaxLoss > maxAdverse)     maxAdverse = candleMaxLoss;

    // Check T1 hit (track even if we don't exit)
    if (!t1Hit && c.high >= t1) {
      t1Hit = true;
      t1HitDate = c.date;
    }

    // Check T3 hit (track)
    if (!t3Hit && c.high >= t3) {
      t3Hit = true;
      t3HitDate = c.date;
    }

    // ── Exit Logic (SL and T2 are actual exit triggers) ──

    // Intraday: check SL first (assume worst case — SL hit before target)
    if (c.low <= sl) {
      exitPrice = sl;
      exitDate  = c.date;
      exitType  = "STOP_LOSS";
      break;
    }

    // T2 hit = take profit and exit
    if (c.high >= t2) {
      t2Hit = true;
      t2HitDate = c.date;
      exitPrice = t2;
      exitDate  = c.date;
      exitType  = "TARGET_T2";
      break;
    }

    // Max hold → exit at close
    if (d === cfg.maxHoldCandles - 1) {
      exitPrice = c.close;
      exitDate  = c.date;
      exitType  = "MAX_HOLD";
      break;
    }
  }

  // Edge case: ran out of candles
  if (!exitPrice) {
    const lastIdx = Math.min(entryIdx + cfg.maxHoldCandles - 1, candles.length - 1);
    exitPrice = candles[lastIdx].close;
    exitDate  = candles[lastIdx].date;
    exitType  = "END_OF_DATA";
  }

  const pnl    = (exitPrice - entry) * qty;
  const pnlPct = ((exitPrice - entry) / entry) * 100;
  const rMultiple = risk > 0 ? (exitPrice - entry) / risk : 0;

  return {
    symbol:        signal.symbol,
    interval:      signal.interval,
    pattern:       signal.pattern,
    signal_date:   signal.candle2_date,

    // Confirmation
    confirmed:       confirmed ? "YES" : "NO",
    confirm_bullish: confirmBullish ? "YES" : "NO",
    confirm_volume:  confirmVolume ? "YES" : "NO",
    hammer_volume:   candles[hammerIdx] ? candles[hammerIdx].volume : 0,

    // Trade levels
    entry_date:  toIST(entryCandle.date),
    entry_price: r2(entry),
    sl_price:    r2(sl),
    t1_price:    r2(t1),
    t2_price:    r2(t2),
    t3_price:    r2(t3),
    risk_per_share: r2(risk),
    risk_pct:    r2((risk / entry) * 100),

    // Exit
    exit_date:    toIST(exitDate),
    exit_price:   r2(exitPrice),
    exit_type:    exitType,
    hold_candles: holdCandles,

    // P&L
    qty,
    pnl:        r2(pnl),
    pnl_pct:    r2(pnlPct),
    r_multiple: r2(rMultiple),

    // Target tracking
    t1_hit:      t1Hit ? "YES" : "NO",
    t1_hit_date: toIST(t1HitDate),
    t2_hit:      t2Hit ? "YES" : "NO",
    t2_hit_date: toIST(t2HitDate),
    t3_hit:      t3Hit ? "YES" : "NO",
    t3_hit_date: toIST(t3HitDate),

    // MAE / MFE (max adverse/favorable excursion)
    max_favorable_pct: r2(maxFavorable),
    max_adverse_pct:   r2(maxAdverse),
  };
}

// ══════════════════════════════════════════════════════════════
//  BATCH RUNNER
// ══════════════════════════════════════════════════════════════

/**
 * Run backtest for all signals of one stock+interval.
 * Returns all trades (confirmed + unconfirmed, tagged separately).
 */
function backtestSignals(signals, candles, interval) {
  const trades = [];

  for (const signal of signals) {
    const trade = simulateTrade(signal, candles, interval);
    if (trade) trades.push(trade);
  }

  return trades;
}

// ══════════════════════════════════════════════════════════════
//  SUMMARY STATS
// ══════════════════════════════════════════════════════════════

function buildSummary(trades) {
  if (trades.length === 0) return emptySummary();

  // Only count confirmed trades for P&L stats
  const confirmed = trades.filter((t) => t.confirmed === "YES");
  const all       = trades;

  const wins   = confirmed.filter((t) => t.pnl > 0);
  const losses = confirmed.filter((t) => t.pnl <= 0);

  const totalPnl   = confirmed.reduce((s, t) => s + t.pnl, 0);
  const winRate     = confirmed.length > 0 ? (wins.length / confirmed.length) * 100 : 0;
  const avgR        = confirmed.length > 0 ? confirmed.reduce((s, t) => s + t.r_multiple, 0) / confirmed.length : 0;
  const maxWin      = wins.length   > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0;
  const maxLoss     = losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // Target hit rates (on confirmed trades)
  const t1Hits = confirmed.filter((t) => t.t1_hit === "YES").length;
  const t2Hits = confirmed.filter((t) => t.t2_hit === "YES").length;
  const t3Hits = confirmed.filter((t) => t.t3_hit === "YES").length;

  // Exit type breakdown
  const exits = {};
  for (const t of confirmed) {
    exits[t.exit_type] = (exits[t.exit_type] || 0) + 1;
  }

  return {
    totalSignals:    all.length,
    confirmed:       confirmed.length,
    skipped:         all.length - confirmed.length,
    wins:            wins.length,
    losses:          losses.length,
    winRate:         r2(winRate),
    totalPnl:        r2(totalPnl),
    avgR:            r2(avgR),
    maxWin:          r2(maxWin),
    maxLoss:         r2(maxLoss),
    profitFactor:    r2(profitFactor),
    t1HitRate:       confirmed.length > 0 ? r2((t1Hits / confirmed.length) * 100) : 0,
    t2HitRate:       confirmed.length > 0 ? r2((t2Hits / confirmed.length) * 100) : 0,
    t3HitRate:       confirmed.length > 0 ? r2((t3Hits / confirmed.length) * 100) : 0,
    exits,
  };
}

function emptySummary() {
  return {
    totalSignals: 0, confirmed: 0, skipped: 0,
    wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgR: 0,
    maxWin: 0, maxLoss: 0, profitFactor: 0,
    t1HitRate: 0, t2HitRate: 0, t3HitRate: 0, exits: {},
  };
}

module.exports = { simulateTrade, backtestSignals, buildSummary, isBullishEntry, isVolumeConfirmed };
