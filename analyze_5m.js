const { getExchangeInfo, getKlines } = require('./server/binance');

async function analyze5mMovement() {
    console.log('📊 Analyzing historical 5-minute movements across Binance...');

    try {
        const exchangeInfo = await getExchangeInfo();
        const validQuoteAssets = ['USDT', 'FDUSD'];
        const symbols = exchangeInfo.symbols
            .filter(s => validQuoteAssets.includes(s.quoteAsset) && s.status === 'TRADING')
            .map(s => s.symbol)
            .slice(0, 50); // Sample top 50 symbols to avoid hitting rate limits too hard

        console.log(`🔍 Sampling last 100 candles (5m each) for ${symbols.length} pairs...`);

        let positiveChanges = [];
        let totalCandles = 0;

        for (const symbol of symbols) {
            try {
                // Fetch last 100 5-minute candles
                const klines = await getKlines(symbol, '5m', 100);

                klines.forEach(k => {
                    const open = parseFloat(k[1]);
                    const close = parseFloat(k[4]);
                    const high = parseFloat(k[2]);

                    // We only care about positive movements (Open to Close)
                    if (close > open) {
                        const change = ((close - open) / open) * 100;
                        positiveChanges.push(change);
                    }

                    // Also track the "wick" (Open to High) as that captures the "surge" peak
                    const wickChange = ((high - open) / open) * 100;
                    if (wickChange > 0) {
                        // positiveChanges.push(wickChange); 
                    }

                    totalCandles++;
                });

                // Small delay to be polite to the API
                await new Promise(r => setTimeout(r, 100));
            } catch (e) {
                console.error(`Failed to fetch ${symbol}: ${e.message}`);
            }
        }

        if (positiveChanges.length === 0) {
            console.log('❌ No positive candles found in sample.');
            return;
        }

        positiveChanges.sort((a, b) => a - b);

        const avg = positiveChanges.reduce((a, b) => a + b, 0) / positiveChanges.length;
        const median = positiveChanges[Math.floor(positiveChanges.length / 2)];
        const p90 = positiveChanges[Math.floor(positiveChanges.length * 0.9)];
        const p95 = positiveChanges[Math.floor(positiveChanges.length * 0.95)];
        const p99 = positiveChanges[Math.floor(positiveChanges.length * 0.99)];

        console.log('\n--- 5-Minute Positive Movement Analysis ---');
        console.log(`Total Candles Analyzed: ${totalCandles}`);
        console.log(`Green Candles (Close > Open): ${positiveChanges.length} (${((positiveChanges.length / totalCandles) * 100).toFixed(1)}%)`);
        console.log('-------------------------------------------');
        console.log(`Average Green Candle:   +${avg.toFixed(3)}%`);
        console.log(`Median Green Candle:    +${median.toFixed(3)}%`);
        console.log(`90th Percentile (Top 10%): +${p90.toFixed(3)}%`);
        console.log(`95th Percentile (Top 5%):  +${p95.toFixed(3)}%`);
        console.log(`99th Percentile (Extreme): +${p99.toFixed(3)}%`);
        console.log('-------------------------------------------');
        console.log('Suggested Thresholds based on this data:');
        console.log(`- Casual Momentum: +${p90.toFixed(2)}% (Triggers for top 10% of green moves)`);
        console.log(`- Strong Surge:   +${p95.toFixed(2)}% (Triggers for top 5% of green moves)`);
        console.log(`- Breakout/Pump:  +${p99.toFixed(2)}% (Only the top 1% of moves)`);
        console.log('-------------------------------------------\n');

    } catch (error) {
        console.error('Error during analysis:', error.message);
    }
}

analyze5mMovement();
