require('dotenv').config({ path: '/root/fleximanage/backend/.env' });

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
      NODE_ENV: 'production',
      CAPTCHA_KEY: process.env.CAPTCHA_KEY,
      CAPTCHA_SITE_KEY: process.env.CAPTCHA_SITE_KEY,
      USER_SECRET_KEY: process.env.USER_SECRET_KEY,
      DEVICE_SECRET_KEY: process.env.DEVICE_SECRET_KEY
    },
    env_development: {
      NODE_ENV: 'development',
      CAPTCHA_KEY: process.env.CAPTCHA_KEY,
      CAPTCHA_SITE_KEY: process.env.CAPTCHA_SITE_KEY,
      USER_SECRET_KEY: process.env.USER_SECRET_KEY,
      DEVICE_SECRET_KEY: process.env.DEVICE_SECRET_KEY
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/root/fleximanage/logs/pm2-error.log',
    out_file: '/root/fleximanage/logs/pm2-out.log',
    merge_logs: true
  }]
};
