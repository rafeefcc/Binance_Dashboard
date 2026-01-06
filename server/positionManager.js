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

            const balanceMap = new Map();
            accountInfo.balances.forEach(b => {
                const total = parseFloat(b.free) + parseFloat(b.locked);
                if (total > 0) balanceMap.set(b.asset, total);
            });

            const userSymbols = new Map();

            // Asset -> Symbols mapping
            const assetToSymbols = new Map();
            exchangeInfo.symbols.forEach(s => {
                if (validQuoteAssets.includes(s.quoteAsset)) {
                    if (!assetToSymbols.has(s.baseAsset)) assetToSymbols.set(s.baseAsset, []);
                    assetToSymbols.get(s.baseAsset).push(s.symbol);
                }
            });

            for (const [asset, actualBalance] of balanceMap.entries()) {
                if (validQuoteAssets.includes(asset)) continue;

                const pairs = assetToSymbols.get(asset) || [];
                for (const symbol of pairs) {
                    try {
                        const trades = await getTrades(symbol, 500, userId);
                        if (!trades || trades.length === 0) {
                            // If we have balance but no recent trades, we might still want to track it
                            // but for P&L we need trades. For now, skip if no trades found in last 500.
                            continue;
                        }

                        let totalQty = 0;
                        let totalCost = 0;

                        for (const trade of trades) {
                            const price = parseFloat(trade.price);
                            const qty = parseFloat(trade.qty);
                            if (trade.isBuyer) {
                                totalQty += qty;
                                totalCost += (price * qty);
                            } else {
                                if (totalQty > 0) {
                                    const avgBuyPrice = totalCost / totalQty;
                                    totalQty -= qty;
                                    totalCost -= (avgBuyPrice * qty);
                                }
                            }
                        }

                        // RECONCILIATION
                        let finalQty = totalQty;
                        if (actualBalance < 0.00001) {
                            finalQty = 0; // Force close if wallet is empty
                        } else if (Math.abs(totalQty - actualBalance) / actualBalance > 0.05) {
                            finalQty = actualBalance; // Trust wallet if > 5% diff
                        }

                        if (finalQty > 0.00001) {
                            const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
                            const investedValue = finalQty * avgPrice;

                            // Only track if investment is at least $1
                            if (investedValue >= 1.0) {
                                userSymbols.set(symbol, {
                                    symbol,
                                    qty: finalQty,
                                    avgPrice: avgPrice,
                                    invested: investedValue,
                                    currentPrice: 0,
                                    unrealizedPL: 0,
                                    unrealizedPLPercent: 0,
                                    timestamp: Date.now()
                                });
                            }
                        }
                    } catch (e) { /* ignore */ }
                }
            }

            // Fetch current prices to ensure data is fresh immediately
            try {
                const prices = await getTickerPrice();
                const priceMap = new Map();
                prices.forEach(p => priceMap.set(p.symbol, parseFloat(p.price)));

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

            userSymbols.forEach((newData, symbol) => {
                const oldData = currentCache.get(symbol);
                const alertState = oldData ? oldData.alertState : {
                    lastAlertPrice: 0,
                    lastAlertPLState: null
                };

                currentCache.set(symbol, {
                    ...newData,
                    alertState
                });
            });

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
