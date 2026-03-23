/**
 * auth.js — Zerodha Kite Login Flow
 *
 * Step 1: Run `npm run login` → opens a URL in terminal
 * Step 2: Open that URL in browser, log in to Zerodha
 * Step 3: After redirect, copy the `request_token` from the URL
 * Step 4: Paste it when prompted → saves access_token to .env
 */

require("dotenv").config();
const { KiteConnect } = require("kiteconnect");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const kite = new KiteConnect({ api_key: process.env.ZERODHA_API_KEY });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function authenticate() {
  const loginUrl = kite.getLoginURL();

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║           ZERODHA KITE AUTHENTICATION                   ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  1. Open this URL in your browser:                      ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`  ${loginUrl}\n`);
  console.log("  2. Log in with your Zerodha credentials.");
  console.log("  3. After login, you'll be redirected to a URL like:");
  console.log("     https://127.0.0.1/?request_token=XXXXXXX&action=login");
  console.log("  4. Copy the request_token value and paste below.\n");

  rl.question("  Enter request_token: ", async (requestToken) => {
    try {
      const session = await kite.generateSession(
        requestToken.trim(),
        process.env.ZERODHA_API_SECRET
      );

      const accessToken = session.access_token;
      console.log(`\n  ✅ Access token obtained: ${accessToken.slice(0, 8)}...`);

      // Update .env file with the access token
      const envPath = path.join(__dirname, "..", ".env");
      let envContent = fs.readFileSync(envPath, "utf8");
      envContent = envContent.replace(
        /ZERODHA_ACCESS_TOKEN=.*/,
        `ZERODHA_ACCESS_TOKEN=${accessToken}`
      );
      fs.writeFileSync(envPath, envContent);

      console.log("  ✅ Access token saved to .env");
      console.log("\n  Now run: npm run backtest\n");
    } catch (err) {
      console.error("\n  ❌ Authentication failed:", err.message);
      console.error("  Make sure the request_token is fresh (expires quickly).\n");
    }
    rl.close();
  });
}

authenticate();
