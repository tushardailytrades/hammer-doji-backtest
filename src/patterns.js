/**
 * patterns.js — Candlestick Pattern Detection
 *
 * Detects:
 *   1. Doji        → body is tiny relative to total range
 *   2. Hammer      → long lower wick, small body near top, short upper wick
 *   3. Doji→Hammer → Doji on candle N, Hammer on candle N+1
 *   4. Hammer→Doji → Hammer on candle N, Doji on candle N+1
 *
 * Filters:
 *   - Prior downtrend (threshold scales by timeframe)
 *   - Minimum candle size — BOTH candles must be "big" relative to price
 *     (tiny range candles = noise, not conviction)
 */

// ══════════════════════════════════════════════════════════════
//  THRESHOLDS — All tunable. Adjust and re-run `npm run scan`.
// ══════════════════════════════════════════════════════════════

const DOJI = {
  maxBodyPct: 0.25,   // body ≤ 25% of candle range
};

const HAMMER = {
  maxBodyPct:       0.40,  // body ≤ 40% of range
  minLowerWickPct:  0.50,  // lower wick ≥ 50% of range
  maxUpperWickPct:  0.25,  // upper wick ≤ 25% of range
};

const TREND_LOOKBACK = 5;

/**
 * Downtrend: minimum % decline over the last TREND_LOOKBACK candles.
 * Scales by timeframe because intraday moves are naturally smaller.
 */
const DECLINE_BY_INTERVAL = {
  "15min": 0.15,   // 0.15% over 75 minutes
  "30min": 0.25,   // 0.25% over 2.5 hours
  "1hour": 0.50,   // 0.50% over 5 hours
  "1day":  1.00,   // 1.00% over 5 days
};

/**
 * BIG CANDLE FILTER — the key addition.
 *
 * Both candles in the pair must have a range (high-low) that is
 * at least this % of the candle's price. This filters out tiny
 * noise candles that look like patterns on paper but carry zero
 * conviction in the real market.
 *
 * The hammer candle needs a bigger range than the doji since the
 * hammer is the "action" candle showing buyer strength.
 */
const MIN_RANGE_PCT = {
  //             doji    hammer
  "15min": { doji: 0.15, hammer: 0.25 },
  "30min": { doji: 0.20, hammer: 0.35 },
  "1hour": { doji: 0.25, hammer: 0.40 },
  "1day":  { doji: 0.50, hammer: 0.80 },
};
const DEFAULT_MIN_RANGE = { doji: 0.20, hammer: 0.30 };

// ══════════════════════════════════════════════════════════════
//  CANDLE DETECTION
// ══════════════════════════════════════════════════════════════

function metrics(c) {
  const body      = Math.abs(c.close - c.open);
  const range     = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const isBullish = c.close >= c.open;
  const rangePct  = c.low > 0 ? (range / c.low) * 100 : 0;
  return { body, range, upperWick, lowerWick, isBullish, rangePct };
}

function isDoji(c) {
  const m = metrics(c);
  if (m.range <= 0) return false;
  return (m.body / m.range) <= DOJI.maxBodyPct;
}

function isHammer(c) {
  const m = metrics(c);
  if (m.range <= 0) return false;
  return (
    (m.body / m.range)      <= HAMMER.maxBodyPct &&
    (m.lowerWick / m.range) >= HAMMER.minLowerWickPct &&
    (m.upperWick / m.range) <= HAMMER.maxUpperWickPct
  );
}

/**
 * Check if BOTH candles are "big enough" for the given timeframe.
 * The doji and hammer have separate thresholds since the hammer
 * should show more range (stronger rejection wick).
 */
function areBigCandles(dojiCandle, hammerCandle, interval) {
  const dm = metrics(dojiCandle);
  const hm = metrics(hammerCandle);
  const thresholds = MIN_RANGE_PCT[interval] || DEFAULT_MIN_RANGE;
  return dm.rangePct >= thresholds.doji && hm.rangePct >= thresholds.hammer;
}

function hasPriorDowntrend(candles, idx, interval) {
  if (idx < TREND_LOOKBACK) return false;
  const prev = candles[idx - TREND_LOOKBACK].close;
  const curr = candles[idx].close;
  const declinePct = ((prev - curr) / prev) * 100;
  const threshold  = DECLINE_BY_INTERVAL[interval] || 0.5;
  return declinePct >= threshold;
}

// ══════════════════════════════════════════════════════════════
//  SCANNER
// ══════════════════════════════════════════════════════════════

function scanPatterns(candles, symbol, interval) {
  const dojiThenHammer = [];
  const hammerThenDoji = [];

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    // Pattern 1: Doji (prev) → Hammer (curr)
    if (
      isDoji(prev) &&
      isHammer(curr) &&
      areBigCandles(prev, curr, interval) &&
      hasPriorDowntrend(candles, i - 1, interval)
    ) {
      dojiThenHammer.push(buildRow(symbol, interval, "doji_then_hammer", prev, curr, candles, i));
    }

    // Pattern 2: Hammer (prev) → Doji (curr)
    if (
      isHammer(prev) &&
      isDoji(curr) &&
      areBigCandles(curr, prev, interval) &&
      hasPriorDowntrend(candles, i - 1, interval)
    ) {
      hammerThenDoji.push(buildRow(symbol, interval, "hammer_then_doji", prev, curr, candles, i));
    }
  }

  return { dojiThenHammer, hammerThenDoji };
}

// ══════════════════════════════════════════════════════════════
//  CSV ROW BUILDER
// ══════════════════════════════════════════════════════════════

function buildRow(symbol, interval, pattern, candle1, candle2, candles, idx) {
  const m1 = metrics(candle1);
  const m2 = metrics(candle2);

  const lookbackClose = idx >= TREND_LOOKBACK ? candles[idx - TREND_LOOKBACK].close : null;
  const declinePct    = lookbackClose
    ? (((lookbackClose - candle2.close) / lookbackClose) * 100).toFixed(2)
    : "";

  // Identify which candle is the hammer (needed for SL calculation)
  const hammerCandle = pattern === "doji_then_hammer" ? candle2 : candle1;
  const hammerMetrics = metrics(hammerCandle);

  return {
    symbol,
    interval,
    pattern,
    signalIndex: idx,  // index of the SECOND candle in the pair

    candle1_date:   candle1.date,
    candle1_open:   candle1.open,
    candle1_high:   candle1.high,
    candle1_low:    candle1.low,
    candle1_close:  candle1.close,
    candle1_volume: candle1.volume,
    candle1_type:   pattern === "doji_then_hammer" ? "DOJI" : "HAMMER",
    candle1_range_pct:     m1.rangePct.toFixed(2),
    candle1_body_pct:      m1.range > 0 ? ((m1.body / m1.range) * 100).toFixed(2) : "0",
    candle1_lower_wick_pct: m1.range > 0 ? ((m1.lowerWick / m1.range) * 100).toFixed(2) : "0",
    candle1_upper_wick_pct: m1.range > 0 ? ((m1.upperWick / m1.range) * 100).toFixed(2) : "0",

    candle2_date:   candle2.date,
    candle2_open:   candle2.open,
    candle2_high:   candle2.high,
    candle2_low:    candle2.low,
    candle2_close:  candle2.close,
    candle2_volume: candle2.volume,
    candle2_type:   pattern === "doji_then_hammer" ? "HAMMER" : "DOJI",
    candle2_range_pct:     m2.rangePct.toFixed(2),
    candle2_body_pct:      m2.range > 0 ? ((m2.body / m2.range) * 100).toFixed(2) : "0",
    candle2_lower_wick_pct: m2.range > 0 ? ((m2.lowerWick / m2.range) * 100).toFixed(2) : "0",
    candle2_upper_wick_pct: m2.range > 0 ? ((m2.upperWick / m2.range) * 100).toFixed(2) : "0",

    prior_decline_pct: declinePct,

    // Pre-computed for backtester
    hammer_low:   hammerCandle.low,
    hammer_high:  hammerCandle.high,
    hammer_range: hammerMetrics.range,
  };
}

module.exports = { scanPatterns, isDoji, isHammer, areBigCandles, metrics };
