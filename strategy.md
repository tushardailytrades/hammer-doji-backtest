# Doji + Hammer Reversal Pattern Trading Strategy

## Overview

A **two-candle reversal pattern** trading system for NSE top 10 stocks. The strategy detects Doji-Hammer (or Hammer-Doji) sequences after a prior downtrend, then enters long trades with dynamic stop losses and R-multiple targets.

---

## Instruments

Top 10 NSE stocks by market cap:

| # | Symbol |
|---|--------|
| 1 | RELIANCE |
| 2 | TCS |
| 3 | HDFCBANK |
| 4 | INFY |
| 5 | ICICIBANK |
| 6 | HINDUNILVR |
| 7 | SBIN |
| 8 | BHARTIARTL |
| 9 | ITC |
| 10 | KOTAKBANK |

---

## Timeframes

| Timeframe | Kite API Code | Data Lookback |
|-----------|---------------|---------------|
| 15-minute | `15minute` | 365 days |
| 30-minute | `30minute` | 365 days |
| 1-hour | `60minute` | 365 days |
| Daily | `day` | 365 days |

---

## Candle Pattern Definitions

### Doji

| Parameter | Value |
|-----------|-------|
| Max Body % of Range | 25% |

A candle where the body is very small relative to its total range — represents indecision.

### Hammer

| Parameter | Value |
|-----------|-------|
| Max Body % of Range | 40% |
| Min Lower Wick % of Range | 50% |
| Max Upper Wick % of Range | 25% |

A candle with a small body near the top and a long lower wick — represents buyer rejection of lower prices.

### Minimum Range Size (% of Price)

Both candles must show material price movement to filter out noise:

| Timeframe | Doji Min Range | Hammer Min Range |
|-----------|---------------|-----------------|
| 15min | 0.15% | 0.25% |
| 30min | 0.20% | 0.35% |
| 1hour | 0.25% | 0.40% |
| 1day | 0.50% | 0.80% |

---

## Entry Conditions

### Step 1: Pattern Detection

Two valid patterns (either order):

- **Doji → Hammer (D→H)**: Candle 1 is a Doji, Candle 2 is a Hammer
- **Hammer → Doji (H→D)**: Candle 1 is a Hammer, Candle 2 is a Doji

### Step 2: Prior Downtrend Required

A minimum decline must exist over the last **5 candles** before the pattern:

| Timeframe | Min Decline |
|-----------|-------------|
| 15min | 0.15% |
| 30min | 0.25% |
| 1hour | 0.50% |
| 1day | 1.00% |

### Step 3: Confirmation Filters (Both Must Pass)

1. **Bullish Entry Candle**: The candle AFTER the pattern must close green (`close > open`) — shows buyer follow-through
2. **Volume Confirmation**: Hammer candle volume must be ≥ **1.0x** the average volume of the prior **10 candles**

### Step 4: Entry Price

- **Entry** = Open of the candle after the pattern (the confirmation candle)
- Trade is skipped if entry price is below the stop loss

---

## Stop Loss (SL)

Dynamic, based on the hammer candle:

```
SL = Hammer Low - (Hammer Range × SL Buffer)
```

| Timeframe | SL Buffer |
|-----------|-----------|
| 15min | 5% |
| 30min | 5% |
| 1hour | 5% |
| 1day | 5% |

**Rationale**: If price breaks below the hammer's low, the reversal thesis is invalidated. The 5% buffer accounts for wick noise.

**SL is checked FIRST each candle** (assumes worst-case execution).

---

## Targets (R-Multiple Based)

Risk per share = `Entry - SL`

All targets: `Target = Entry + (Risk × R-multiple)`

| Timeframe | T1 (Conservative) | T2 (Primary Exit) | T3 (Stretch) |
|-----------|-------------------|-------------------|--------------|
| 15min | 1.5R | 2.0R | 3.0R |
| 30min | 1.5R | 2.0R | 3.0R |
| 1hour | 2.0R | 2.5R | 3.0R |
| 1day | 2.0R | 3.0R | 4.0R |

### Target Behavior

- **T1**: Tracked but NOT an exit trigger (reference for partial booking)
- **T2**: **PRIMARY exit trigger** — trade closes at T2
- **T3**: Tracked to measure "money left on table"

---

## Exit Conditions

Three exit triggers — whichever hits first:

| Priority | Condition | Exit Price | Exit Type |
|----------|-----------|------------|-----------|
| 1 | SL hit (low ≤ SL) | SL price | `STOP_LOSS` |
| 2 | T2 hit (high ≥ T2) | T2 price | `TARGET_T2` |
| 3 | Max hold candles reached | Close price | `MAX_HOLD` |

### Max Hold Duration

| Timeframe | Max Candles | Approx Duration |
|-----------|-------------|-----------------|
| 15min | 5 | 75 minutes |
| 30min | 6 | 3 hours |
| 1hour | 5 | 5 hours |
| 1day | 5 | 5 trading days |

---

## Position Sizing

| Parameter | Value |
|-----------|-------|
| Capital per trade | ₹1,00,000 |
| Quantity | `floor(₹1,00,000 / Entry Price)` |

---

## Risk Management Summary

| Metric | Value |
|--------|-------|
| Risk per trade | Entry - SL (dynamic) |
| Risk % | (Entry - SL) / Entry × 100 |
| Min Reward:Risk | 1.5R (T1) |
| Target Exit R:R | 2.0R - 3.0R (T2, varies by TF) |
| Stretch R:R | 3.0R - 4.0R (T3) |
| Max holding period | 5-6 candles |

---

## Configuration Reference

### Pattern Thresholds (`src/patterns.js`)

```
DOJI.maxBodyPct        = 0.25    // body ≤ 25% of range
HAMMER.maxBodyPct      = 0.40    // body ≤ 40% of range
HAMMER.minLowerWickPct = 0.50    // lower wick ≥ 50%
HAMMER.maxUpperWickPct = 0.25    // upper wick ≤ 25%
TREND_LOOKBACK         = 5       // candles for downtrend check
```

### Trade Config (`src/config.js`)

```
capitalPerTrade: 100000

15min: { slBuffer: 0.05, t1R: 1.5, t2R: 2.0, t3R: 3.0, maxHoldCandles: 5 }
30min: { slBuffer: 0.05, t1R: 1.5, t2R: 2.0, t3R: 3.0, maxHoldCandles: 6 }
1hour: { slBuffer: 0.05, t1R: 2.0, t2R: 2.5, t3R: 3.0, maxHoldCandles: 5 }
1day:  { slBuffer: 0.05, t1R: 2.0, t3R: 3.0, t3R: 4.0, maxHoldCandles: 5 }
```

### Confirmation Config (`src/config.js`)

```
requireBullishEntry: true
minVolumeMultiple:   1.0
volumeLookback:      10
```

---

## Output Files

| File | Description |
|------|-------------|
| `doji_then_hammer.csv` | All D→H patterns detected |
| `hammer_then_doji.csv` | All H→D patterns detected |
| `all_trades.csv` | Every signal with confirmation status + P&L |
| `confirmed_trades.csv` | Only traded signals (passed both filters) |
| `backtest_results.json` | Complete data dump with config + stats |

---

## Workflow

```
npm run login   →  Zerodha auth (once per day)
npm run fetch   →  Download 1yr of data for 10 stocks across all timeframes
npm run scan    →  Detect patterns + backtest (fully offline, instant re-runs)
```
