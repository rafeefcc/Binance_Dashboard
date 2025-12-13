const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

// Initialize database
const dbPath = path.join(__dirname, '..', 'data', 'users.db');
const db = new Database(dbPath);

// Encryption key (in production, use environment variable)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-32bytes';
const ALGORITHM = 'aes-256-cbc';

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        picture TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        binance_api_key TEXT,
        binance_api_secret TEXT,
        telegram_bot_token TEXT,
        telegram_chat_id TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
`);

// Encryption functions
function encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!text) return null;
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// User operations
function createOrUpdateUser(userData) {
    const stmt = db.prepare(`
        INSERT INTO users (id, email, name, picture)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            name = excluded.name,
            picture = excluded.picture,
            updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(userData.id, userData.email, userData.name, userData.picture);
    return getUserById(userData.id);
}

function getUserById(userId) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(userId);
}

function getUserByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email);
}

// Settings operations
function getUserSettings(userId) {
    const stmt = db.prepare('SELECT * FROM user_settings WHERE user_id = ?');
    const settings = stmt.get(userId);

    if (!settings) {
        return {
            hasBinanceKeys: false,
            hasTelegramToken: false,
            telegramChatId: ''
        };
    }

    return {
        hasBinanceKeys: !!(settings.binance_api_key && settings.binance_api_secret),
        hasTelegramToken: !!settings.telegram_bot_token,
        telegramChatId: settings.telegram_chat_id || ''
    };
}

function saveUserSettings(userId, settings) {
    const encryptedSettings = {
        binance_api_key: settings.binanceApiKey ? encrypt(settings.binanceApiKey) : null,
        binance_api_secret: settings.binanceApiSecret ? encrypt(settings.binanceApiSecret) : null,
        telegram_bot_token: settings.telegramBotToken ? encrypt(settings.telegramBotToken) : null,
        telegram_chat_id: settings.telegramChatId || null
    };

    const stmt = db.prepare(`
        INSERT INTO user_settings (user_id, binance_api_key, binance_api_secret, telegram_bot_token, telegram_chat_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            binance_api_key = COALESCE(excluded.binance_api_key, binance_api_key),
            binance_api_secret = COALESCE(excluded.binance_api_secret, binance_api_secret),
            telegram_bot_token = COALESCE(excluded.telegram_bot_token, telegram_bot_token),
            telegram_chat_id = COALESCE(excluded.telegram_chat_id, telegram_chat_id),
            updated_at = CURRENT_TIMESTAMP
    `);

    console.log(`[Database] Saving settings for user ${userId}`);
    stmt.run(
        userId,
        encryptedSettings.binance_api_key,
        encryptedSettings.binance_api_secret,
        encryptedSettings.telegram_bot_token,
        encryptedSettings.telegram_chat_id
    );
}

function getBinanceApiKeys(userId) {
    const stmt = db.prepare('SELECT binance_api_key, binance_api_secret FROM user_settings WHERE user_id = ?');
    const settings = stmt.get(userId);

    if (!settings || !settings.binance_api_key || !settings.binance_api_secret) {
        console.log(`[Database] No API keys found for user ${userId}`);
        return { apiKey: null, apiSecret: null };
    }

    try {
        const apiKey = decrypt(settings.binance_api_key);
        const apiSecret = decrypt(settings.binance_api_secret);
        console.log(`[Database] Retrieved API keys for user ${userId} (Key starts with: ${apiKey ? apiKey.substring(0, 4) : 'null'})`);
        return { apiKey, apiSecret };
    } catch (error) {
        console.error(`[Database] Error decrypting keys for user ${userId}:`, error.message);
        return { apiKey: null, apiSecret: null };
    }
}

function getTelegramConfig(userId) {
    const stmt = db.prepare('SELECT telegram_bot_token, telegram_chat_id FROM user_settings WHERE user_id = ?');
    const settings = stmt.get(userId);

    if (!settings) {
        return { botToken: null, chatId: null };
    }

    return {
        botToken: settings.telegram_bot_token ? decrypt(settings.telegram_bot_token) : null,
        chatId: settings.telegram_chat_id
    };
}

function getAllUsersWithTelegram() {
    // Select users who have a telegram bot token (encrypted string is present)
    const stmt = db.prepare("SELECT user_id FROM user_settings WHERE telegram_bot_token IS NOT NULL AND telegram_bot_token != ''");
    return stmt.all();
}

module.exports = {
    createOrUpdateUser,
    getUserById,
    getUserByEmail,
    getUserSettings,
    saveUserSettings,
    getBinanceApiKeys,
    getTelegramConfig,
    getAllUsersWithTelegram
};
