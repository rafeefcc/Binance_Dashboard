const { getTickerPrice, getExchangeInfo } = require('./binance');
const { sendMarketAlert } = require('./telegram');
const { getAllUsersWithTelegram } = require('./database');

// Store price history for comparison
// Structure: Map<symbol, [{price, timestamp}, ...]>
const priceHistory = new Map();
const HISTORY_LIMIT_MS = 25 * 60 * 1000; // Keep 25 minutes of history
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown per symbol

const cooldowns = new Map(); // symbol -> lastAlertTime

let allSymbols = [];
let isScanning = false;

// Initialize scanner - get all USDT/FDUSD trading pairs
async function initializeScanner() {
    try {
        const exchangeInfo = await getExchangeInfo();
        const validQuoteAssets = ['USDT', 'FDUSD'];
        allSymbols = exchangeInfo.symbols
            .filter(s => validQuoteAssets.includes(s.quoteAsset) && s.status === 'TRADING')
            .map(s => s.symbol);

        console.log(`📊 Market Scanner initialized with ${allSymbols.length} pairs (${validQuoteAssets.join('/')})`);
        return true;
    } catch (error) {
        console.error('Failed to initialize market scanner:', error.message);
        return false;
    }
}

// Scan all markets and return coins with price surges
async function scanMarkets() {
    if (allSymbols.length === 0) {
        await initializeScanner();
    }

    if (isScanning) {
        return [];
    }

    isScanning = true;
    const now = Date.now();

    try {
        // Get current prices for all symbols in one call
        const tickers = await getTickerPrice();
        const tickerMap = new Map();
        tickers.forEach(t => tickerMap.set(t.symbol, parseFloat(t.price)));

        const alertResults = [];

        // Update history and check for alerts for each managed symbol
        allSymbols.forEach(symbol => {
            const currentPrice = tickerMap.get(symbol);
            if (!currentPrice) return;

            if (!priceHistory.has(symbol)) {
                priceHistory.set(symbol, []);
            }

            const history = priceHistory.get(symbol);

            // 1. Check for alerts BEFORE adding new price to history
            // We look for a price point from ~15-20 minutes ago
            const targetTime = now - (15 * 60 * 1000); // 15 mins ago

            // Find the oldest price in the window [targetTime - 6mins, targetTime]
            // This ensures we compare against a stable baseline from about 15-20 mins ago
            const baseline = history.find(h => h.timestamp <= targetTime && h.timestamp > targetTime - (10 * 60 * 1000));

            if (baseline) {
                const percentChange = ((currentPrice - baseline.price) / baseline.price) * 100;
                const timeDiffMins = Math.round((now - baseline.timestamp) / 60000);

                // Alert if price increased by more than 1%
                if (percentChange >= 1.0) {
                    // Check cooldown
                    const lastAlert = cooldowns.get(symbol) || 0;
                    if (now - lastAlert > ALERT_COOLDOWN_MS) {
                        console.log(`🚀 [Price Surge] ${symbol}: +${percentChange.toFixed(2)}% in ${timeDiffMins}m ($${baseline.price} -> $${currentPrice})`);

                        cooldowns.set(symbol, now);

                        alertResults.push({
                            symbol,
                            oldPrice: baseline.price,
                            newPrice: currentPrice,
                            percentChange,
                            timeWindow: timeDiffMins
                        });

                        // Send alerts to all configured users
                        const users = getAllUsersWithTelegram();
                        users.forEach(user => {
                            sendMarketAlert(user.user_id, symbol, baseline.price, currentPrice, percentChange, timeDiffMins);
                        });
                    }
                }
            }

            // 2. Add current price to history
            history.push({ price: currentPrice, timestamp: now });

            // 3. Clean up old history
            const cutoff = now - HISTORY_LIMIT_MS;
            while (history.length > 0 && history[0].timestamp < cutoff) {
                history.shift();
            }
        });

        console.log(`✅ Price scan complete. Checked ${allSymbols.length} pairs.`);

        isScanning = false;
        return alertResults;
    } catch (error) {
        console.error('Market price scan error:', error.message);
        isScanning = false;
        return [];
    }
}

// Start periodic scanning
function startPeriodicScan(intervalMinutes = 5) {
    console.log(`⏰ Starting periodic price scan every ${intervalMinutes} minutes`);

    // Initial scan to build baseline
    scanMarkets();

    // Periodic scans
    setInterval(() => {
        scanMarkets();
    }, intervalMinutes * 60 * 1000);
}

module.exports = {
    initializeScanner,
    scanMarkets,
    startPeriodicScan
};
