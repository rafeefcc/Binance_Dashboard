const crypto = require('crypto');
const axios = require('axios');
const { getBinanceApiKeys } = require('./database');

const BINANCE_BASE_URL = 'https://api.binance.com';

// Get API keys for a specific user from database
function getApiKeys(userId) {
    if (!userId) {
        return { apiKey: null, apiSecret: null };
    }
    return getBinanceApiKeys(userId);
}

// Generate HMAC SHA256 signature
function generateSignature(queryString, apiSecret) {
    return crypto
        .createHmac('sha256', apiSecret)
        .update(queryString)
        .digest('hex');
}

// Make authenticated request to Binance API
async function authenticatedRequest(endpoint, params = {}, userId) {
    const { apiKey, apiSecret } = getApiKeys(userId);

    if (!apiKey || !apiSecret) {
        throw new Error('Binance API keys not configured. Please configure them in Settings.');
    }

    // Add timestamp
    params.timestamp = Date.now();

    // Build query string
    const queryString = Object.keys(params)
        .map(key => `${key}=${params[key]}`)
        .join('&');

    // Generate signature
    const signature = generateSignature(queryString, apiSecret);

    // Make request
    const url = `${BINANCE_BASE_URL}${endpoint}?${queryString}&signature=${signature}`;

    try {
        console.log(`[Binance API] Requesting ${endpoint} for user ${userId}`);
        const response = await axios.get(url, {
            headers: {
                'X-MBX-APIKEY': apiKey
            }
        });
        return response.data;
    } catch (error) {
        console.error(`[Binance API Error] ${endpoint}:`, error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            throw new Error(`Binance API Error: ${error.response.data.msg || error.response.statusText}`);
        }
        throw error;
    }
}

// Make public request to Binance API
async function publicRequest(endpoint, params = {}) {
    const queryString = Object.keys(params)
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const url = `${BINANCE_BASE_URL}${endpoint}${queryString ? '?' + queryString : ''}`;

    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        if (error.response) {
            throw new Error(`Binance API Error: ${error.response.data.msg || error.response.statusText}`);
        }
        throw error;
    }
}

// Get account information
async function getAccountInfo(userId) {
    return await authenticatedRequest('/api/v3/account', {}, userId);
}

// Get all trades for a symbol
async function getTrades(symbol, limit = 500, userId) {
    return await authenticatedRequest('/api/v3/myTrades', { symbol, limit }, userId);
}

// Get all orders for a symbol
async function getAllOrders(symbol, limit = 500, userId) {
    return await authenticatedRequest('/api/v3/allOrders', { symbol, limit }, userId);
}

// Get open orders
async function getOpenOrders(symbol = null, userId) {
    const params = symbol ? { symbol } : {};
    return await authenticatedRequest('/api/v3/openOrders', params, userId);
}

// Get ticker price
async function getTickerPrice(symbol = null) {
    const params = symbol ? { symbol } : {};
    return await publicRequest('/api/v3/ticker/price', params);
}

// Get 24hr ticker stats
async function get24hrTicker(symbol = null) {
    const params = symbol ? { symbol } : {};
    return await publicRequest('/api/v3/ticker/24hr', params);
}

// Get order book depth
async function getOrderBook(symbol, limit = 100) {
    return await publicRequest('/api/v3/depth', { symbol, limit });
}

// Get exchange info
async function getExchangeInfo() {
    return await publicRequest('/api/v3/exchangeInfo');
}

async function getKlines(symbol, interval, limit = 100) {
    return await publicRequest('/api/v3/klines', { symbol, interval, limit });
}

// Get user assets (including Funding, Spot, etc. across the account)
async function getUserAssets(userId) {
    try {
        // This is a POST request in Binance API for User Asset
        const { apiKey, apiSecret } = getApiKeys(userId);
        if (!apiKey || !apiSecret) return [];

        const params = { timestamp: Date.now() };
        const queryString = `timestamp=${params.timestamp}`;
        const signature = generateSignature(queryString, apiSecret);

        const url = `${BINANCE_BASE_URL}/sapi/v3/asset/getUserAsset?${queryString}&signature=${signature}`;

        const response = await axios.post(url, {}, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        return response.data;
    } catch (error) {
        console.error('[Binance API] Error fetching User Assets:', error.message);
        return [];
    }
}

module.exports = {
    getAccountInfo,
    getTrades,
    getAllOrders,
    getOpenOrders,
    getTickerPrice,
    get24hrTicker,
    getOrderBook,
    getExchangeInfo,
    getApiKeys,
    getKlines,
    getUserAssets,
    publicRequest
};
