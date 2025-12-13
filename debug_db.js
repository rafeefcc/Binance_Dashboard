const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

// Initialize database
const dbPath = path.join(__dirname, 'data', 'users.db');
console.log(`Openinig database at: ${dbPath}`);
const db = new Database(dbPath);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-32bytes';
const ALGORITHM = 'aes-256-cbc';

function decrypt(text) {
    if (!text) return null;
    try {
        const parts = text.split(':');
        console.log(`Decrypting: ${text.substring(0, 20)}... parts: ${parts.length}`);
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = parts[1];
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error("Decryption failed:", e.message);
        return null;
    }
}

// 1. Check Users
const users = db.prepare('SELECT * FROM users').all();
console.log('\n--- Users ---');
users.forEach(u => {
    console.log(`ID: ${u.id}, Email: ${u.email}, Name: ${u.name}`);
});

// 2. Check Settings
const settings = db.prepare('SELECT * FROM user_settings').all();
console.log('\n--- User Settings ---');
settings.forEach(s => {
    console.log(`User ID: ${s.user_id}`);
    console.log(`  Binance Key Encrypted: ${s.binance_api_key ? 'Yes' : 'No'}`);

    if (s.binance_api_key) {
        const apiKey = decrypt(s.binance_api_key);
        console.log(`  Decrypted Key: ${apiKey}`);
    }

    if (s.binance_api_secret) {
        const apiSecret = decrypt(s.binance_api_secret);
        console.log(`  Decrypted Secret: ${apiSecret ? '***' + apiSecret.substring(apiSecret.length - 4) : 'null'}`);
    }
});
