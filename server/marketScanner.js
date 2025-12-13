const { getOrderBook, get24hrTicker, getExchangeInfo } = require('./binance');
const { sendMarketAlert } = require('./telegram');

// Store previous inflow data for comparison
const previousInflowData = new Map();
let allSymbols = [];
let isScanning = false;

// Initialize scanner - get all USDT trading pairs
async function initializeScanner() {
    try {
        const exchangeInfo = await getExchangeInfo();
        allSymbols = exchangeInfo.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);

        console.log(`📊 Market Scanner initialized with ${allSymbols.length} USDT pairs`);
        return true;
    } catch (error) {
        console.error('Failed to initialize market scanner:', error.message);
        return false;
    }
}

// Calculate net inflow for a symbol
async function calculateInflow(symbol) {
    try {
        const orderBook = await getOrderBook(symbol, 100);

        // Calculate bid volume (buy pressure)
        const bidVolume = orderBook.bids.reduce((sum, [price, qty]) => {
            return sum + (parseFloat(price) * parseFloat(qty));
        }, 0);

        // Calculate ask volume (sell pressure)
        const askVolume = orderBook.asks.reduce((sum, [price, qty]) => {
            return sum + (parseFloat(price) * parseFloat(qty));
        }, 0);

        // Net inflow = bid volume - ask volume
        const netInflow = bidVolume - askVolume;

        return {
            symbol,
            bidVolume,
            askVolume,
            netInflow,
            timestamp: Date.now()
        };
    } catch (error) {
        // Skip symbols that fail (might be delisted or have issues)
        return null;
    }
}

// Scan all markets and return top coins by inflow
async function scanMarkets(limit = 20) {
    if (allSymbols.length === 0) {
        await initializeScanner();
    }

    if (isScanning) {
        console.log('⏳ Scan already in progress, skipping...');
        return [];
    }

    isScanning = true;
    console.log('🔍 Starting market scan...');

    try {
        // Calculate inflow for all symbols (in batches to avoid rate limits)
        const batchSize = 10;
        const results = [];

        for (let i = 0; i < allSymbols.length; i += batchSize) {
            const batch = allSymbols.slice(i, i + batchSize);
            const batchPromises = batch.map(symbol => calculateInflow(symbol));
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(r => r !== null));

            // Small delay between batches
            if (i + batchSize < allSymbols.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Sort by net inflow (highest first)
        results.sort((a, b) => b.netInflow - a.netInflow);

        // Get top results
        const topResults = results.slice(0, limit);

        // Check for surges and send alerts
        for (const result of topResults.slice(0, 5)) { // Check top 5
            const previous = previousInflowData.get(result.symbol);

            if (previous) {
                const change = ((result.netInflow - previous.netInflow) / Math.abs(previous.netInflow)) * 100;

                // Alert if inflow increased by more than 50%
                if (change > 50 && result.netInflow > 10000) {
                    await sendMarketAlert(result.symbol, result.netInflow, change);
                }
            }

            // Store current data for next comparison
            previousInflowData.set(result.symbol, result);
        }

        console.log(`✅ Scan complete. Top coin: ${topResults[0]?.symbol} with ${topResults[0]?.netInflow.toFixed(2)} USDT inflow`);

        isScanning = false;
        return topResults;
    } catch (error) {
        console.error('Market scan error:', error.message);
        isScanning = false;
        return [];
    }
}

// Start periodic scanning
function startPeriodicScan(intervalMinutes = 5) {
    console.log(`⏰ Starting periodic market scan every ${intervalMinutes} minutes`);

    // Initial scan
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
