const express = require('express');
const passport = require('passport');
const { ensureAuthenticated } = require('./auth');
const { getAccountInfo, getTrades, getAllOrders, getOpenOrders, getTickerPrice, getApiKeys } = require('./binance');
const { getPublicSettings, saveSettings } = require('./settings');
const { scanMarkets } = require('./marketScanner');
const { initBotForUser } = require('./telegram');

const router = express.Router();

// ============ Authentication Routes ============

// Initiate Google OAuth
router.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback
router.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html' }),
    (req, res) => {
        res.redirect('/');
    }
);

// Logout
router.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.redirect('/login.html');
    });
});

// Get current user
router.get('/auth/user', ensureAuthenticated, (req, res) => {
    res.json(req.user);
});

// ============ Settings Routes ============

// Get settings
router.get('/api/settings', ensureAuthenticated, (req, res) => {
    try {
        const settings = getPublicSettings(req.user.id);
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save settings
router.post('/api/settings', ensureAuthenticated, express.json(), async (req, res) => {
    try {
        console.log('🔧 POST /api/settings called');
        console.log('User ID:', req.user?.id);
        console.log('Request body:', req.body);

        const { binanceApiKey, binanceApiSecret, telegramBotToken, telegramChatId } = req.body;

        const newSettings = {};

        if (binanceApiKey !== undefined) newSettings.binanceApiKey = binanceApiKey;
        if (binanceApiSecret !== undefined) newSettings.binanceApiSecret = binanceApiSecret;
        if (telegramBotToken !== undefined) newSettings.telegramBotToken = telegramBotToken;
        if (telegramChatId !== undefined) newSettings.telegramChatId = telegramChatId;

        console.log('Settings to save:', newSettings);

        saveSettings(req.user.id, newSettings);

        // Initialize Telegram bot if token was provided
        if (telegramBotToken && telegramBotToken.length > 0) {
            console.log(`🤖 Initializing Telegram bot for user ${req.user.id}...`);
            const success = await initBotForUser(req.user.id);
            if (success) {
                console.log(`✅ Telegram bot ready for user ${req.user.id}`);
            } else {
                console.log(`⚠️ Telegram bot initialization failed for user ${req.user.id}`);
            }
        }

        console.log('✅ Settings saved successfully');

        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) {
        console.error('❌ Error saving settings:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ Binance API Routes ============

// Get account info
router.get('/api/account', ensureAuthenticated, async (req, res) => {
    try {
        const account = await getAccountInfo(req.user.id);
        res.json(account);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all trades with P&L calculations
router.get('/api/trades/all', ensureAuthenticated, async (req, res) => {
    try {
        // Get account to find symbols with balances
        console.log(`[API] Fetching account info for user ${req.user.id}`);
        const account = await getAccountInfo(req.user.id);

        let symbols = account.balances
            .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
            .map(b => b.asset + 'USDT')
            .filter(s => s !== 'USDTUSDT');

        console.log(`[API] Found ${symbols.length} symbols with balance:`, symbols);

        // Fallback: If no balances, check recent orders (optional, or just return empty)
        // For now, let's also add some common pairs if the user has no balances but might have history
        if (symbols.length === 0) {
            console.log('[API] No non-USDT balances found. Checking common pairs for history...');
            // This is a comprehensive list but we limit calls to avoid rate limits if possible
            // For a better solution, we should fetch "allOrders" for all pairs, but that's heavy.
            // Let's stick to what we have or maybe add top 5 pairs just in case?
            // symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
        }

        // Get trades for each symbol
        const allTrades = [];
        for (const symbol of symbols) {
            try {
                console.log(`[API] Fetching trades for ${symbol}`);
                const trades = await getTrades(symbol, 1000, req.user.id);
                console.log(`[API] ${symbol}: Found ${trades.length} trades`);
                allTrades.push(...trades.map(t => ({ ...t, symbol })));
            } catch (error) {
                console.error(`[API] Error fetching trades for ${symbol}:`, error.message);
                // Skip symbols that don't exist or have errors
                continue;
            }
        }

        // Calculate P&L for each trade
        const tradesWithPL = await calculateProfitLoss(allTrades);

        res.json(tradesWithPL);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get portfolio summary
router.get('/api/portfolio', ensureAuthenticated, async (req, res) => {
    try {
        const { period } = req.query; // 24h, 7d, 30d, all

        // Get account info to identify symbols
        const account = await getAccountInfo(req.user.id);
        const symbols = account.balances
            .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
            .map(b => b.asset + 'USDT')
            .filter(s => s !== 'USDTUSDT');

        const allTrades = [];
        for (const symbol of symbols) {
            try {
                const trades = await getTrades(symbol, 500, req.user.id);
                allTrades.push(...trades.map(t => ({ ...t, symbol })));
            } catch (error) {
                continue;
            }
        }

        // Use the centralized P&L logic to process all data first
        // This ensures weighted average costs and realized P&L are accurate globally
        const pnlResults = await calculateProfitLoss(allTrades);

        // Calculate Total Invested (Risk) based on OPEN positions only
        const totalInvested = pnlResults
            .filter(r => r.position > 0)
            .reduce((sum, r) => sum + (r.position * r.averageCost), 0);

        // Calculate Totals
        // Total Realized P&L (lifetime)
        const totalRealized = pnlResults.reduce((sum, r) => sum + r.realizedPL, 0);

        // Total Unrealized P&L (only for OPEN positions)
        const totalUnrealized = pnlResults
            .filter(r => r.position > 0)
            .reduce((sum, r) => sum + r.unrealizedPL, 0);

        // Total P&L for dashboard = only unrealized P&L of open positions
        const totalPL = totalUnrealized;

        // PL Percentage on Active Investment (Risk)
        const plPercentage = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;

        res.json({
            totalInvested,   // Cost of Open Positions
            totalRealized,   // Lifetime realized P&L
            totalPL,         // Unrealized P&L of open positions only
            plPercentage,
            tradeCount: allTrades.length,
            period
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get open orders
router.get('/api/open-orders', ensureAuthenticated, async (req, res) => {
    try {
        const orders = await getOpenOrders(null, req.user.id);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ Market Scanner Routes ============

// Get market scan results
router.get('/api/market-scan', ensureAuthenticated, async (req, res) => {
    try {
        const results = await scanMarkets(50);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ Helper Functions ============

async function calculateProfitLoss(trades) {
    // Group trades by symbol
    const tradesBySymbol = {};
    trades.forEach(trade => {
        if (!tradesBySymbol[trade.symbol]) {
            tradesBySymbol[trade.symbol] = [];
        }
        tradesBySymbol[trade.symbol].push(trade);
    });

    // Get current prices
    const prices = await getTickerPrice();
    const priceMap = {};
    prices.forEach(p => {
        priceMap[p.symbol] = parseFloat(p.price);
    });

    // Calculate P&L for each symbol
    const results = [];
    const FLAT_FEE_RATE = 0.00075; // 0.075%

    for (const [symbol, symbolTrades] of Object.entries(tradesBySymbol)) {
        // Sort trades by time (oldest first) to calculate history correctly
        symbolTrades.sort((a, b) => a.time - b.time);

        let position = 0;
        let weightedAvgPrice = 0;
        let realizedPL = 0;

        const enrichedTrades = symbolTrades.map(trade => {
            const qty = parseFloat(trade.qty);
            const price = parseFloat(trade.price);

            // IGNORE API fee, calculate flat estimated fee
            const estimatedFee = (price * qty) * FLAT_FEE_RATE;

            const isBuyer = trade.isBuyer;
            const isMaker = trade.isMaker;

            let tradePL = 0;
            let netUSDT = 0;
            let netCoin = 0;
            let type = isBuyer ? 'BUY' : 'SELL';

            if (isBuyer) {
                // WACB Update: New Avg = ((Pos * WAP) + (Qty * Price)) / (Pos + Qty)
                const oldCost = position * weightedAvgPrice;
                const newCost = qty * price;
                const newPos = position + qty;

                if (newPos > 0) {
                    weightedAvgPrice = (oldCost + newCost) / newPos;
                }

                position = newPos;

                // Net Coin: Qty (Fee is assumed paid in USDT/Quote for simplicity in "Net Coin" or we assume "Net Coin" is just Qty bought)
                // User asked to ignore BNB fees. 
                // If we assume fee is deducted from the principal (USDT), then:
                netCoin = qty;
                // Net USDT: -(Price * Qty) - Estimated USDT Fee
                netUSDT = -(qty * price) - estimatedFee;

            } else { // SELL
                const proceeds = qty * price;
                const costBasis = qty * weightedAvgPrice;

                // Net USDT: Proceeds - Estimated Fee
                netUSDT = proceeds - estimatedFee;
                netCoin = -qty;

                // Realized P&L = Proceeds - Cost Basis - Estimated Fee
                tradePL = proceeds - costBasis - estimatedFee;
                realizedPL += tradePL;

                position -= qty;

                // Reset WAP if closed (standard practice)
                if (position <= 0.00000001) {
                    position = 0;
                    weightedAvgPrice = 0;
                }
            }

            return {
                ...trade,
                type,
                tradePL: isBuyer ? 0 : tradePL,
                weightedAvgPriceSnapshot: weightedAvgPrice,
                netInCoin: netCoin,
                netInUSDT: netUSDT,
                isMaker: isMaker, // Propagate isMaker
                fee: estimatedFee,
                feeAsset: 'USDT (Est)'
            };
        });

        // Final P&L Stats
        const currentPrice = priceMap[symbol] || 0;
        const unrealizedPL = (currentPrice - weightedAvgPrice) * position;
        const totalPL = realizedPL + unrealizedPL;

        results.push({
            symbol,
            trades: enrichedTrades.reverse(), // Newest first
            position,
            averageCost: weightedAvgPrice,
            currentPrice,
            realizedPL,
            unrealizedPL,
            totalPL,
            plPercentage: weightedAvgPrice > 0 ? ((currentPrice - weightedAvgPrice) / weightedAvgPrice) * 100 : 0,
            status: position > 0 ? 'ONGOING' : 'CLOSED'
        });
    }

    return results;
}

module.exports = router;
