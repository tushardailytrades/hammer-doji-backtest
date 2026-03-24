# Hammer + Doji Pattern Scanner & Backtester

Scan top 10 NSE stocks for **Hammer → Doji** reversal patterns across **4 timeframes**, apply **confirmation filters**, and backtest with **dynamic SL/targets** anchored to the hammer's actual price action.

## Workflow

```
npm run login   →   npm run fetch   →   npm run scan
   (once/day)       (saves to disk)      (offline, full backtest)
```

## Setup

```bash
npm install

# 1. Authenticate with Zerodha
npm run login

# 2. Download 1 year of data (all stocks, all intervals)
npm run fetch

# 3. Scan patterns + run backtest (reads local files, no API calls)
npm run scan
```

## Project Structure

```
├── src/
│   ├── index.js          # Main entry — scanner + backtester orchestration
│   ├── auth.js           # Zerodha Kite authentication
│   ├── fetchAndSave.js   # Download 1yr of candle data from Zerodha
│   ├── config.js         # Instruments, timeframes, trade parameters
│   ├── patterns.js       # Candlestick pattern detection (Doji, Hammer)
│   ├── backtester.js     # Trade simulation & P&L calculation
│   └── report.js         # Console output + CSV/JSON export
├── data/                 # Downloaded candle data (per timeframe)
├── output/               # Backtest results (CSVs + JSON)
├── .env                  # Zerodha API credentials
└── package.json
```

## How It Works

### Pattern Detection
1. Find **Hammer** (lower wick ≥ 50%, upper wick ≤ 25%, body ≤ 40%) followed by a **Doji** (body ≤ 25% of range)
2. Both candles must be **"big"** relative to price (per-timeframe thresholds)
3. Must appear after a **prior downtrend** (5-candle decline, threshold scales by timeframe)

### Confirmation Filters
A pattern alone doesn't trigger a trade. Both must pass:
- **Bullish entry candle**: The candle after the pattern must close green (buyers following through)
- **Volume confirmation**: Hammer volume must be ≥ average of prior 10 candles (conviction, not noise)

### Trade Mechanics
- **Entry**: Open of the candle AFTER the pattern completes
- **Stop Loss**: Below the hammer's low + 5% buffer of hammer range
- **T1 (conservative)**: Entry + 1.5R to 2R (tracked but NOT the exit trigger)
- **T2 (exit trigger)**: Entry + 2R to 3R (trade closes here)
- **T3 (stretch)**: Entry + 3R to 4R (tracked to see if you're leaving money on the table)
- **Max Hold**: 5–6 candles depending on timeframe

### Trade Config Per Timeframe

| TF    | SL Buffer | T1    | T2 (exit) | T3     | Max Hold |
|-------|-----------|-------|-----------|--------|----------|
| 15min | 5%        | 1.5R  | 2.0R      | 3.0R   | 5 candles |
| 30min | 5%        | 1.5R  | 2.0R      | 3.0R   | 6 candles |
| 1hour | 5%        | 2.0R  | 2.5R      | 3.0R   | 5 candles |
| 1day  | 5%        | 2.0R  | 3.0R      | 4.0R   | 5 candles |

### Instruments

Top 10 NSE stocks by market cap: RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK, HINDUNILVR, SBIN, BHARTIARTL, ITC, KOTAKBANK

## Output Files

| File                      | Contents |
|---------------------------|----------|
| `hammer_then_doji.csv`    | All H→D pattern detections |
| `all_trades.csv`          | Every signal — confirmed + skipped, with reason |
| `confirmed_trades.csv`    | Only confirmed trades with full P&L |
| `backtest_results.json`   | Complete data dump |

### Trade CSV Columns

| Column | Description |
|--------|-------------|
| confirmed | YES/NO — did it pass both confirmation filters? |
| confirm_bullish | Entry candle closed green? |
| confirm_volume | Hammer volume above average? |
| entry_price / sl_price | Dynamic levels based on hammer |
| t1/t2/t3_price | R-multiple targets |
| exit_type | TARGET_T2, STOP_LOSS, or MAX_HOLD |
| r_multiple | Actual R achieved (negative = loss) |
| pnl | ₹ profit/loss at ₹1L capital per trade |
| t1_hit / t2_hit / t3_hit | Which targets were touched during the trade |
| max_favorable_pct | Best % the trade saw (MFE) |
| max_adverse_pct | Worst % drawdown during trade (MAE) |

## Tuning

All thresholds are in `src/config.js` and `src/patterns.js`:
- Pattern detection: `DOJI`, `HAMMER`, `MIN_RANGE_PCT`, `DECLINE_BY_INTERVAL`
- Confirmation: `CONFIRMATION.requireBullishEntry`, `CONFIRMATION.minVolumeMultiple`
- Trade params: `TRADE_CONFIG` per timeframe (R-multiples, max hold, SL buffer)
- Capital: `TRADE_CONFIG.capitalPerTrade` (default ₹1,00,000)

Adjust and re-run `npm run scan` — it's instant since it reads cached data.
