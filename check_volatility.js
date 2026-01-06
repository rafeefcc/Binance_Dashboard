const { getTickerPrice, getExchangeInfo } = require('./server/binance');

async function checkVolatility() {
    console.log('📊 Analyzing current market volatility...');

    try {
        const exchangeInfo = await getExchangeInfo();
        const validQuoteAssets = ['USDT', 'FDUSD'];
        const symbols = exchangeInfo.symbols
            .filter(s => validQuoteAssets.includes(s.quoteAsset) && s.status === 'TRADING')
            .map(s => s.symbol);

        console.log(`🔍 Monitoring ${symbols.length} pairs...`);

        // Get Snapshot 1
        const tickers1 = await getTickerPrice();
        const priceMap1 = new Map();
        tickers1.forEach(t => priceMap1.set(t.symbol, parseFloat(t.price)));

        console.log('⏳ Waiting 60 seconds for price movement sampling...');
        await new Promise(resolve => setTimeout(resolve, 60000));

        // Get Snapshot 2
        const tickers2 = await getTickerPrice();
        const priceMap2 = new Map();
        tickers2.forEach(t => priceMap2.set(t.symbol, parseFloat(t.price)));

        let totalAbsChange = 0;
        let count = 0;
        let maxUp = { symbol: '', change: 0 };
        let maxDown = { symbol: '', change: 0 };
        let above01 = 0;
        let above05 = 0;

        symbols.forEach(symbol => {
            const p1 = priceMap1.get(symbol);
            const p2 = priceMap2.get(symbol);

            if (p1 && p2 && p1 > 0) {
                const change = ((p2 - p1) / p1) * 100;
                totalAbsChange += Math.abs(change);
                count++;

                if (change > maxUp.change) maxUp = { symbol, change };
                if (change < maxDown.change) maxDown = { symbol, change };

                if (Math.abs(change) >= 0.1) above01++;
                if (Math.abs(change) >= 0.5) above05++;
            }
        });

        const avg1min = totalAbsChange / count;
        const est5min = avg1min * Math.sqrt(5); // Volatility usually scales with sqrt of time

        console.log('\n--- Market Volatility Report (1-Minute Sample) ---');
        console.log(`Average 1-min Movement: ${avg1min.toFixed(4)}%`);
        console.log(`Estimated 5-min Movement: ${est5min.toFixed(4)}%`);
        console.log(`Total pairs checked: ${count}`);
        console.log(`Pairs moving > 0.1%: ${above01} (${((above01 / count) * 100).toFixed(1)}%)`);
        console.log(`Pairs moving > 0.5%: ${above05} (${((above05 / count) * 100).toFixed(1)}%)`);
        console.log(`Top Gainer (1m): ${maxUp.symbol} (+${maxUp.change.toFixed(3)}%)`);
        console.log(`Top Loser (1m): ${maxDown.symbol} (${maxDown.change.toFixed(3)}%)`);
        console.log('--------------------------------------------------');

    } catch (error) {
        console.error('Error checking volatility:', error.message);
    }
}

checkVolatility();
