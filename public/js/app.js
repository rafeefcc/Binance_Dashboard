// Main application state
let currentPeriod = 'all';
let tradesData = [];
let portfolioData = {};
let priceUpdates = new Map();
let ws = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupFilters();
    setupRefresh();
    setupSorting();
    setupExport();
    setupPairSummary();
    // Data loading moved to auth success
});

// Exposed function to start the dashboard (called by auth.js)
window.startDashboard = function () {
    // Show dashboard
    const container = document.getElementById('appContainer');
    if (container) container.style.display = 'grid';

    // Start connections and load data
    connectWebSocket();
    loadDashboardData();
}

// Setup tab switching
function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;

            // Update active states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            button.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');
        });
    });
}

// Setup time period filters
function setupFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn');

    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            const period = button.dataset.period;
            currentPeriod = period;

            // Update active state
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Reload data with new period
            loadPortfolioData();
        });
    });
}

// Setup refresh button
function setupRefresh() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadDashboardData();
        });
    }
}

// Load all dashboard data
async function loadDashboardData() {
    await Promise.all([
        loadTradesData(),
        loadPortfolioData()
    ]);
}

// Load trades data
async function loadTradesData() {
    try {
        const response = await fetch('/api/trades/all', {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 500) {
                const error = await response.json();
                if (error.error.includes('not configured')) {
                    showConfigurationMessage();
                    return;
                }
            }
            throw new Error('Failed to load trades');
        }

        tradesData = await response.json();
        // Update all views
        displayOpenPositions();
        displayPairSummary();
        displayTradeHistory();
    } catch (error) {
        console.error('Failed to load trades:', error);
        // Error handling for both tables
        const openBody = document.getElementById('tradesTableBody');
        const historyBody = document.getElementById('historyTableBody');
        const errorMsg = '<tr><td colspan="9" class="loading-cell">Failed to load trades. Please check your configuration.</td></tr>';

        if (openBody) openBody.innerHTML = errorMsg;
        if (historyBody) historyBody.innerHTML = errorMsg;
    }
}

// Load portfolio data
async function loadPortfolioData() {
    try {
        const response = await fetch(`/api/portfolio?period=${currentPeriod}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to load portfolio');
        }

        portfolioData = await response.json();
        displayPortfolioMetrics();
    } catch (error) {
        console.error('Failed to load portfolio:', error);
    }
}

// Display Open Positions (Main Dashboard)
function displayOpenPositions() {
    const tbody = document.getElementById('tradesTableBody');
    if (!tbody) return;

    // Filter for open positions only
    const openPositions = tradesData.filter(t => t.position > 0);

    if (openPositions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">No open positions.</td></tr>';
        return;
    }

    tbody.innerHTML = openPositions.map(trade => {
        const currentPrice = priceUpdates.get(trade.symbol) || trade.currentPrice;
        // Recalculate Unrealized P&L with live price
        const unrealizedPL = trade.position * (currentPrice - trade.averageCost);
        // We only show Unrealized P&L for ongoing trades as requested
        // Total P&L is mostly Unrealized for open positions (+ any realized from partial sells if we tracked that mixed state, but for simplicty we focus on open)
        const totalPL = unrealizedPL; // Simplified for display focus

        const plPercentage = trade.averageCost > 0 ? (unrealizedPL / (trade.position * trade.averageCost)) * 100 : 0;

        const plClass = unrealizedPL >= 0 ? 'pl-positive' : 'pl-negative';
        const statusClass = 'ongoing';
        const investedAmount = trade.position * trade.averageCost;

        return `
            <tr>
                <td><strong>${trade.symbol}</strong></td>
                <td>${trade.position.toFixed(8)}</td>
                <td>$${formatNumber(investedAmount)}</td>
                <td>$${formatNumber(trade.averageCost)}</td>
                <td>$${formatNumber(currentPrice)}</td>
                <td>-</td> <!-- Hide Realized P&L in this view -->
                <td class="${plClass}">
                    $${formatNumber(unrealizedPL)}
                </td>
                <td class="${plClass}">
                    $${formatNumber(totalPL)}
                </td>
                <td class="${plClass}">
                    ${plPercentage >= 0 ? '+' : ''}${formatNumber(plPercentage)}%
                </td>
                <td>
                    <span class="status-badge ${statusClass}">OPEN</span>
                </td>
            </tr>
        `;
    }).join('');
}

// Sorting state
let currentSort = {
    column: 'time',
    direction: 'desc'
};

function setupSorting() {
    const headers = document.querySelectorAll('#historyTable th');
    headers.forEach((th, index) => {
        // Map header index to data property name
        // Ensure this matches the order of <th> elements in your HTML
        const columns = ['time', 'symbol', 'isBuyer', 'price', 'qty', 'netInUSDT', 'netInCoin', 'fee', 'tradePL'];
        if (columns[index]) {
            th.addEventListener('click', () => {
                const column = columns[index];

                // Toggle direction if same column, else default to desc for new column
                if (currentSort.column === column) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = column;
                    currentSort.direction = 'desc'; // Default new sort to desc
                }

                // Update headers (visual indicator could be added here, e.g., arrow icons)
                // For now, just re-display to apply sort
                displayTradeHistory();
            });
        }
    });
}

// Display Executed Trade History (History Tab)
function displayTradeHistory() {
    const tbody = document.getElementById('historyTableBody');
    const totalEl = document.getElementById('historyTotalPL'); // Assuming an element with this ID exists for total P&L

    if (!tbody) return;

    // 1. Flatten all trades from all symbols
    let allTrades = tradesData.flatMap(symbolData => symbolData.trades);

    // 2. Sort by currentSort state
    allTrades.sort((a, b) => {
        let valA = a[currentSort.column];
        let valB = b[currentSort.column];

        // Handle special cases for sorting if needed (e.g., string comparison for symbol)
        if (currentSort.column === 'symbol' || currentSort.column === 'isBuyer') {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
        }

        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    // 3. Calculate Total Realized P&L
    // Sum only tradePL where type is SELL (tradePL > -Infinity usually checked by type)
    // Actually tradePL is 0 for buys in our backend logic, so sum is safe.
    const totalHistoryPL = allTrades.reduce((sum, t) => sum + (t.tradePL || 0), 0);

    if (totalEl) {
        totalEl.textContent = `$${formatNumber(totalHistoryPL)}`;
        totalEl.className = `metric-value ${totalHistoryPL >= 0 ? 'pl-positive' : 'pl-negative'}`;
    }

    if (allTrades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">No executed trades found.</td></tr>';
        return;
    }

    tbody.innerHTML = allTrades.map(t => {
        const date = new Date(t.time).toLocaleString();
        const sideClass = t.isBuyer ? 'pl-positive' : 'pl-negative'; // Green for Buy, Red for Sell (classic trading colors) or invert? Usually Buy=Green, Sell=Red
        const sideLabel = t.isBuyer ? 'BUY' : 'SELL';

        const realizedPL = t.tradePL !== undefined ? t.tradePL : 0;
        const plClass = realizedPL >= 0 ? 'pl-positive' : 'pl-negative';
        const plDisplay = !t.isBuyer ? `$${formatNumber(realizedPL)}` : '-';

        // Calculate P&L percentage for sells
        let plPercentDisplay = '-';
        if (!t.isBuyer && t.weightedAvgPriceSnapshot && t.weightedAvgPriceSnapshot > 0) {
            const costBasis = parseFloat(t.qty) * t.weightedAvgPriceSnapshot;
            if (costBasis > 0) {
                const plPercentage = (realizedPL / costBasis) * 100;
                plPercentDisplay = `${plPercentage >= 0 ? '+' : ''}${formatNumber(plPercentage)}%`;
            }
        }

        const netUSDT = t.netInUSDT !== undefined ? `$${formatNumber(t.netInUSDT)}` : '-';
        const netCoin = t.netInCoin !== undefined ? `${formatNumber(t.netInCoin)}` : '-';
        const feeDisplay = `${formatNumber(parseFloat(t.fee))} USDT`;

        return `
            <tr>
                <td>${date}</td>
                <td><strong>${t.symbol}</strong></td>
                <td><span class="${sideClass}" style="font-weight:bold;">${sideLabel}</span></td>
                <td>$${formatNumber(parseFloat(t.price))}</td>
                <td>${formatNumber(parseFloat(t.qty))}</td>
                <td>${netUSDT}</td>
                <td>${netCoin}</td>
                <td>${feeDisplay}</td>
                <td class="${plClass}">${plDisplay}</td>
                <td class="${plClass}">${plPercentDisplay}</td>
            </tr>
        `;
    }).join('');
}

// Display portfolio metrics
function displayPortfolioMetrics() {
    const totalInvestedEl = document.getElementById('totalInvested');
    const totalPLEl = document.getElementById('totalPL');
    const totalPLPercentEl = document.getElementById('totalPLPercent');
    const totalTradesEl = document.getElementById('totalTrades');
    const openPositionsEl = document.getElementById('openPositions');

    if (totalInvestedEl) {
        totalInvestedEl.textContent = `$${portfolioData.totalInvested?.toFixed(2) || '0.00'}`;
    }

    if (totalPLEl) {
        const pl = portfolioData.totalPL || 0;
        totalPLEl.textContent = `$${pl.toFixed(2)}`;
        totalPLEl.className = `metric-value ${pl >= 0 ? 'pl-positive' : 'pl-negative'}`;
    }

    if (totalPLPercentEl) {
        const plPercent = portfolioData.plPercentage || 0;
        totalPLPercentEl.textContent = `${plPercent >= 0 ? '+' : ''}${plPercent.toFixed(2)}%`;
        totalPLPercentEl.className = `metric-change ${plPercent >= 0 ? 'positive' : 'negative'}`;
    }

    if (totalTradesEl) {
        totalTradesEl.textContent = portfolioData.tradeCount || 0;
    }

    if (openPositionsEl) {
        const openCount = tradesData.filter(t => t.status === 'ONGOING').length;
        openPositionsEl.textContent = openCount;
    }
}

// Show configuration message
function showConfigurationMessage() {
    const tbody = document.getElementById('tradesTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="loading-cell">
                    <div style="padding: 2rem;">
                        <h3 style="margin-bottom: 1rem;">⚙️ Configuration Required</h3>
                        <p style="margin-bottom: 1rem;">Please configure your Binance API keys in the Settings tab to view your trades.</p>
                        <button onclick="document.querySelector('[data-tab=\\"settings\\"]').click()" 
                                style="padding: 0.75rem 2rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); 
                                       border: none; border-radius: 12px; color: white; font-weight: 600; cursor: pointer;">
                            Go to Settings
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }
}

// Setup Pair Summary Toggle
function setupPairSummary() {
    const toggleBtn = document.getElementById('toggleSummaryBtn');
    const summaryContainer = document.getElementById('pairSummaryContainer');

    if (toggleBtn && summaryContainer) {
        toggleBtn.addEventListener('click', () => {
            if (summaryContainer.style.display === 'none') {
                summaryContainer.style.display = 'block';
                toggleBtn.textContent = '▼ Collapse';
            } else {
                summaryContainer.style.display = 'none';
                toggleBtn.textContent = '▶ Expand';
            }
        });
    }
}

// Display Pair Performance Summary
function displayPairSummary() {
    const tbody = document.getElementById('pairSummaryBody');
    if (!tbody) return;

    // Group trades by symbol
    const pairStats = {};

    tradesData.forEach(symbolData => {
        const symbol = symbolData.symbol;
        const trades = symbolData.trades;

        if (!pairStats[symbol]) {
            pairStats[symbol] = {
                totalTrades: 0,
                buys: 0,
                sells: 0,
                buyVolume: 0,
                sellVolume: 0,
                buyPriceSum: 0,
                sellPriceSum: 0,
                totalRealizedPL: 0,
                winningTrades: 0,
                losingTrades: 0
            };
        }

        const stats = pairStats[symbol];

        trades.forEach(t => {
            stats.totalTrades++;

            const price = parseFloat(t.price);
            const qty = parseFloat(t.qty);
            const volume = price * qty;

            if (t.isBuyer) {
                stats.buys++;
                stats.buyVolume += volume;
                stats.buyPriceSum += price;
            } else {
                stats.sells++;
                stats.sellVolume += volume;
                stats.sellPriceSum += price;

                const pl = t.tradePL || 0;
                stats.totalRealizedPL += pl;

                if (pl > 0) stats.winningTrades++;
                else if (pl < 0) stats.losingTrades++;
            }
        });
    });

    // Convert to array and sort by total realized P&L
    const pairArray = Object.entries(pairStats).map(([symbol, stats]) => ({
        symbol,
        ...stats,
        avgBuyPrice: stats.buys > 0 ? stats.buyPriceSum / stats.buys : 0,
        avgSellPrice: stats.sells > 0 ? stats.sellPriceSum / stats.sells : 0,
        totalVolume: stats.buyVolume + stats.sellVolume,
        avgPLPerTrade: stats.sells > 0 ? stats.totalRealizedPL / stats.sells : 0,
        winRate: stats.sells > 0 ? (stats.winningTrades / stats.sells) * 100 : 0
    }));

    pairArray.sort((a, b) => b.totalRealizedPL - a.totalRealizedPL);

    if (pairArray.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">No trading data available.</td></tr>';
        return;
    }

    tbody.innerHTML = pairArray.map(pair => {
        const plClass = pair.totalRealizedPL >= 0 ? 'pl-positive' : 'pl-negative';
        const avgPLClass = pair.avgPLPerTrade >= 0 ? 'pl-positive' : 'pl-negative';
        const winRateClass = pair.winRate >= 50 ? 'pl-positive' : 'pl-negative';

        return `
            <tr>
                <td><strong>${pair.symbol}</strong></td>
                <td>${pair.totalTrades}</td>
                <td>${pair.buys}</td>
                <td>${pair.sells}</td>
                <td>$${formatNumber(pair.totalVolume)}</td>
                <td>$${formatNumber(pair.avgBuyPrice)}</td>
                <td>$${formatNumber(pair.avgSellPrice)}</td>
                <td class="${plClass}">$${formatNumber(pair.totalRealizedPL)}</td>
                <td class="${avgPLClass}">$${formatNumber(pair.avgPLPerTrade)}</td>
                <td class="${winRateClass}">${formatNumber(pair.winRate)}%</td>
            </tr>
        `;
    }).join('');
}

// Setup Export Button
function setupExport() {
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToCSV);
    }
}

// Export to CSV
function exportToCSV() {
    // Flatten trades
    let allTrades = tradesData.flatMap(symbolData => symbolData.trades);
    allTrades.sort((a, b) => b.time - a.time);

    if (allTrades.length === 0) {
        alert("No trades to export.");
        return;
    }

    const headers = ['Date', 'Symbol', 'Side', 'Price', 'Qty', 'Net USDT', 'Net Coin', 'Fee', 'Realized P&L', 'P&L %'];

    // Helper to escape CSV values - only quote when necessary
    const escapeCSV = (val) => {
        const str = String(val);
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    // Map data to rows
    const rows = allTrades.map(t => {
        const date = new Date(t.time).toISOString();
        const side = t.isBuyer ? 'BUY' : 'SELL';
        const netUSDT = t.netInUSDT || 0;
        const netCoin = t.netInCoin || 0;
        const fee = t.fee || 0;
        const realizedPL = t.tradePL || 0;

        // Calculate P&L %
        let plPercent = '';
        if (!t.isBuyer && t.weightedAvgPriceSnapshot && t.weightedAvgPriceSnapshot > 0) {
            const costBasis = parseFloat(t.qty) * t.weightedAvgPriceSnapshot;
            if (costBasis > 0) {
                plPercent = ((realizedPL / costBasis) * 100).toFixed(2);
            }
        }

        return [
            date,
            t.symbol,
            side,
            parseFloat(t.price).toFixed(4),
            parseFloat(t.qty).toFixed(8),
            netUSDT.toFixed(4),
            netCoin.toFixed(8),
            fee.toFixed(4),
            realizedPL.toFixed(4),
            plPercent
        ].map(escapeCSV).join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n'); // Add BOM for Excel

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `trade_history_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Connect to WebSocket for live price updates
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('✅ WebSocket connected for price updates');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === 'ticker') {
                // Update price map
                data.data.forEach(ticker => {
                    priceUpdates.set(ticker.s, parseFloat(ticker.c));
                });

                // Refresh trades display if we have data
                if (tradesData.length > 0) {
                    displayOpenPositions();
                }
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('❌ WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 5000);
    };
}

// Format number with commas
function formatNumber(num) {
    return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
