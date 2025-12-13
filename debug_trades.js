const { getAccountInfo, getTrades } = require('./server/binance');
const { getBinanceApiKeys } = require('./server/database');

// User ID from debug_db.js output
const userId = '110224292743761681051';

async function runCallback() {
    console.log(`Debug Trades for User ID: ${userId}`);

    // 1. Check if keys exist
    const keys = getBinanceApiKeys(userId);
    if (!keys.apiKey) {
        console.error("❌ No keys found for this user in DB!");
        return;
    }
    console.log("✅ Keys found in DB.");

    // 2. Get Account Info
    try {
        console.log("fetching account info...");
        const account = await getAccountInfo(userId);
        console.log("✅ Account Info received.");

        const balances = account.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
        console.log(`Found ${balances.length} active balances:`);
        balances.forEach(b => console.log(` - ${b.asset}: ${b.free}`));

        const symbols = balances.map(b => b.asset + 'USDT').filter(s => s !== 'USDTUSDT');
        console.log(`Checking trades for symbols: ${symbols.join(', ')}`);

        for (const symbol of symbols) {
            console.log(`\nFetching trades for ${symbol}...`);
            try {
                const trades = await getTrades(symbol, 100, userId);
                console.log(`✅ ${symbol}: Found ${trades.length} trades.`);
                if (trades.length > 0) {
                    console.log("   Last trade:", JSON.stringify(trades[trades.length - 1], null, 2));
                }
            } catch (e) {
                console.error(`❌ Error fetching ${symbol}: ${e.message}`);
                // Often 'Symbol does not exist' for things like 'USDTUSDT' or delisted pairs
            }
        }
    } catch (e) {
        console.error("❌ Fatal Error:", e.message);
        if (e.response) console.error("Response:", e.response.data);
    }
}

runCallback();
