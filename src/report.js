/**
 * report.js — Pretty-print backtest results + export CSV/JSON
 */

const Table  = require("cli-table3");
const chalk  = require("chalk");
const fs     = require("fs");
const path   = require("path");
const { TRADE_CONFIG } = require("./config");

// ══════════════════════════════════════════════════════════════
//  CONSOLE REPORTS
// ══════════════════════════════════════════════════════════════

function printHeader() {
  console.log("\n" + chalk.bold.cyan("╔══════════════════════════════════════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("║   DOJI + HAMMER — PATTERN SCANNER + BACKTEST + CONFIRMATION          ║"));
  console.log(chalk.bold.cyan("╠══════════════════════════════════════════════════════════════════════╣"));
  console.log(chalk.cyan("║  Entry:  Next candle open after pattern                               ║"));
  console.log(chalk.cyan("║  SL:     Below hammer low (dynamic, based on hammer range)             ║"));
  console.log(chalk.cyan("║  Target: R-multiples (T1=conservative, T2=exit trigger, T3=stretch)    ║"));
  console.log(chalk.cyan("║  Confirm: Bullish entry candle + Volume above average                  ║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════════════════════════════════════════════╝\n"));
}

function printPerIntervalSummary(summaryByInterval) {
  const table = new Table({
    head: [
      chalk.white("Interval"),
      chalk.white("Signals"),
      chalk.white("Confirmed"),
      chalk.white("Skipped"),
      chalk.white("Wins"),
      chalk.white("Losses"),
      chalk.white("Win %"),
      chalk.white("Total P&L"),
      chalk.white("Avg R"),
      chalk.white("PF"),
      chalk.white("T1 Hit%"),
      chalk.white("T2 Hit%"),
    ],
    colAligns: ["left","right","right","right","right","right","right","right","right","right","right","right"],
    style: { head: [], border: [] },
  });

  for (const [iv, s] of Object.entries(summaryByInterval)) {
    table.push([
      chalk.bold.cyan(iv),
      s.totalSignals,
      chalk.green(s.confirmed),
      chalk.gray(s.skipped),
      chalk.green(s.wins),
      chalk.red(s.losses),
      colorPct(s.winRate),
      colorPnl(s.totalPnl),
      colorR(s.avgR),
      s.profitFactor === Infinity ? chalk.green("∞") : s.profitFactor.toFixed(2),
      `${s.t1HitRate}%`,
      `${s.t2HitRate}%`,
    ]);
  }

  console.log(chalk.bold("\n  📊 PER-INTERVAL SUMMARY\n"));
  console.log(table.toString());
}

function printAggregate(allTrades) {
  const confirmed = allTrades.filter((t) => t.confirmed === "YES");
  if (confirmed.length === 0) {
    console.log(chalk.yellow("\n  ⚠️  No confirmed trades.\n"));
    return;
  }

  const wins   = confirmed.filter((t) => t.pnl > 0);
  const losses = confirmed.filter((t) => t.pnl <= 0);
  const total  = confirmed.reduce((s, t) => s + t.pnl, 0);
  const avgR   = confirmed.reduce((s, t) => s + t.r_multiple, 0) / confirmed.length;
  const gp     = wins.reduce((s, t) => s + t.pnl, 0);
  const gl     = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf     = gl > 0 ? (gp / gl).toFixed(2) : "∞";

  const exits = {};
  for (const t of confirmed) exits[t.exit_type] = (exits[t.exit_type] || 0) + 1;

  const t1h = confirmed.filter((t) => t.t1_hit === "YES").length;
  const t2h = confirmed.filter((t) => t.t2_hit === "YES").length;
  const t3h = confirmed.filter((t) => t.t3_hit === "YES").length;

  // By pattern type
  const dh = confirmed.filter((t) => t.pattern === "doji_then_hammer");
  const hd = confirmed.filter((t) => t.pattern === "hammer_then_doji");
  const dhWin = dh.filter((t) => t.pnl > 0).length;
  const hdWin = hd.filter((t) => t.pnl > 0).length;

  const agg = new Table({ style: { head: [], border: [] } });
  agg.push(
    { [chalk.bold("OVERALL (Confirmed trades only)")]: "" },
    { "Total Signals":        chalk.bold(allTrades.length) },
    { "Confirmed / Traded":   `${chalk.green(confirmed.length)} / ${allTrades.length}` },
    { "Win / Loss":           `${chalk.green(wins.length)} / ${chalk.red(losses.length)}` },
    { "Win Rate":             colorPct((wins.length / confirmed.length) * 100) },
    { "Total P&L":            colorPnl(total) },
    { "Avg R-multiple":       colorR(avgR) },
    { "Profit Factor":        pf },
    { "Best Trade":           colorPnl(wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0) },
    { "Worst Trade":          colorPnl(losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0) },
    { "": "" },
    { [chalk.bold("TARGET HIT RATES")]: "" },
    { "  T1 (conservative)":  `${t1h}/${confirmed.length} = ${((t1h/confirmed.length)*100).toFixed(1)}%` },
    { "  T2 (exit trigger)":  `${t2h}/${confirmed.length} = ${((t2h/confirmed.length)*100).toFixed(1)}%` },
    { "  T3 (stretch)":       `${t3h}/${confirmed.length} = ${((t3h/confirmed.length)*100).toFixed(1)}%` },
    { "": "" },
    { [chalk.bold("EXIT BREAKDOWN")]: "" },
    { "  🎯 Target T2":   exits["TARGET_T2"] || 0 },
    { "  🛑 Stop Loss":   exits["STOP_LOSS"] || 0 },
    { "  ⏰ Max Hold":    exits["MAX_HOLD"]  || 0 },
    { "": "" },
    { [chalk.bold("BY PATTERN TYPE")]: "" },
    { "  Doji→Hammer":    `${dh.length} trades, ${dhWin} wins (${dh.length ? ((dhWin/dh.length)*100).toFixed(1) : 0}%)` },
    { "  Hammer→Doji":    `${hd.length} trades, ${hdWin} wins (${hd.length ? ((hdWin/hd.length)*100).toFixed(1) : 0}%)` },
  );

  console.log(chalk.bold("\n  📈 AGGREGATE STATS\n"));
  console.log(agg.toString());
}

function printTradeLog(allTrades) {
  const confirmed = allTrades.filter((t) => t.confirmed === "YES");
  if (confirmed.length === 0) return;

  confirmed.sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));

  const table = new Table({
    head: [
      chalk.white("#"),
      chalk.white("Stock"),
      chalk.white("TF"),
      chalk.white("Pat"),
      chalk.white("Entry ₹"),
      chalk.white("SL ₹"),
      chalk.white("T2 ₹"),
      chalk.white("Exit ₹"),
      chalk.white("Exit"),
      chalk.white("R"),
      chalk.white("P&L ₹"),
      chalk.white("T1?"),
      chalk.white("T3?"),
    ],
    colAligns: ["right","left","left","left","right","right","right","right","left","right","right","center","center"],
    style: { head: [], border: [] },
  });

  confirmed.forEach((t, i) => {
    const pat = t.pattern === "doji_then_hammer" ? "D→H" : "H→D";
    table.push([
      i + 1,
      t.symbol,
      t.interval,
      pat,
      t.entry_price.toFixed(1),
      t.sl_price.toFixed(1),
      t.t2_price.toFixed(1),
      t.exit_price.toFixed(1),
      exitBadge(t.exit_type),
      colorR(t.r_multiple),
      colorPnl(t.pnl),
      t.t1_hit === "YES" ? chalk.green("✓") : chalk.gray("—"),
      t.t3_hit === "YES" ? chalk.green("✓") : chalk.gray("—"),
    ]);
  });

  console.log(chalk.bold("\n  📋 CONFIRMED TRADE LOG\n"));
  console.log(table.toString());

  // Also show skipped trades count
  const skipped = allTrades.filter((t) => t.confirmed === "NO");
  if (skipped.length > 0) {
    console.log(chalk.gray(`\n  (${skipped.length} signals skipped — failed confirmation filter)`));
  }
}

// ══════════════════════════════════════════════════════════════
//  FILE EXPORTS
// ══════════════════════════════════════════════════════════════

function saveResults(allTrades, patterns, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Pattern CSVs (same as before, but now with hammer_low/range/signalIndex)
  const dh = patterns.filter((p) => p.pattern === "doji_then_hammer");
  const hd = patterns.filter((p) => p.pattern === "hammer_then_doji");
  writeCsv(path.join(outputDir, "doji_then_hammer.csv"), dh);
  writeCsv(path.join(outputDir, "hammer_then_doji.csv"), hd);

  // 2. All trades CSV (confirmed + skipped, tagged)
  writeCsv(path.join(outputDir, "all_trades.csv"), allTrades);

  // 3. Confirmed trades only
  const confirmed = allTrades.filter((t) => t.confirmed === "YES");
  writeCsv(path.join(outputDir, "confirmed_trades.csv"), confirmed);

  // 4. Full JSON
  const json = {
    generated: new Date().toISOString(),
    config: TRADE_CONFIG,
    totalSignals: allTrades.length,
    confirmedTrades: confirmed.length,
    trades: allTrades,
  };
  fs.writeFileSync(path.join(outputDir, "backtest_results.json"), JSON.stringify(json, null, 2));

  console.log(chalk.bold("\n  💾 OUTPUT FILES\n"));
  console.log(`    ${chalk.green("✅")} doji_then_hammer.csv    → ${dh.length} patterns`);
  console.log(`    ${chalk.green("✅")} hammer_then_doji.csv    → ${hd.length} patterns`);
  console.log(`    ${chalk.green("✅")} all_trades.csv          → ${allTrades.length} trades (all signals)`);
  console.log(`    ${chalk.green("✅")} confirmed_trades.csv    → ${confirmed.length} trades (confirmed only)`);
  console.log(`    ${chalk.green("✅")} backtest_results.json   → full data`);
  console.log(`\n    Location: ${outputDir}\n`);
}

function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "No data\n");
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => {
        const val = String(r[h]);
        return val.includes(",") || val.includes("T") || val.includes('"')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(",")
    ),
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
}

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

function colorPnl(val) {
  const abs = Math.abs(val);
  const str = `₹${abs.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return val >= 0 ? chalk.green(`+${str}`) : chalk.red(`-${str}`);
}

function colorPct(val) {
  const str = `${val.toFixed(1)}%`;
  return val >= 55 ? chalk.green(str) : val >= 40 ? chalk.yellow(str) : chalk.red(str);
}

function colorR(val) {
  const str = `${val.toFixed(2)}R`;
  return val >= 1 ? chalk.green(str) : val >= 0 ? chalk.yellow(str) : chalk.red(str);
}

function exitBadge(type) {
  switch (type) {
    case "TARGET_T2": return chalk.green("🎯 T2");
    case "STOP_LOSS": return chalk.red("🛑 SL");
    case "MAX_HOLD":  return chalk.yellow("⏰ HOLD");
    default:          return type;
  }
}

module.exports = { printHeader, printPerIntervalSummary, printAggregate, printTradeLog, saveResults };
