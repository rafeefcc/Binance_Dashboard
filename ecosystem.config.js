module.exports = {
  apps: [{
    name: 'binance-dashboard',
    script: 'npm',
    args: 'start --loglevel verbose',
    cwd: '/opt/Binance_Dashboard',
    instances: 1,
    autorestart: true,
    watch: false,  // Set to true if you want PM2 to restart on file changes
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 5008
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5008
    },
    log_file: '/var/log/binance-dashboard.log',
    out_file: '/var/log/binance-dashboard.out.log',
    error_file: '/var/log/binance-dashboard.error.log',
    time: true
  }],

  // Remove or modify the deploy section if you don't need it
  deploy: {
    production: {
      user: 'SSH_USERNAME',
      host: 'SSH_HOSTMACHINE',
      ref: 'origin/master',
      repo: 'GIT_REPOSITORY',
      path: 'DESTINATION_PATH',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
