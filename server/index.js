require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const path = require('path');
const http = require('http');

const { setupAuth } = require('./auth');
const routes = require('./routes');
const { initializeWebSocket } = require('./websocket');
const { startPeriodicScan } = require('./marketScanner');
const { initAllBots } = require('./telegram');

const app = express();
const PORT = process.env.PORT || 5008;

// Middleware
app.use(cors({
    origin: `http://localhost:${PORT}`,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-super-secret-session-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());
setupAuth();

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/', routes);

// Serve index.html for authenticated users, login.html for others
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
    }
});

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket
initializeWebSocket(server);

// Start market scanner (every 5 minutes)
startPeriodicScan(5);

// Initialize all Telegram bots
initAllBots();

// Import Position Manager and periodic refresher
const positionManager = require('./positionManager');
const { getAllUsersWithTelegram } = require('./database');

// Periodically refresh user positions to ensure alerts are based on recent trades (Every 5 minutes)
// Live price updates happen via WebSocket, but position sizes need re-fetching.
setInterval(async () => {
    try {
        const users = getAllUsersWithTelegram();
        for (const user of users) {
            await positionManager.updatePositions(user.user_id);
        }
        console.log('🔄 Refreshed user positions for alerts');
    } catch (error) {
        console.error('Error refreshing positions:', error);
    }
}, 5 * 60 * 1000); // 5 minutes

// Initial refresh on startup
setTimeout(async () => {
    try {
        const users = getAllUsersWithTelegram();
        for (const user of users) {
            await positionManager.updatePositions(user.user_id);
        }
    } catch (error) {
        console.error('Error initial refreshing positions:', error);
    }
}, 5000);

// Start server
server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║                                                        ║');
    console.log('║     🚀 Binance Trading Dashboard                      ║');
    console.log('║                                                        ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`✅ WebSocket server ready on ws://localhost:${PORT}/ws`);
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Open http://localhost:${PORT} in your browser');
    console.log('   2. Login with Google');
    console.log('   3. Configure your Binance API keys in Settings');
    console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
