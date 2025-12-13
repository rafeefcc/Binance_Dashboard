// Settings management
let currentSettings = {};

// Load current settings
async function loadSettings() {
    try {
        const response = await fetch('/api/settings', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to load settings');
        }

        currentSettings = await response.json();
        displaySettings();
    } catch (error) {
        console.error('Failed to load settings:', error);
        showStatus('Failed to load settings', 'error');
    }
}

// Display settings in UI
function displaySettings() {
    // We don't show the actual API keys for security
    // Just show if they're configured
    const statusDiv = document.getElementById('settingsStatus');

    if (currentSettings.hasBinanceKeys) {
        statusDiv.className = 'settings-status success';
        statusDiv.textContent = '✅ Binance API keys are configured';
        statusDiv.style.display = 'block';
    }

    if (currentSettings.hasTelegramToken) {
        const telegramStatus = document.createElement('div');
        telegramStatus.className = 'settings-status success';
        telegramStatus.textContent = '✅ Telegram bot token is configured';
        telegramStatus.style.display = 'block';
        statusDiv.parentNode.appendChild(telegramStatus);
    }
}

// Save settings
async function saveSettings() {
    const binanceApiKey = document.getElementById('binanceApiKey').value.trim();
    const binanceApiSecret = document.getElementById('binanceApiSecret').value.trim();
    const telegramBotToken = document.getElementById('telegramBotToken').value.trim();

    const settings = {};

    if (binanceApiKey) settings.binanceApiKey = binanceApiKey;
    if (binanceApiSecret) settings.binanceApiSecret = binanceApiSecret;
    if (telegramBotToken) settings.telegramBotToken = telegramBotToken;

    if (Object.keys(settings).length === 0) {
        showStatus('Please enter at least one setting to save', 'error');
        return;
    }

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            throw new Error('Failed to save settings');
        }

        const result = await response.json();
        showStatus('✅ Settings saved successfully! Reloading...', 'success');

        // Clear input fields
        document.getElementById('binanceApiKey').value = '';
        document.getElementById('binanceApiSecret').value = '';
        document.getElementById('telegramBotToken').value = '';

        // Reload settings after a delay
        setTimeout(() => {
            window.location.reload();
        }, 1500);

    } catch (error) {
        console.error('Failed to save settings:', error);
        showStatus('❌ Failed to save settings. Please try again.', 'error');
    }
}

// Show status message
function showStatus(message, type) {
    const statusDiv = document.getElementById('settingsStatus');
    statusDiv.className = `settings-status ${type}`;
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';

    if (type === 'success') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
}

// Initialize settings page
function initSettings() {
    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveSettings);
    }

    loadSettings();
}

// Initialize when settings tab is shown
document.addEventListener('DOMContentLoaded', () => {
    const settingsTab = document.querySelector('[data-tab="settings"]');
    if (settingsTab) {
        settingsTab.addEventListener('click', () => {
            setTimeout(initSettings, 100);
        });
    }
});
