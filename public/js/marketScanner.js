// Market scanner state
let scanResults = [];
let scannerWs = null;

// Initialize market scanner
function initMarketScanner() {
    loadTelegramChatId();
    setupScanButton();
    setupTelegramSave();
    connectWebSocket();
    loadScanResults();
}

// Load Telegram Chat ID from settings
async function loadTelegramChatId() {
    try {
        const response = await fetch('/api/settings', {
            credentials: 'include'
        });

        if (response.ok) {
            const settings = await response.json();
            const chatIdInput = document.getElementById('telegramChatId');
            if (chatIdInput && settings.telegramChatId) {
                chatIdInput.value = settings.telegramChatId;
            }
        }
    } catch (error) {
        console.error('Failed to load Telegram Chat ID:', error);
    }
}

// Save Telegram Chat ID
async function saveTelegramChatId() {
    const chatId = document.getElementById('telegramChatId').value.trim();

    if (!chatId) {
        alert('Please enter a Telegram Chat ID');
        return;
    }

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ telegramChatId: chatId })
        });

        if (!response.ok) {
            throw new Error('Failed to save Chat ID');
        }

        alert('✅ Telegram Chat ID saved successfully!');
    } catch (error) {
        console.error('Failed to save Chat ID:', error);
        alert('❌ Failed to save Chat ID. Please try again.');
    }
}

// Setup scan button
function setupScanButton() {
    const scanBtn = document.getElementById('manualScanBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', async () => {
            scanBtn.disabled = true;
            scanBtn.textContent = '⏳ Scanning...';

            await loadScanResults();

            scanBtn.disabled = false;
            scanBtn.textContent = '🔍 Scan Now';
        });
    }
}

// Setup Telegram save button
function setupTelegramSave() {
    const saveBtn = document.getElementById('saveTelegramBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveTelegramChatId);
    }
}

// Load scan results from API
async function loadScanResults() {
    try {
        const response = await fetch('/api/market-scan', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to load scan results');
        }

        scanResults = await response.json();
        displayScanResults();
        updateScanTime();
    } catch (error) {
        console.error('Failed to load scan results:', error);
        const tbody = document.getElementById('scannerTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">Failed to load scan results. Please try again.</td></tr>';
        }
    }
}

// Display scan results in table
function displayScanResults() {
    const tbody = document.getElementById('scannerTableBody');
    if (!tbody) return;

    if (scanResults.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No results yet. Click "Scan Now" to start.</td></tr>';
        return;
    }

    tbody.innerHTML = scanResults.map((result, index) => {
        const trend = result.netInflow > 0 ? '📈' : '📉';
        const inflowClass = result.netInflow > 0 ? 'pl-positive' : 'pl-negative';

        return `
            <tr>
                <td data-label="#">${index + 1}</td>
                <td data-label="Symbol"><strong>${result.symbol}</strong></td>
                <td data-label="Bid Volume">$${formatNumber(result.bidVolume)}</td>
                <td data-label="Ask Volume">$${formatNumber(result.askVolume)}</td>
                <td data-label="Net Inflow" class="${inflowClass}">$${formatNumber(result.netInflow)}</td>
                <td data-label="Trend">${trend}</td>
            </tr>
        `;
    }).join('');
}

// Update scan time
function updateScanTime() {
    const timeElement = document.getElementById('lastScanTime');
    if (timeElement) {
        const now = new Date();
        timeElement.textContent = `Last scan: ${now.toLocaleTimeString()}`;
    }
}

// Connect to WebSocket for live updates
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    scannerWs = new WebSocket(wsUrl);

    scannerWs.onopen = () => {
        console.log('✅ Market Scanner WebSocket connected');
    };

    scannerWs.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === 'marketScan') {
                scanResults = data.data;
                displayScanResults();
                updateScanTime();
            }
        } catch (error) {
            console.error('Market Scanner WebSocket message error:', error);
        }
    };

    scannerWs.onerror = (error) => {
        console.error('Market Scanner WebSocket error:', error);
    };

    scannerWs.onclose = () => {
        console.log('❌ Market Scanner WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 5000);
    };
}

// Format number with commas
function formatNumber(num) {
    return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Initialize when scanner tab is shown
document.addEventListener('DOMContentLoaded', () => {
    const scannerTab = document.querySelector('[data-tab="scanner"]');
    if (scannerTab) {
        scannerTab.addEventListener('click', () => {
            setTimeout(initMarketScanner, 100);
        });
    }
});
