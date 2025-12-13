# Binance Trading Dashboard

A comprehensive trading dashboard for Binance with real-time updates, profit/loss tracking, and market monitoring.

## Features

- 🔐 **Google OAuth Authentication** - Secure login with Google
- 📊 **Trade Dashboard** - View all trades with P&L calculations
- 💰 **Portfolio Analytics** - Total invested, profit/loss by time period
- 🔍 **Market Scanner** - Monitor coins with highest inflow every 5 minutes
- 📱 **Telegram Notifications** - Get alerts for market surges
- ⚙️ **Dashboard Configuration** - Configure API keys through the UI
- 🔴 **Live Updates** - WebSocket for real-time price updates

## Setup Instructions

### 1. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable **Google+ API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure OAuth consent screen
6. Create OAuth Client ID:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:5008/auth/google/callback`
7. Copy **Client ID** and **Client Secret**

### 2. Telegram Bot Setup (Optional)

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow instructions
3. Copy the **Bot Token**
4. To get your Chat ID:
   - Send a message to your bot
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find your `chat.id` in the response

### 3. Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env file and add your Google OAuth credentials
# GOOGLE_CLIENT_ID=your-client-id
# GOOGLE_CLIENT_SECRET=your-client-secret
```

### 4. Running the Application

```bash
# Start the server
npm start

# Or use nodemon for development
npm run dev
```

Visit `http://localhost:5008` in your browser.

### 5. First-Time Configuration

1. **Login** with your Google account
2. Navigate to **Settings** tab
3. Enter your **Binance API Key** and **Secret**
4. (Optional) Enter **Telegram Bot Token**
5. Click **Save Configuration**
6. Go to **Market Scanner** tab to configure Telegram Chat ID

## Usage

### Dashboard Tab
- View all your trades with profit/loss calculations
- Filter by time period (24h, 7d, 30d, All time)
- See ongoing trades with unrealized P&L
- Real-time price updates via WebSocket

### Market Scanner Tab
- Monitor all USDT pairs for highest inflow
- Updates every 5 minutes
- Configure Telegram Chat ID for notifications
- Enable/disable alerts

### Settings Tab
- Configure Binance API credentials
- Configure Telegram bot token
- All settings saved to `.env` file

## API Endpoints

- `GET /auth/google` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/logout` - Logout
- `GET /api/account` - Get account info (protected)
- `GET /api/trades/all` - Get all trades with P&L (protected)
- `GET /api/portfolio` - Get portfolio metrics (protected)
- `GET /api/settings` - Get current settings (protected)
- `POST /api/settings` - Save settings (protected)

## Security Notes

- Never commit your `.env` file to version control
- Keep your API keys secure
- Use API keys with appropriate permissions (read-only recommended)
- The dashboard uses session-based authentication

## Technologies

- **Backend**: Node.js, Express, Passport.js
- **Frontend**: Vanilla JavaScript, Modern CSS
- **Real-time**: WebSocket (ws)
- **Authentication**: Google OAuth 2.0
- **API**: Binance REST API, Binance WebSocket Streams

## License

MIT
