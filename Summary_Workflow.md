  Motive and Purpose

  The primary motive behind this project is to provide a personal, all-in-one dashboard for Binance traders who want to go beyond the standard exchange interface. The purpose is to offer
  a consolidated view of trading activity, making it easier to analyze performance, identify trends, and react to market changes. By combining trade history, P&L analysis, and market
  scanning, the application empowers users to make more informed decisions.

  Features

   * Google OAuth Authentication: Secure and simple login using Google accounts.
   * Trade Dashboard: A comprehensive view of all trades with detailed P&L calculations for both open and closed positions.
   * Portfolio Analytics: Key metrics such as total invested capital, overall profit/loss, and trade volume, with filters for different time periods.
   * Market Scanner: An automated tool that scans for coins with the highest trading inflow every 5 minutes, helping to identify potential trading opportunities.
   * Telegram Notifications: The ability to receive real-time alerts via Telegram when the market scanner detects a significant surge in a coin's inflow.
   * Live Updates: Real-time price updates are pushed to the dashboard using WebSockets, ensuring the data is always current.
   * Secure Configuration: A user-friendly interface for configuring Binance API keys and Telegram bot tokens, with sensitive data being encrypted before storage.

  Technology Stack

   * Backend:
       * Environment: Node.js
       * Framework: Express.js
       * Authentication: Passport.js for handling Google OAuth 2.0.
       * Database: better-sqlite3 for a lightweight, local SQLite database.
       * Real-time Communication: ws library for WebSocket-based live updates.
       * API Interaction: axios for communicating with the Binance REST API.
       * Notifications: node-telegram-bot-api for sending Telegram messages.
   * Frontend:
       * Core Technologies: Vanilla JavaScript, HTML, and CSS.
       * Simplicity: The frontend is intentionally kept simple and does not use a major framework like React, Angular, or Vue, which makes it lightweight and easy to understand.