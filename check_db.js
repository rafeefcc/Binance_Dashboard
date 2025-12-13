const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'users.db');
const db = new Database(dbPath);

console.log('\n=== User Settings ===');
const settings = db.prepare('SELECT user_id, telegram_chat_id, CASE WHEN telegram_bot_token IS NOT NULL THEN \'[ENCRYPTED]\' ELSE NULL END as telegram_bot_token, CASE WHEN binance_api_key IS NOT NULL THEN \'[ENCRYPTED]\' ELSE NULL END as binance_api_key FROM user_settings').all();
console.table(settings);

console.log('\n=== Users ===');
const users = db.prepare('SELECT id, email, name FROM users').all();
console.table(users);

db.close();
