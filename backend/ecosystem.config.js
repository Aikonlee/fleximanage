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
      NODE_ENV: 'development',
      CAPTCHA_KEY: '0x4AAAAAAB43PO97iTQPqCGoeQsv0SPYXk4',
      CAPTCHA_SITE_KEY: '0x4AAAAAAB43POY4ajLxq-X0',
      USER_SECRET_KEY: '6d187ff035a2911bd5280d03be53b533cde480193fec48d9223293e1e8e9a3e0',
      DEVICE_SECRET_KEY: '990b50a488b30718928921e72847b2e4b30d8798c7b7ad82ca04f383d90e5a8e'
    },
    env_production: {
      NODE_ENV: 'production',
      CAPTCHA_KEY: '0x4AAAAAAB43PO97iTQPqCGoeQsv0SPYXk4',
      CAPTCHA_SITE_KEY: '0x4AAAAAAB43POY4ajLxq-X0',
      USER_SECRET_KEY: '6d187ff035a2911bd5280d03be53b533cde480193fec48d9223293e1e8e9a3e0',
      DEVICE_SECRET_KEY: '990b50a488b30718928921e72847b2e4b30d8798c7b7ad82ca04f383d90e5a8e'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/root/fleximanage/logs/pm2-error.log',
    out_file: '/root/fleximanage/logs/pm2-out.log',
    merge_logs: true
  }]
};
