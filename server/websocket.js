const WebSocket = require('ws');
const axios = require('axios');

let wss = null;
const binanceWsUrl = 'wss://stream.binance.com:9443/ws';
let binanceWs = null;
const subscribedSymbols = new Set();

// Initialize WebSocket server
function initializeWebSocket(server) {
    wss = new WebSocket.Server({ server, path: '/ws' });

    wss.on('connection', (ws) => {
        console.log('✅ Client connected to WebSocket');

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                handleClientMessage(ws, data);
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        });

        ws.on('close', () => {
            console.log('❌ Client disconnected from WebSocket');
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    });

    // Connect to Binance WebSocket
    connectToBinance();

    console.log('✅ WebSocket server initialized');
}

// Connect to Binance WebSocket streams
function connectToBinance() {
    if (binanceWs) {
        binanceWs.close();
    }

    // Subscribe to all USDT pairs ticker stream
    const stream = '!ticker@arr';
    binanceWs = new WebSocket(`${binanceWsUrl}/${stream}`);

    binanceWs.on('open', () => {
        console.log('✅ Connected to Binance WebSocket');
    });

    const positionManager = require('./positionManager');

    // ... (existing code)

    binanceWs.on('message', (data) => {
        try {
            const tickers = JSON.parse(data);
            const usdtTickers = tickers.filter(t => t.s.endsWith('USDT'));

            // Update Position Manager with live prices
            positionManager.onTickerUpdate(usdtTickers);

            // Broadcast to all connected clients
            if (wss) {
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'ticker',
                            data: usdtTickers
                        }));
                    }
                });
            }
        } catch (error) {
            console.error('Binance WebSocket message error:', error);
        }
    });

    binanceWs.on('error', (error) => {
        if (error.code === 'ECONNRESET') {
            console.log('⚠️ Binance WebSocket connection reset (normal behavior, reconnecting...)');
        } else {
            console.error('Binance WebSocket error:', error.message);
        }
    });

    binanceWs.on('close', () => {
        console.log('❌ Disconnected from Binance WebSocket, reconnecting...');
        setTimeout(connectToBinance, 5000);
    });
}

// Handle client messages
function handleClientMessage(ws, data) {
    switch (data.type) {
        case 'subscribe':
            if (data.symbol) {
                subscribedSymbols.add(data.symbol);
                ws.send(JSON.stringify({ type: 'subscribed', symbol: data.symbol }));
            }
            break;

        case 'unsubscribe':
            if (data.symbol) {
                subscribedSymbols.delete(data.symbol);
                ws.send(JSON.stringify({ type: 'unsubscribed', symbol: data.symbol }));
            }
            break;

        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
    }
}

// Broadcast message to all clients
function broadcast(message) {
    if (wss) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

// Broadcast market scan results
function broadcastMarketScan(results) {
    broadcast({
        type: 'marketScan',
        data: results,
        timestamp: Date.now()
    });
}

module.exports = {
    initializeWebSocket,
    broadcast,
    broadcastMarketScan
};
