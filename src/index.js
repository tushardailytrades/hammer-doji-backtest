/**
 * index.js — Scan + Backtest + Report (fully offline)
 *
 * Reads locally cached candle data from ./data/, detects patterns,
 * applies confirmation filters, simulates trades, and outputs:
 *
 *   output/doji_then_hammer.csv    — pattern detections
 *   output/hammer_then_doji.csv    — pattern detections
 *   output/all_trades.csv          — every signal (confirmed + skipped)
 *   output/confirmed_trades.csv    — only confirmed trades with full P&L
 *   output/backtest_results.json   — complete data dump
 *
 * No Kite API calls. Run `npm run fetch` first to download data.
 */

const fs     = require("fs");
const path   = require("path");
const chalk  = require("chalk");
const { NSE_TOP_10, INTERVALS, DATA_DIR } = require("./config");
const { scanPatterns }                     = require("./patterns");
const { backtestSignals, buildSummary }    = require("./backtester");
const report                               = require("./report");

const OUTPUT_DIR = path.join(__dirname, "..", "output");

// ── Main ─────────────────────────────────────────────────────

function main() {
  console.clear();
  report.printHeader();

  if (!fs.existsSync(DATA_DIR)) {
    console.error(chalk.red("  ❌ No data found. Run: npm run fetch\n"));
    process.exit(1);
  }

  const allPatterns = [];
  const allTrades   = [];
  const summaryByInterval = {};

  for (const interval of INTERVALS) {
    const dir = path.join(DATA_DIR, interval.label);
    if (!fs.existsSync(dir)) {
      console.log(chalk.yellow(`  ⚠️  No data for ${interval.label} — skipping`));
      continue;
    }

    console.log(chalk.bold(`\n  ⏱️  ${interval.label.toUpperCase()}`));
    console.log("  " + "─".repeat(60));

    let intervalTrades = [];

    for (const stock of NSE_TOP_10) {
      const filePath = path.join(dir, `${stock.symbol}.json`);
      if (!fs.existsSync(filePath)) {
        console.log(chalk.gray(`    ${stock.symbol.padEnd(12)} — no data file`));
        continue;
      }

      const candles = JSON.parse(fs.readFileSync(filePath, "utf8"));

      // ── Step 1: Detect Patterns ──
      const { dojiThenHammer, hammerThenDoji } = scanPatterns(candles, stock.symbol, interval.label);
      const signals = [...dojiThenHammer, ...hammerThenDoji];
      allPatterns.push(...signals);

      // ── Step 2: Backtest Each Signal ──
      const trades = backtestSignals(signals, candles, interval.label);
      intervalTrades.push(...trades);
      allTrades.push(...trades);

      // Log per stock
      const confirmed = trades.filter((t) => t.confirmed === "YES");
      const wins      = confirmed.filter((t) => t.pnl > 0);
      const pnl       = confirmed.reduce((s, t) => s + t.pnl, 0);

      if (signals.length > 0) {
        console.log(
          `    ${stock.symbol.padEnd(12)} ` +
          `${String(candles.length).padStart(6)} candles → ` +
          `${chalk.cyan(signals.length + " signals")} → ` +
          `${chalk.green(confirmed.length + " confirmed")} → ` +
          `${wins.length}W/${(confirmed.length - wins.length)}L  ` +
          `P&L: ${pnl >= 0 ? chalk.green("₹" + Math.round(pnl).toLocaleString("en-IN")) : chalk.red("-₹" + Math.abs(Math.round(pnl)).toLocaleString("en-IN"))}`
        );
      } else {
        console.log(`    ${stock.symbol.padEnd(12)} ${String(candles.length).padStart(6)} candles → ${chalk.gray("0 signals")}`);
      }
    }

    // Build interval summary
    summaryByInterval[interval.label] = buildSummary(intervalTrades);
  }

  // ── Reports ──
  report.printPerIntervalSummary(summaryByInterval);
  report.printAggregate(allTrades);
  report.printTradeLog(allTrades);

  // ── Save Files ──
  report.saveResults(allTrades, allPatterns, OUTPUT_DIR);

  console.log(chalk.bold.green("  ✅ Scan + Backtest complete!\n"));
}

main();
