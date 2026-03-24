/**
 * index-hammer-doji.js — HAMMER → DOJI strategy only
 *
 * Reads locally cached candle data from ./data/, detects Hammer→Doji patterns,
 * applies confirmation filters, simulates trades, and outputs results.
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
    console.error(chalk.red("  No data found. Run: npm run fetch\n"));
    process.exit(1);
  }

  const allPatterns = [];
  const allTrades   = [];
  const summaryByInterval = {};

  for (const interval of INTERVALS) {
    const dir = path.join(DATA_DIR, interval.label);
    if (!fs.existsSync(dir)) {
      console.log(chalk.yellow(`  No data for ${interval.label} — skipping`));
      continue;
    }

    console.log(chalk.bold(`\n  ${interval.label.toUpperCase()}`));
    console.log("  " + "-".repeat(60));

    let intervalTrades = [];

    for (const stock of NSE_TOP_10) {
      const filePath = path.join(dir, `${stock.symbol}.json`);
      if (!fs.existsSync(filePath)) {
        console.log(chalk.gray(`    ${stock.symbol.padEnd(12)} — no data file`));
        continue;
      }

      const candles = JSON.parse(fs.readFileSync(filePath, "utf8"));

      // ── Step 1: Detect Patterns (Hammer→Doji only) ──
      const { hammerThenDoji } = scanPatterns(candles, stock.symbol, interval.label);
      const signals = hammerThenDoji;
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
          `${String(candles.length).padStart(6)} candles -> ` +
          `${chalk.cyan(signals.length + " signals")} -> ` +
          `${chalk.green(confirmed.length + " confirmed")} -> ` +
          `${wins.length}W/${(confirmed.length - wins.length)}L  ` +
          `P&L: ${pnl >= 0 ? chalk.green("Rs" + Math.round(pnl).toLocaleString("en-IN")) : chalk.red("-Rs" + Math.abs(Math.round(pnl)).toLocaleString("en-IN"))}`
        );
      } else {
        console.log(`    ${stock.symbol.padEnd(12)} ${String(candles.length).padStart(6)} candles -> ${chalk.gray("0 signals")}`);
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

  console.log(chalk.bold.green("  Scan + Backtest complete! (Hammer -> Doji only)\n"));
}

main();
