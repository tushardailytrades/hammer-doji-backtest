/**
 * config.js — Instruments, intervals, and trade parameters
 */

require("dotenv").config();

// Top 10 NSE stocks by market cap
const NSE_TOP_10 = [
  { symbol: "RELIANCE",   exchange: "NSE", token: 738561  },
  { symbol: "TCS",        exchange: "NSE", token: 2953217 },
  { symbol: "HDFCBANK",   exchange: "NSE", token: 341249  },
  { symbol: "INFY",       exchange: "NSE", token: 408065  },
  { symbol: "ICICIBANK",  exchange: "NSE", token: 1270529 },
  { symbol: "HINDUNILVR", exchange: "NSE", token: 356865  },
  { symbol: "SBIN",       exchange: "NSE", token: 779521  },
  { symbol: "BHARTIARTL", exchange: "NSE", token: 2714625 },
  { symbol: "ITC",        exchange: "NSE", token: 424961  },
  { symbol: "KOTAKBANK",  exchange: "NSE", token: 492033  },
];

const INTERVALS = [
  { label: "15min",  kiteInterval: "15minute", chunkDays: 60,  lookbackDays: 365 },
  { label: "30min",  kiteInterval: "30minute", chunkDays: 60,  lookbackDays: 365 },
  { label: "1hour",  kiteInterval: "60minute", chunkDays: 90,  lookbackDays: 365 },
  { label: "1day",   kiteInterval: "day",      chunkDays: 100, lookbackDays: 365 },
];

/**
 * Trade parameters per timeframe.
 *
 * SL is always anchored to hammer low — slBuffer is extra % of hammer
 * range added below the low as cushion.
 *
 * Targets are R-multiples: target1 = entry + (risk × t1R), etc.
 * maxHoldCandles = how many candles to hold before force-exiting.
 */
const TRADE_CONFIG = {
  capitalPerTrade: 100000,  // ₹ per trade

  "15min": { slBuffer: 0.05, t1R: 1.5, t2R: 2.0, t3R: 3.0, maxHoldCandles: 5  },
  "30min": { slBuffer: 0.05, t1R: 1.5, t2R: 2.0, t3R: 3.0, maxHoldCandles: 6  },
  "1hour": { slBuffer: 0.05, t1R: 2.0, t2R: 2.5, t3R: 3.0, maxHoldCandles: 5  },
  "1day":  { slBuffer: 0.05, t1R: 2.0, t2R: 3.0, t3R: 4.0, maxHoldCandles: 5  },
};

/**
 * Confirmation filters — what must be true AFTER the pattern
 * for us to actually take the trade.
 */
const CONFIRMATION = {
  // Next candle (entry candle) must close above its open (bullish)
  requireBullishEntry: true,

  // Hammer volume must be >= this multiple of avg volume of prior N candles
  // e.g. 1.0 = at least average volume, 1.2 = 20% above average
  minVolumeMultiple: 1.0,
  volumeLookback: 10,  // candles to average for volume comparison
};

const KITE = {
  apiKey:      process.env.ZERODHA_API_KEY,
  apiSecret:   process.env.ZERODHA_API_SECRET,
  accessToken: process.env.ZERODHA_ACCESS_TOKEN,
};

const DATA_DIR = require("path").join(__dirname, "..", "data");

module.exports = { NSE_TOP_10, INTERVALS, KITE, DATA_DIR, TRADE_CONFIG, CONFIRMATION };
