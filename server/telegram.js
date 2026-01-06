const TelegramBot = require('node-telegram-bot-api');
const { getTelegramConfig } = require('./database');
const { getOrderBook, getTickerPrice } = require('./binance');
const positionManager = require('./positionManager');

// Store bot instances per user
const botInstances = new Map();
const userIdByChatId = new Map();

// Calculate net inflow for a symbol
async function calculateInflowForSymbol(symbol, userId) {
    try {
        const orderBook = await getOrderBook(symbol, 100, userId);

        const bidVolume = orderBook.bids.reduce((sum, [price, qty]) => {
            return sum + (parseFloat(price) * parseFloat(qty));
        }, 0);

        const askVolume = orderBook.asks.reduce((sum, [price, qty]) => {
            return sum + (parseFloat(price) * parseFloat(qty));
        }, 0);

        const netInflow = bidVolume - askVolume;

        // Get current price
        const ticker = await getTickerPrice();
        const symbolPrice = ticker.find(t => t.symbol === symbol);
        const currentPrice = symbolPrice ? parseFloat(symbolPrice.price) : 0;

        return {
            symbol,
            bidVolume,
            askVolume,
            netInflow,
            currentPrice,
            timestamp: Date.now()
        };
    } catch (error) {
        console.error(`Error calculating inflow for ${symbol}:`, error.message);
        return null;
    }
}

// Get top 5 coins by net inflow
async function getTop5Coins(userId) {
    try {
        const ticker = await getTickerPrice();
        const validQuoteAssets = ['USDT', 'FDUSD'];
        const pairs = ticker
            .filter(t => validQuoteAssets.some(quote => t.symbol.endsWith(quote)))
            .map(t => t.symbol)
            .slice(0, 50); // Check top 50 by volume to avoid timeout

        const inflowPromises = pairs.map(symbol => calculateInflowForSymbol(symbol, userId));
        const results = await Promise.all(inflowPromises);

        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => b.netInflow - a.netInflow);

        return validResults.slice(0, 5);
    } catch (error) {
        console.error('Error getting top 5 coins:', error.message);
        return [];
    }
}

// Initialize Telegram bot for a specific user
async function initBotForUser(userId) {
    const config = getTelegramConfig(userId);
    const token = config.botToken;

    // Check if bot already exists and stop it
    if (botInstances.has(userId)) {
        const oldBot = botInstances.get(userId);
        try {
            await oldBot.stopPolling({ cancel: true });
            console.log(`Stopped existing bot for user ${userId}`);
        } catch (error) {
            console.error(`Error stopping bot for user ${userId}:`, error.message);
        }
        botInstances.delete(userId);
    }

    if (token && token.length > 0) {
        try {
            const bot = new TelegramBot(token, { polling: true });
            botInstances.set(userId, bot);

            // Store userId by chatId for command handling
            if (config.chatId) {
                userIdByChatId.set(config.chatId, userId);
            }

            // Setup command handlers
            setupCommandHandlers(bot, userId);

            console.log(`✅ Telegram bot initialized for user ${userId}`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to initialize Telegram bot for user ${userId}:`, error.message);
            return false;
        }
    }
    return false;
}

// Initialize all bots on startup
async function initAllBots() {
    console.log('🤖 Initializing all Telegram bots...');
    const { getAllUsersWithTelegram } = require('./database');
    const users = getAllUsersWithTelegram();

    let count = 0;
    for (const user of users) {
        const success = await initBotForUser(user.user_id);
        if (success) count++;
    }

    console.log(`✅ initialized ${count} Telegram bots`);
}

// Setup command handlers
function setupCommandHandlers(bot, userId) {
    // /top5 command - Show top 5 coins by net inflow
    bot.onText(/\/top5/, async (msg) => {
        const chatId = msg.chat.id;

        await bot.sendMessage(chatId, '🔍 Scanning top coins... Please wait.');

        try {
            const top5 = await getTop5Coins(userId);

            if (top5.length === 0) {
                await bot.sendMessage(chatId, '❌ No data available at the moment.');
                return;
            }

            let message = '🏆 <b>Top 5 Coins by Net Inflow (Last 5 min)</b>\n\n';

            top5.forEach((coin, index) => {
                const emoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][index];
                message += `${emoji} <b>${coin.symbol}</b>\n`;
                message += `   💰 Price: $${coin.currentPrice.toFixed(4)}\n`;
                message += `   📊 Net Inflow: ${coin.netInflow >= 0 ? '+' : ''}${(coin.netInflow / 1000).toFixed(2)}K USDT\n`;
                message += `   📈 Bid Vol: ${(coin.bidVolume / 1000).toFixed(2)}K\n`;
                message += `   📉 Ask Vol: ${(coin.askVolume / 1000).toFixed(2)}K\n\n`;
            });

            message += `⏰ Updated: ${new Date().toLocaleTimeString()}`;

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } catch (error) {
            await bot.sendMessage(chatId, '❌ Error fetching data. Please try again.');
            console.error('Error in /top5 command:', error);
        }
    });

    // Handle pair queries (e.g., "BTCUSDT", "btcusdt")
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text?.toUpperCase().trim();

        // Skip if it's a command
        if (!text || text.startsWith('/')) return;

        // Check if it's a valid pair format (ends with USDT or FDUSD)
        const validQuoteAssets = ['USDT', 'FDUSD'];
        const isMatched = validQuoteAssets.some(quote => text.endsWith(quote)) && text.length > 5;

        if (isMatched) {
            await bot.sendMessage(chatId, `🔍 Fetching data for ${text}...`);

            try {
                const data = await calculateInflowForSymbol(text, userId);

                if (!data) {
                    await bot.sendMessage(chatId, `❌ Could not fetch data for ${text}. Please check the symbol.`);
                    return;
                }

                const inflowDirection = data.netInflow >= 0 ? '🟢 Buying Pressure' : '🔴 Selling Pressure';

                let message = `📊 <b>${data.symbol} Analysis</b>\n\n`;
                message += `💰 <b>Current Price:</b> $${data.currentPrice.toFixed(4)}\n\n`;
                message += `<b>Net Inflow (Last 5 min):</b>\n`;
                message += `${inflowDirection}\n`;
                message += `${data.netInflow >= 0 ? '+' : ''}${(data.netInflow / 1000).toFixed(2)}K USDT\n\n`;
                message += `📈 <b>Bid Volume:</b> ${(data.bidVolume / 1000).toFixed(2)}K USDT\n`;
                message += `📉 <b>Ask Volume:</b> ${(data.askVolume / 1000).toFixed(2)}K USDT\n\n`;
                message += `⏰ ${new Date().toLocaleTimeString()}`;

                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            } catch (error) {
                await bot.sendMessage(chatId, `❌ Error fetching data for ${text}.`);
                console.error(`Error fetching ${text}:`, error);
            }
        }
    });


    // /currentposition command
    bot.onText(/\/currentposition/, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, '🔄 Fetching your current positions...');

        try {
            // Force update to get latest trades
            const positions = await positionManager.updatePositions(userId);

            if (!positions || positions.length === 0) {
                await bot.sendMessage(chatId, 'Unknown positions or no active positions found.');
                return;
            }

            // Calculate totals
            const totalInvested = positions.reduce((sum, p) => sum + p.invested, 0);
            const totalUnrealizedPL = positions.reduce((sum, p) => sum + p.unrealizedPL, 0);
            const totalPLPercent = totalInvested > 0 ? (totalUnrealizedPL / totalInvested) * 100 : 0;
            const emoji = totalUnrealizedPL >= 0 ? '🟢' : '🔴';

            let message = `📊 <b>Your Current Positions</b>\n\n`;

            positions.forEach(p => {
                const plEmoji = p.unrealizedPL >= 0 ? '🟢' : '🔴';
                const plPrefix = p.unrealizedPL >= 0 ? '+' : '';

                message += `<b>${p.symbol.replace('USDT', '')}</b>: ${p.qty.toFixed(4)}\n`;
                message += `   💰 Entry: $${p.avgPrice.toFixed(4)} | Curr: $${p.currentPrice.toFixed(4)}\n`;
                message += `   ${plEmoji} P&L: ${plPrefix}${p.unrealizedPL.toFixed(2)} USDT (${plPrefix}${p.unrealizedPLPercent.toFixed(2)}%)\n\n`;
            });

            message += `--------------------------------\n`;
            message += `💵 <b>Total Invested:</b> ${totalInvested.toFixed(2)} USDT\n`;
            message += `📈 <b>Total P&L:</b> ${emoji} ${totalUnrealizedPL >= 0 ? '+' : ''}${totalUnrealizedPL.toFixed(2)} USDT (${totalPLPercent.toFixed(2)}%)\n`;

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

        } catch (error) {
            console.error('Error in /currentposition:', error);
            await bot.sendMessage(chatId, '❌ Error fetching positions. Please try again.');
        }
    });

    // /start command
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const welcomeMessage = `
👋 <b>Welcome to Binance Dashboard Bot!</b>

<b>Available Commands:</b>
/top5 - Get top 5 coins by net inflow
/start - Show this help message
/currentposition - Show your current positions

<b>Quick Queries:</b>
Just type any trading pair (e.g., BTCUSDT, ETHUSDT) to get instant analysis!

💡 All data shows net inflow from the last 5 minutes.
        `.trim();

        await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
    });

    // /ping command
    bot.onText(/\/ping/, async (msg) => {
        await bot.sendMessage(msg.chat.id, '🏓 <b>Pong!</b> Bot is online and connected.', { parse_mode: 'HTML' });
    });
}

// Send message to Telegram for a specific user
async function sendMessage(userId, message) {
    let bot = botInstances.get(userId);

    // If bot not found, try to initialize it
    if (!bot) {
        await initBotForUser(userId);
        bot = botInstances.get(userId);
    }

    if (!bot) {
        throw new Error('Telegram bot not configured for this user');
    }

    const config = getTelegramConfig(userId);
    const chatId = config.chatId;

    if (!chatId) {
        throw new Error('Telegram chat ID not configured for this user');
    }

    try {
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log(`📡 [Telegram] Message sent to chatId ${chatId}`);
        return true;
    } catch (error) {
        console.error('Failed to send Telegram message:', error.message);
        throw error;
    }
}

// Send market surge alert for a specific user
async function sendMarketAlert(userId, symbol, inflow, percentChange) {
    const config = getTelegramConfig(userId);
    const chatId = config.chatId;

    if (!chatId) {
        // console.log(`Telegram chat ID not configured for user ${userId}, skipping alert`);
        return false;
    }

    const message = `
🚀 <b>Market Surge Alert!</b>

<b>Symbol:</b> ${symbol}
<b>Net Inflow:</b> ${inflow.toFixed(2)} USDT
<b>Change:</b> ${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}%

High buying pressure detected in the last 5 minutes!
    `.trim();

    try {
        await sendMessage(userId, message);
        console.log(`✅ Sent alert for ${symbol} to user ${userId}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send alert for ${symbol} to user ${userId}:`, error.message);
        return false;
    }
}

module.exports = {
    initBotForUser,
    initAllBots,
    sendMessage,
    sendMarketAlert
};
