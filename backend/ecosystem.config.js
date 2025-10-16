require('dotenv').config();

module.exports = {
  apps: [{
    name: 'fleximanage-backend',
    script: './bin/www',
    cwd: '/root/fleximanage/backend',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      CAPTCHA_KEY: process.env.CAPTCHA_SECRET_KEY || process.env.CAPTCHA_KEY || '',
      CAPTCHA_SITE_KEY: process.env.CAPTCHA_SITE_KEY || ''
    },
    env_production: {
      NODE_ENV: 'production',
      CAPTCHA_KEY: process.env.CAPTCHA_SECRET_KEY || process.env.CAPTCHA_KEY || '',
      CAPTCHA_SITE_KEY: process.env.CAPTCHA_SITE_KEY || ''
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/root/fleximanage/logs/pm2-error.log',
    out_file: '/root/fleximanage/logs/pm2-out.log',
    merge_logs: true
  }]
};
