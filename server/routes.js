const express = require('express');
const passport = require('passport');
const { ensureAuthenticated } = require('./auth');
const {
    getAccountInfo,
    getTrades,
    getAllOrders,
    getOpenOrders,
    getTickerPrice,
    getApiKeys,
    getExchangeInfo,
    getUserAssets
} = require('./binance');
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

        const exchangeInfo = await getExchangeInfo();
        const validQuoteAssets = ['USDT', 'FDUSD'];

        const heldAssets = account.balances
            .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
            .map(b => b.asset);

        let symbols = [];
        heldAssets.forEach(asset => {
            // Skip the quote assets themselves (e.g., don't look for USDTUSDT)
            if (validQuoteAssets.includes(asset)) return;

            // Find all symbols where this asset is the base and quote is USDT or FDUSD
            const pairs = exchangeInfo.symbols
                .filter(s => s.baseAsset === asset && validQuoteAssets.includes(s.quoteAsset))
                .map(s => s.symbol);

            symbols.push(...pairs);
        });

        // Also add direct FDUSD/USDT conversion if they have it
        if (heldAssets.includes('FDUSD') && !heldAssets.includes('USDT')) {
            // Check if FDUSDUSDT exists
            if (exchangeInfo.symbols.some(s => s.symbol === 'FDUSDUSDT')) {
                symbols.push('FDUSDUSDT');
            }
        }

        console.log(`[API] Found ${symbols.length} symbols with balance and matching quote pairs:`, symbols);

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
        const tradesWithPL = await calculateProfitLoss(allTrades, req.user.id);

        res.json(tradesWithPL);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

async function calculatePortfolio(userId, period) {
    // Get account info to identify symbols
    console.log(`[Portfolio] Starting calculation for user ${userId}`);
    const account = await getAccountInfo(userId);
    const exchangeInfo = await getExchangeInfo();
    const validQuoteAssets = ['USDT', 'FDUSD'];

    const heldAssets = account.balances
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => b.asset);

    let symbols = [];
    heldAssets.forEach(asset => {
        if (validQuoteAssets.includes(asset)) return;
        const pairs = exchangeInfo.symbols
            .filter(s => s.baseAsset === asset && validQuoteAssets.includes(s.quoteAsset))
            .map(s => s.symbol);
        symbols.push(...pairs);
    });

    const allTrades = [];
    for (const symbol of symbols) {
        try {
            const trades = await getTrades(symbol, 500, userId);
            allTrades.push(...trades.map(t => ({ ...t, symbol })));
        } catch (error) {
            continue;
        }
    }

    console.log(`[Portfolio] Processing ${allTrades.length} total trades across ${symbols.length} symbols`);
    const pnlResults = await calculateProfitLoss(allTrades, userId);
    console.log(`[Portfolio] P&L calculation complete. Found ${pnlResults.length} symbol results`);

    const significantPositions = pnlResults.filter(r => r.position > 0 && (r.position * r.averageCost) >= 1.0);
    const totalInvested = significantPositions.reduce((sum, r) => sum + (r.position * r.averageCost), 0);
    const totalRealized = pnlResults.reduce((sum, r) => sum + r.realizedPL, 0);
    const totalUnrealized = significantPositions.reduce((sum, r) => sum + r.unrealizedPL, 0);
    const totalPL = totalUnrealized;
    const plPercentage = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;

    const userAssets = await getUserAssets(userId);
    const accountInfo = await getAccountInfo(userId);
    const spotBalances = {};
    accountInfo.balances.forEach(b => {
        const val = parseFloat(b.free) + parseFloat(b.locked);
        if (val > 0) spotBalances[b.asset] = val;
    });

    let totalAssetValue = 0;
    const prices = await getTickerPrice();
    const priceMap = {};
    prices.forEach(p => priceMap[p.symbol] = parseFloat(p.price));

    if (userAssets && userAssets.length > 0) {
        userAssets.forEach(asset => {
            const amount = parseFloat(asset.free) + parseFloat(asset.locked) + parseFloat(asset.freeze) + parseFloat(asset.withdrawing);
            if (amount <= 0) return;

            if (['USDT', 'FDUSD', 'USDC'].includes(asset.asset)) {
                totalAssetValue += amount;
            } else {
                const symbol = `${asset.asset}USDT`;
                const price = priceMap[symbol] || 0;
                totalAssetValue += (amount * price);
            }
        });
    }

    let spotValue = 0;
    Object.entries(spotBalances).forEach(([asset, amount]) => {
        if (['USDT', 'FDUSD', 'USDC'].includes(asset)) {
            spotValue += amount;
        } else {
            const symbol = `${asset}USDT`;
            const price = priceMap[symbol] || 0;
            spotValue += (amount * price);
        }
    });

    totalAssetValue = Math.max(totalAssetValue, spotValue);
    console.log(`[Portfolio] Calculated Total Asset Value: ${totalAssetValue}`);

    return {
        totalInvested,
        totalRealized,
        totalPL,
        totalAssetValue,
        plPercentage,
        tradeCount: allTrades.length,
        period
    };
}

// Get portfolio summary
router.get('/api/portfolio', ensureAuthenticated, async (req, res) => {
    try {
        const { period } = req.query; // 24h, 7d, 30d, all
        const data = await calculatePortfolio(req.user.id, period);
        res.json(data);
    } catch (error) {
        console.error('[Portfolio ERROR]:', error);
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

async function calculateProfitLoss(trades, userId = null) {
    if (!trades || trades.length === 0) return [];

    // Group trades by symbol
    const tradesBySymbol = {};
    trades.forEach(trade => {
        if (!tradesBySymbol[trade.symbol]) {
            tradesBySymbol[trade.symbol] = [];
        }
        tradesBySymbol[trade.symbol].push(trade);
    });

    // Get current prices and actual account balances if userId provided
    const [prices, accountInfo] = await Promise.all([
        getTickerPrice(),
        userId ? getAccountInfo(userId) : Promise.resolve(null)
    ]);

    const priceMap = {};
    prices.forEach(p => {
        priceMap[p.symbol] = parseFloat(p.price);
    });

    const balanceMap = {};
    if (accountInfo) {
        accountInfo.balances.forEach(b => {
            balanceMap[b.asset] = parseFloat(b.free) + parseFloat(b.locked);
        });
    }

    // Get exchange info for base assets
    const exchangeInfo = await getExchangeInfo();
    const symbolToBaseAsset = {};
    exchangeInfo.symbols.forEach(s => {
        symbolToBaseAsset[s.symbol] = s.baseAsset;
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
            const estimatedFee = (price * qty) * FLAT_FEE_RATE;
            const isBuyer = trade.isBuyer;
            const isMaker = trade.isMaker;

            let tradePL = 0;
            let netUSDT = 0;
            let netCoin = 0;
            let type = isBuyer ? 'BUY' : 'SELL';

            if (isBuyer) {
                const oldCost = position * weightedAvgPrice;
                const newCost = qty * price;
                const newPos = position + qty;

                if (newPos > 0) {
                    weightedAvgPrice = (oldCost + newCost) / newPos;
                }
                position = newPos;
                netCoin = qty;
                netUSDT = -(qty * price) - estimatedFee;
            } else { // SELL
                const proceeds = qty * price;
                const costBasis = qty * weightedAvgPrice;
                netUSDT = proceeds - estimatedFee;
                netCoin = -qty;
                tradePL = proceeds - costBasis - estimatedFee;
                realizedPL += tradePL;
                position -= qty;

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
                isMaker: isMaker,
                fee: estimatedFee,
                feeAsset: 'USDT (Est)'
            };
        });

        // RECONCILIATION WITH WALLET
        const baseAsset = symbolToBaseAsset[symbol];
        if (userId && balanceMap[baseAsset] !== undefined) {
            const actualBalance = balanceMap[baseAsset];

            // If actual balance is near zero, force position to 0 to prevent "stuck" UI entries
            if (actualBalance < 0.00001) {
                if (position > 0) {
                    console.log(`[Sync] Correcting ${symbol}: trade-calc ${position} -> wallet ${actualBalance} (Stuck Position Fixed)`);
                    position = 0;
                    weightedAvgPrice = 0;
                }
            } else if (Math.abs(position - actualBalance) / Math.max(position, actualBalance) > 0.05) {
                // If discrepancy > 5%, trust the wallet balance for quantity
                // but keep the weighted average price from trades as it's our best guess
                console.log(`[Sync] Adjusted ${symbol} qty: ${position.toFixed(4)} -> ${actualBalance.toFixed(4)}`);
                position = actualBalance;
            }
        }

        // Filter out positions < $1 (Dust)
        const investedValue = position * weightedAvgPrice;
        if (position > 0 && investedValue < 1.0) {
            // Keep the trades in history but mark position as 0 for "Open Positions" view
            // However, it's better to just set status CLOSED if it's dust
            // or let the frontend filter it. The user asked "not to show in frontend under open positions".
            // Setting position to 0 here would hide it from the open positions logic.
            position = 0;
            weightedAvgPrice = 0;
        }

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
            plPercentage: (weightedAvgPrice > 0 && position > 0) ? ((currentPrice - weightedAvgPrice) / weightedAvgPrice) * 100 : 0,
            status: position > 0 ? 'ONGOING' : 'CLOSED'
        });
    }

    return results;
}

module.exports = router;
