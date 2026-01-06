const { getTrades, getTickerPrice } = require('./binance');
const { getTelegramConfig } = require('./database');
// const { sendMessage } = require('./telegram'); // Moved to lazy load to avoid circular dependency

// Store active positions and their alert states
// Structure: Map<userId, Map<symbol, { positionData, alertState }>>
const userPositions = new Map();

// Alert thresholds
const PRICE_CHANGE_THRESHOLD = 0.5; // 0.5%

class PositionManager {
    constructor() {
        this.isUpdating = false;
    }

    // Initialize or update positions for a user
    async updatePositions(userId) {
        try {
            // Fetch account info to find active assets
            const { getAccountInfo, getExchangeInfo } = require('./binance');
            const accountInfo = await getAccountInfo(userId);
            const exchangeInfo = await getExchangeInfo();
            const validQuoteAssets = ['USDT', 'FDUSD'];

            const balances = accountInfo.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
            const userSymbols = new Map(); // symbol -> position details

            for (const bal of balances) {
                if (validQuoteAssets.includes(bal.asset)) continue;

                // Find all symbols where this asset is the base and quote is USDT or FDUSD
                const pairs = exchangeInfo.symbols
                    .filter(s => s.baseAsset === bal.asset && validQuoteAssets.includes(s.quoteAsset))
                    .map(s => s.symbol);

                for (const symbol of pairs) {
                    try {
                        const trades = await getTrades(symbol, 500, userId);
                        if (!trades || trades.length === 0) continue;

                        // Calculate WACB (same logic as routes.js)
                        let totalQty = 0;
                        let totalCost = 0;
                        let realizedPL = 0;

                        for (const trade of trades) {
                            const price = parseFloat(trade.price);
                            const qty = parseFloat(trade.qty);
                            const fee = parseFloat(trade.commission || 0); // Simplified fee
                            const isBuyer = trade.isBuyer;

                            if (isBuyer) {
                                totalQty += qty;
                                totalCost += (price * qty);
                            } else {
                                // Sell
                                if (totalQty > 0) {
                                    const avgBuyPrice = totalCost / totalQty;
                                    const costBasis = avgBuyPrice * qty;
                                    const sellValue = price * qty;
                                    realizedPL += (sellValue - costBasis);

                                    totalQty -= qty;
                                    totalCost -= costBasis; // Reduce cost basis proportionally
                                }
                            }
                        }

                        // Only track active positions
                        if (totalQty > 0.00001) { // Ignore dust
                            const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;

                            userSymbols.set(symbol, {
                                symbol,
                                qty: totalQty,
                                avgPrice: avgPrice,
                                invested: totalCost,
                                currentPrice: 0, // Will be updated by live feed
                                unrealizedPL: 0,
                                unrealizedPLPercent: 0,
                                timestamp: Date.now()
                            });
                        }

                    } catch (e) {
                        // Ignore symbol errors
                    }
                }
            }

            // Fetch current prices to ensure data is fresh immediately
            try {
                const prices = await getTickerPrice();
                const priceMap = new Map();
                prices.forEach(p => priceMap.set(p.symbol, parseFloat(p.price)));

                // Update current prices and P&L for all calculated positions
                userSymbols.forEach((pos, symbol) => {
                    if (priceMap.has(symbol)) {
                        pos.currentPrice = priceMap.get(symbol);
                        const currentValue = pos.qty * pos.currentPrice;
                        pos.unrealizedPL = currentValue - pos.invested;
                        pos.unrealizedPLPercent = pos.invested > 0 ? ((currentValue - pos.invested) / pos.invested) * 100 : 0;
                    }
                });
            } catch (err) {
                console.error('Error fetching prices in updatePositions:', err.message);
            }

            // Update cache
            if (!userPositions.has(userId)) {
                userPositions.set(userId, new Map());
            }

            const currentCache = userPositions.get(userId);

            // Merge new data, preserving alert state if position still exists
            userSymbols.forEach((newData, symbol) => {
                const oldData = currentCache.get(symbol);
                const alertState = oldData ? oldData.alertState : {
                    lastAlertPrice: 0,
                    lastAlertPLState: null // 'positive' or 'negative'
                };

                currentCache.set(symbol, {
                    ...newData,
                    alertState
                });
            });

            // Remove closed positions
            currentCache.forEach((val, key) => {
                if (!userSymbols.has(key)) {
                    currentCache.delete(key);
                }
            });

            return Array.from(userSymbols.values());

        } catch (error) {
            console.error(`Error updating positions for user ${userId}:`, error.message);
            return [];
        }
    }

    // Process live ticker updates
    onTickerUpdate(tickers) {
        // tickers is array of { s: symbol, c: price, ... }
        const priceMap = new Map();
        tickers.forEach(t => priceMap.set(t.s, parseFloat(t.c)));

        userPositions.forEach((positionsMap, userId) => {
            positionsMap.forEach((pos, symbol) => {
                if (priceMap.has(symbol)) {
                    const currentPrice = priceMap.get(symbol);

                    // Update position metrics
                    pos.currentPrice = currentPrice;
                    const currentValue = pos.qty * currentPrice;
                    pos.unrealizedPL = currentValue - pos.invested;
                    pos.unrealizedPLPercent = ((currentValue - pos.invested) / pos.invested) * 100;

                    // CHECK ALERTS
                    this.checkAlerts(userId, pos);
                }
            });
        });

        // Debug log (small chance to avoid spam)
        if (Math.random() < 0.01) console.log(`📡 [PositionManager] Processing ${tickers.length} tickers for ${userPositions.size} users`);
    }

    async checkAlerts(userId, pos) {
        const { symbol, unrealizedPL, unrealizedPLPercent, currentPrice, alertState } = pos;

        // Initialize alert state if needed
        if (!alertState.lastAlertPrice) {
            alertState.lastAlertPrice = currentPrice;
            alertState.lastAlertPLState = unrealizedPL >= 0 ? 'positive' : 'negative';
            return;
        }

        let shouldAlert = false;
        let alertType = '';

        // 1. Check P&L Flip
        const currentPLState = unrealizedPL >= 0 ? 'positive' : 'negative';
        if (currentPLState !== alertState.lastAlertPLState) {
            shouldAlert = true;
            alertType = `PxL Flip: Now ${currentPLState.toUpperCase()} ${currentPLState === 'positive' ? '🟢' : '🔴'}`;
            alertState.lastAlertPLState = currentPLState;
        }

        // 2. Check Price Change > 0.5%
        const priceChangePercent = Math.abs((currentPrice - alertState.lastAlertPrice) / alertState.lastAlertPrice) * 100;
        if (priceChangePercent >= PRICE_CHANGE_THRESHOLD) {
            shouldAlert = true;
            const direction = currentPrice > alertState.lastAlertPrice ? 'UP ⬆️' : 'DOWN ⬇️';
            alertType = alertType ? `${alertType} & Price Move` : `Price Moved ${direction} ${priceChangePercent.toFixed(2)}%`;
            alertState.lastAlertPrice = currentPrice;
        }

        if (shouldAlert) {
            await this.sendPositionAlert(userId, pos, alertType);
        }
    }

    async sendPositionAlert(userId, pos, reason) {
        const { sendMessage } = require('./telegram');
        const emoji = pos.unrealizedPL >= 0 ? '🟢' : '🔴';
        const plPrefix = pos.unrealizedPL >= 0 ? '+' : '';

        const message = `
🔔 <b>Position Alert: ${pos.symbol}</b>

<b>Reason:</b> ${reason}

💰 <b>Current Price:</b> $${pos.currentPrice.toFixed(4)}
📊 <b>P&L:</b> ${emoji} ${plPrefix}${pos.unrealizedPL.toFixed(2)} USDT (${plPrefix}${pos.unrealizedPLPercent.toFixed(2)}%)
📦 <b>Size:</b> ${pos.qty.toFixed(4)} ${pos.symbol.replace('USDT', '')}
💵 <b>Invested:</b> ${pos.invested.toFixed(2)} USDT

Using live data.
        `.trim();

        try {
            await sendMessage(userId, message);
        } catch (error) {
            // Ignore if user hasn't started bot
        }
    }

    // Public getter for specific user
    getCachedPositions(userId) {
        if (!userPositions.has(userId)) return [];
        return Array.from(userPositions.get(userId).values());
    }
}

const positionManager = new PositionManager();

// Export singleton
module.exports = positionManager;
