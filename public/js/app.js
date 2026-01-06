// Main application state
let currentPeriod = 'all';
let currentHistoryPeriod = 'all';
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
    setupMonthlyPerformance();
    setupHistoryFilters();
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
        displayMonthlyPerformance();
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
        // Force refresh monthly stats now that we have the global account value (denominator)
        displayMonthlyPerformance();
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
                <td data-label="Symbol"><strong>${trade.symbol}</strong></td>
                <td data-label="Position">${trade.position.toFixed(8)}</td>
                <td data-label="Invested USDT">$${formatNumber(investedAmount)}</td>
                <td data-label="Avg Cost">$${formatNumber(trade.averageCost)}</td>
                <td data-label="Current Price">$${formatNumber(currentPrice)}</td>
                <td data-label="Realized P&L">-</td>
                <td data-label="Unrealized P&L" class="${plClass}">
                    $${formatNumber(unrealizedPL)}
                </td>
                <td data-label="Total P&L" class="${plClass}">
                    $${formatNumber(totalPL)}
                </td>
                <td data-label="P&L %" class="${plClass}">
                    ${plPercentage >= 0 ? '+' : ''}${formatNumber(plPercentage)}%
                </td>
                <td data-label="Status">
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

    // Apply cutoff filter: 11/15/2025, 11:19:43 AM
    const cutoffTime = new Date('2025-11-15T11:19:43').getTime();
    allTrades = allTrades.filter(t => t.time >= cutoffTime);

    // Apply 30-day filter if active
    if (currentHistoryPeriod === '30d') {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        allTrades = allTrades.filter(t => t.time >= thirtyDaysAgo);
    }

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
                <td data-label="Date">${date}</td>
                <td data-label="Pair"><strong>${t.symbol}</strong></td>
                <td data-label="Side"><span class="${sideClass}" style="font-weight:bold;">${sideLabel}</span></td>
                <td data-label="Price">$${formatNumber(parseFloat(t.price), 4)}</td>
                <td data-label="Qty">${parseFloat(t.qty).toFixed(8).replace(/\.?0+$/, '')}</td>
                <td data-label="Net USDT">${netUSDT}</td>
                <td data-label="Net Coin">${netCoin}</td>
                <td data-label="Fee">${feeDisplay}</td>
                <td data-label="Realized P&L" class="${plClass}">${plDisplay}</td>
                <td data-label="P&L %" class="${plClass}">${plPercentDisplay}</td>
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
        const cutoffTime = new Date('2025-11-15T11:19:43').getTime();
        const trades = symbolData.trades.filter(t => t.time >= cutoffTime);

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
                <td data-label="Pair"><strong>${pair.symbol}</strong></td>
                <td data-label="Total Trades">${pair.totalTrades}</td>
                <td data-label="Buys">${pair.buys}</td>
                <td data-label="Sells">${pair.sells}</td>
                <td data-label="Volume (USDT)">$${formatNumber(pair.totalVolume)}</td>
                <td data-label="Avg Buy Price">$${formatNumber(pair.avgBuyPrice)}</td>
                <td data-label="Avg Sell Price">$${formatNumber(pair.avgSellPrice)}</td>
                <td data-label="Realized P&L" class="${plClass}">$${formatNumber(pair.totalRealizedPL)}</td>
                <td data-label="Avg P&L" class="${avgPLClass}">$${formatNumber(pair.avgPLPerTrade)}</td>
                <td data-label="Win Rate" class="${winRateClass}">${formatNumber(pair.winRate)}%</td>
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

    // Apply cutoff filter: 11/15/2025, 11:19:43 AM
    const cutoffTime = new Date('2025-11-15T11:19:43').getTime();
    allTrades = allTrades.filter(t => t.time >= cutoffTime);

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

// Setup Monthly Performance Summary Toggle
function setupMonthlyPerformance() {
    const toggleBtn = document.getElementById('toggleMonthlyBtn');
    const container = document.getElementById('monthlySummaryContainer');

    if (toggleBtn && container) {
        toggleBtn.addEventListener('click', () => {
            if (container.style.display === 'none') {
                container.style.display = 'block';
                toggleBtn.textContent = '▼ Collapse';
            } else {
                container.style.display = 'none';
                toggleBtn.textContent = '▶ Expand';
            }
        });
    }
}

// Display Monthly Performance Summary
// Display Monthly Performance Summary
function displayMonthlyPerformance() {
    const tbody = document.getElementById('monthlySummaryBody');
    if (!tbody) return;

    const cutoffTime = new Date('2025-11-15T11:19:43').getTime();
    const now = Date.now();
    const totalAccountValue = portfolioData.totalAssetValue || 0;

    console.log('[Exposure DEBUG] Starting calculation', {
        totalAccountValue,
        tradesCount: tradesData.length,
        currentTime: new Date(now).toLocaleString()
    });

    // 1. Reconstruct Global Investment Timeline
    // Collect all trades from all symbols and sort by time
    const allTradesSorted = tradesData.flatMap(symbolData =>
        symbolData.trades.map(t => ({ ...t, symbol: symbolData.symbol }))
    ).sort((a, b) => a.time - b.time);

    const monthlyStats = {};
    const symbolStates = {}; // symbol -> { qty, avgPrice }

    let lastTime = cutoffTime;
    let currentTotalInvestment = 0;

    // Helper to add integral to months
    const addInvestmentIntegral = (startTime, endTime, value) => {
        if (endTime <= startTime || value < 0) return;

        let t = startTime;
        while (t < endTime) {
            const date = new Date(t);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
            const chunkEnd = Math.min(endTime, nextMonth.getTime());
            const duration = chunkEnd - t;

            if (!monthlyStats[monthKey]) {
                const mStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
                const mEnd = nextMonth.getTime();

                const effectiveMonthStart = Math.max(mStart, cutoffTime);
                const effectiveMonthEnd = Math.min(mEnd, now);

                monthlyStats[monthKey] = {
                    display: date.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    totalTrades: 0,
                    sells: 0,
                    volume: 0,
                    realizedPL: 0,
                    wins: 0,
                    investmentIntegral: 0,
                    totalDuration: Math.max(1, effectiveMonthEnd - effectiveMonthStart)
                };
            }

            monthlyStats[monthKey].investmentIntegral += (value * duration);
            t = chunkEnd;
        }
    };

    // Process Timeline
    allTradesSorted.forEach(t => {
        if (t.time < cutoffTime || t.time > now) return;

        // 1. Add integral for the period BEFORE this trade
        addInvestmentIntegral(lastTime, t.time, currentTotalInvestment);

        // 2. Update symbol state
        if (!symbolStates[t.symbol]) symbolStates[t.symbol] = { qty: 0, avgPrice: 0 };
        const state = symbolStates[t.symbol];

        const tradeQty = parseFloat(t.qty);
        const tradePrice = parseFloat(t.price);

        if (t.isBuyer) {
            const oldCost = state.qty * state.avgPrice;
            const newCost = tradeQty * tradePrice;
            state.qty += tradeQty;
            state.avgPrice = state.qty > 0 ? (oldCost + newCost) / state.qty : 0;
        } else {
            state.qty = Math.max(0, state.qty - tradeQty);
            if (state.qty <= 0.00000001) {
                state.qty = 0;
                state.avgPrice = 0;
            }
        }

        // Update trade-specific performance stats
        const date = new Date(t.time);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyStats[monthKey]) addInvestmentIntegral(t.time, t.time + 1, 0); // Init month

        const stats = monthlyStats[monthKey];
        stats.totalTrades++;
        stats.volume += (tradePrice * tradeQty);
        if (!t.isBuyer) {
            stats.sells++;
            const pl = t.tradePL || 0;
            stats.realizedPL += pl;
            if (pl > 0) stats.wins++;
        }

        // Recalculate global investment value
        currentTotalInvestment = Object.values(symbolStates).reduce((sum, s) => sum + (s.qty * s.avgPrice), 0);
        lastTime = t.time;
    });

    // Add trailing integral to current moment
    addInvestmentIntegral(lastTime, now, currentTotalInvestment);

    // Final check for denominator (Fallback to totalInvested if account value is missing)
    const effectiveTotalFund = totalAccountValue > 0 ? totalAccountValue : (portfolioData.totalInvested || 0);

    // Convert to sorted array
    const sortedMonths = Object.keys(monthlyStats)
        .sort((a, b) => b.localeCompare(a))
        .map(key => {
            const m = monthlyStats[key];
            const avgInvestment = m.investmentIntegral / m.totalDuration;
            // Exposure % = Average Investment / Total Assets
            const exposurePercent = effectiveTotalFund > 0 ? (avgInvestment / effectiveTotalFund) * 100 : 0;

            console.log(`[Exposure DEBUG] ${key}:`, {
                avgInvestment,
                totalFund: effectiveTotalFund,
                exposurePercent
            });

            return {
                ...m,
                exposurePercent
            };
        });

    if (sortedMonths.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No trading data available for monthly summary.</td></tr>';
        return;
    }

    tbody.innerHTML = sortedMonths.map(m => {
        const plClass = m.realizedPL >= 0 ? 'pl-positive' : 'pl-negative';
        const winRate = m.sells > 0 ? (m.wins / m.sells) * 100 : 0;
        const winRateClass = winRate >= 50 ? 'pl-positive' : 'pl-negative';

        return `
            <tr>
                <td data-label="Month"><strong>${m.display}</strong></td>
                <td data-label="Total Trades">${m.totalTrades}</td>
                <td data-label="Sells">${m.sells}</td>
                <td data-label="Volume (USDT)">$${formatNumber(m.volume)}</td>
                <td data-label="Realized P&L" class="${plClass}">$${formatNumber(m.realizedPL)}</td>
                <td data-label="Win Rate" class="${winRateClass}">${formatNumber(winRate)}%</td>
                <td data-label="Exposure %" class="metric-value">${formatNumber(m.exposurePercent)}%</td>
            </tr>
        `;
    }).join('');
}

// Setup History Time Filters
function setupHistoryFilters() {
    const buttons = document.querySelectorAll('#historyTimeFilter .filter-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            currentHistoryPeriod = btn.dataset.historyPeriod;
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            displayTradeHistory();
        });
    });
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
// Format number with commas and configurable decimals
function formatNumber(num, decimals = 2) {
    if (num === 0) return '0.00';
    if (!num) return '-';

    // For very small numbers, show more decimals
    if (Math.abs(num) < 1 && decimals === 2) {
        decimals = 6;
    }

    return num.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}
