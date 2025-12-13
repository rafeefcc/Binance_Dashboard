const axios = require('axios');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const BINANCE_BASE_URL = 'https://api.binance.com';

function generateSignature(queryString, apiSecret) {
    return crypto.createHmac('sha256', apiSecret)
        .update(queryString)
        .digest('hex');
}

async function runCheck(apiKey, apiSecret) {
    console.log('\n🔍 Starting Binance API Connectivity Check...');
    console.log('--------------------------------------------------');
    console.log(`API Key: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);
    console.log(`API Secret: ${apiSecret.substring(0, 4)}...${apiSecret.substring(apiSecret.length - 4)}`);
    console.log('--------------------------------------------------');

    // 1. Check System Status (No Auth)
    try {
        console.log('\n[1/3] Checking System Status (Public Endpoint)...');
        const start = Date.now();
        await axios.get(`${BINANCE_BASE_URL}/api/v3/ping`);
        const latency = Date.now() - start;
        console.log(`✅ System Status: ONLINE (Latency: ${latency}ms)`);
    } catch (error) {
        console.error('❌ Failed to connect to Binance (Public Endpoint)');
        console.error('Error:', error.message);
        process.exit(1);
    }

    // 2. Check Time Sync
    let serverTime;
    try {
        console.log('\n[2/3] Checking Server Time...');
        const response = await axios.get(`${BINANCE_BASE_URL}/api/v3/time`);
        serverTime = response.data.serverTime;
        const localTime = Date.now();
        const diff = Math.abs(localTime - serverTime);
        console.log(`✅ Server Time: ${new Date(serverTime).toISOString()}`);
        console.log(`   Local Time:  ${new Date(localTime).toISOString()}`);
        console.log(`   Diff: ${diff}ms (Limit: ±1000ms recommended)`);

        if (diff > 1000) {
            console.warn('⚠️  Warning: Large time difference may cause signature errors!');
        }
    } catch (error) {
        console.error('❌ Failed to get server time');
        console.error('Error:', error.message);
    }

    // 3. Check Account Permissions (Signed Request)
    try {
        console.log('\n[3/3] Checking Account Access (Signed Endpoint)...');

        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = generateSignature(queryString, apiSecret);

        const url = `${BINANCE_BASE_URL}/api/v3/account?${queryString}&signature=${signature}`;

        const response = await axios.get(url, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });

        console.log('✅ SUCCESS! Authentication working.');
        console.log('--------------------------------------------------');
        console.log('Account Status:');
        console.log(`   Can Trade: ${response.data.canTrade ? 'YES' : 'NO'}`);
        console.log(`   Can Withdraw: ${response.data.canWithdraw ? 'YES' : 'NO'}`);
        console.log(`   Can Deposit: ${response.data.canDeposit ? 'YES' : 'NO'}`);
        console.log(`   Account Type: ${response.data.accountType}`);

        console.log('\nBalances (Assets > 0):');
        const activeBalances = response.data.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
        if (activeBalances.length === 0) {
            console.log('   (No assets with positive balance found)');
        } else {
            activeBalances.forEach(b => {
                console.log(`   - ${b.asset}: Free ${parseFloat(b.free).toFixed(8)} | Locked ${parseFloat(b.locked).toFixed(8)}`);
            });
        }
        console.log('--------------------------------------------------');

    } catch (error) {
        console.error('❌ FAILED: Could not authenticate.');
        console.error('--------------------------------------------------');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Code:', error.response.data.code);
            console.error('Message:', error.response.data.msg);

            // Common Error Explanations
            if (error.response.data.code === -2015) {
                console.log('\n👉 Tip: "Invalid API-key, IP, or permissions."');
                console.log('   - Check if your API Key/Secret are exactly correct.');
                console.log('   - Check if your IP address is whitelisted in Binance settings.');
            } else if (error.response.data.code === -1021) {
                console.log('\n👉 Tip: "Timestamp for this request is outside of the recvWindow."');
                console.log('   - Your system clock is out of sync with Binance servers.');
            }
        } else {
            console.error('Error:', error.message);
        }
    } finally {
        rl.close();
    }
}

console.log('Enter your Binance Credentials to test:');
rl.question('API Key: ', (apiKey) => {
    rl.question('API Secret: ', (apiSecret) => {
        runCheck(apiKey.trim(), apiSecret.trim());
    });
});
