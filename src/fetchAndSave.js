/**
 * fetchAndSave.js — Fetch data from Kite and save locally as JSON
 *
 * Run once:  npm run fetch
 * This pulls 1 year of candle data for all 10 stocks across all 4 intervals,
 * saves to /data/{interval}/{SYMBOL}.json so subsequent scans are offline.
 *
 * Re-run whenever you want fresh data.
 */

require("dotenv").config();
const { KiteConnect } = require("kiteconnect");
const fs   = require("fs");
const path = require("path");
const { NSE_TOP_10, INTERVALS, KITE, DATA_DIR } = require("./config");

const kite = new KiteConnect({ api_key: KITE.apiKey });
kite.setAccessToken(KITE.accessToken);

// ── Helpers ──────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmt(d) { return d.toISOString().split("T")[0]; }

/** Convert a Date or ISO string to IST string: "YYYY-MM-DD HH:mm:ss" */
function toIST(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).replace(/(\d+)\/(\d+)\/(\d+),\s*/, "$3-$2-$1 ");
}

function buildChunks(fromDate, toDate, chunkDays) {
  const chunks = [];
  let cursor = new Date(fromDate);
  const end  = new Date(toDate);

  while (cursor < end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
    const actualEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({ from: fmt(cursor), to: fmt(actualEnd) });
    cursor = new Date(actualEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

// ── Fetch one stock + one interval ───────────────────────────

async function fetchOne(token, symbol, interval) {
  const now  = new Date();
  const from = new Date();
  from.setDate(from.getDate() - interval.lookbackDays);

  const chunks = buildChunks(from, now, interval.chunkDays);
  let all = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      const data = await kite.getHistoricalData(
        token,
        interval.kiteInterval,
        chunks[i].from,
        chunks[i].to
      );

      const candles = data.map((c) => ({
        date:   toIST(c.date),
        open:   c.open,
        high:   c.high,
        low:    c.low,
        close:  c.close,
        volume: c.volume,
      }));

      all = all.concat(candles);
      process.stdout.write(`      chunk ${i + 1}/${chunks.length}\r`);
    } catch (err) {
      if (err.message && (err.message.includes("Token") || err.status === 403)) {
        throw new Error("Access token expired. Run: npm run login");
      }
      console.error(`\n      ❌ chunk ${i+1} failed: ${err.message}`);
    }

    await sleep(350); // rate limit
  }

  // deduplicate by date
  const seen = new Set();
  all = all.filter((c) => {
    if (seen.has(c.date)) return false;
    seen.add(c.date);
    return true;
  });
  all.sort((a, b) => new Date(a.date) - new Date(b.date));

  return all;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║      FETCH & SAVE — Kite Historical Data Downloader     ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  if (!KITE.accessToken) {
    console.error("  ❌ No access token. Run: npm run login\n");
    process.exit(1);
  }

  for (const interval of INTERVALS) {
    const dir = path.join(DATA_DIR, interval.label);
    fs.mkdirSync(dir, { recursive: true });

    console.log(`\n  ⏱️  INTERVAL: ${interval.label} (${interval.kiteInterval})`);
    console.log("  " + "─".repeat(50));

    for (const stock of NSE_TOP_10) {
      process.stdout.write(`    📡 ${stock.symbol.padEnd(12)} → `);

      try {
        const candles = await fetchOne(stock.token, stock.symbol, interval);
        const filePath = path.join(dir, `${stock.symbol}.json`);
        fs.writeFileSync(filePath, JSON.stringify(candles, null, 2));
        console.log(`${candles.length} candles saved ✅`);
      } catch (err) {
        console.error(`FAILED ❌  ${err.message}`);
        if (err.message.includes("expired")) process.exit(1);
      }
    }
  }

  console.log("\n  ✅ All data saved to ./data/");
  console.log("  Now run: npm run scan\n");
}

main().catch((err) => {
  console.error("  ❌ Fatal:", err.message);
  process.exit(1);
});
