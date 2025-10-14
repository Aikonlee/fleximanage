# FlexiManage Boot Auto-Start Configuration

This document explains how to configure systemd services for FlexiManage SD-WAN Management Platform auto-start on system boot using PM2 process manager.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Service Management](#service-management)
- [Configuration Details](#configuration-details)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

## Overview

FlexiManage is a comprehensive SD-WAN management platform that requires several components to run:
- **Backend Application**: Node.js Express server (ports 3002/3443)
- **MongoDB Replica Set**: 3 MongoDB instances (ports 27017-27019)
- **Redis**: Cache and session store (port 6379)
- **PM2 Process Manager**: For Node.js application lifecycle management

This configuration ensures FlexiManage starts automatically on system boot and restarts on failure.

## Quick Start

### Prerequisites

1. FlexiManage installed at `/root/fleximanage`
2. Node.js v20+ with NVM
3. PM2 installed globally: `npm install -g pm2`
4. MongoDB replica set running (use `setup_mongodb_systemd.sh`)
5. Redis server running
6. Root/sudo privileges

### Install and Start Service

```bash
# Run setup script
sudo bash scripts/setup_fleximanage_systemd.sh

# The script will:
# 1. Create systemd service unit file
# 2. Configure PM2 to manage the backend
# 3. Set up dependencies on MongoDB and Redis
# 4. Enable auto-start on boot
# 5. Start the FlexiManage service
```

### Verify Installation

```bash
# Check if service is enabled for auto-start
systemctl is-enabled fleximanage

# Check if service is running
systemctl is-active fleximanage

# View detailed service status
systemctl status fleximanage

# Check listening ports
ss -tlnp | grep -E ':(3002|3443)'

# View PM2 process status
pm2 list
```

## Service Management

### Start Service

```bash
# Start FlexiManage service
sudo systemctl start fleximanage

# Verify it's running
systemctl status fleximanage
pm2 list
```

### Stop Service

```bash
# Stop FlexiManage service
sudo systemctl stop fleximanage

# Verify it's stopped
systemctl status fleximanage
```

### Restart Service

```bash
# Restart FlexiManage service
sudo systemctl restart fleximanage

# Or reload without downtime
sudo systemctl reload fleximanage
```

### Check Service Status

```bash
# Check systemd service status
systemctl status fleximanage

# Check if service is active
systemctl is-active fleximanage

# Check if service is enabled for auto-start
systemctl is-enabled fleximanage

# Check PM2 process status
pm2 list

# Monitor PM2 processes in real-time
pm2 monit
```

### View Logs

```bash
# View systemd service logs (real-time)
journalctl -u fleximanage -f

# View recent logs
journalctl -u fleximanage -n 100

# View PM2 application logs
pm2 logs fleximanage-backend

# View PM2 logs with timestamps
pm2 logs fleximanage-backend --timestamp

# View only error logs
pm2 logs fleximanage-backend --err

# View application log files directly
tail -f /root/fleximanage/logs/app.log
```

### Enable/Disable Auto-Start

```bash
# Enable auto-start (already done by setup script)
sudo systemctl enable fleximanage

# Disable auto-start
sudo systemctl disable fleximanage

# Re-enable auto-start
sudo systemctl enable fleximanage

# Check if enabled
systemctl is-enabled fleximanage
```

## Configuration Details

### Service File Location

```
/etc/systemd/system/fleximanage.service
```

### Service Configuration

The service is configured with:

- **Type**: `forking` (PM2 daemonizes the process)
- **User**: `root` (required for NVM environment)
- **Dependencies**: MongoDB replica set (27017-27019), Redis
- **Restart Policy**: `on-failure` (auto-restart on crash)
- **Restart Delay**: 10 seconds
- **File Limits**: 65536 open files and processes
- **Timeout**: 60s start, 30s stop

### Environment Variables

```bash
PATH=/root/.nvm/versions/node/v20.11.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
NODE_ENV=production
PM2_HOME=/root/.pm2
```

### PM2 Configuration

```bash
# PM2 Binary
/root/.nvm/versions/node/v20.11.1/bin/pm2

# Application Name
fleximanage-backend

# Working Directory
/root/fleximanage/backend

# Start Command
pm2 start /root/fleximanage/backend/bin/www --name fleximanage-backend --update-env --no-autorestart
```

### Service Dependencies

The FlexiManage service depends on:
1. `mongod-27017.service` - MongoDB primary instance
2. `mongod-27018.service` - MongoDB secondary instance
3. `mongod-27019.service` - MongoDB secondary instance
4. `redis.service` or `redis-server.service` - Redis cache
5. `network-online.target` - Network connectivity

These dependencies ensure FlexiManage starts only after all required services are running.

### Application Ports

- **HTTPS**: 3443 (production)
- **HTTP**: 3002 (API/development)
- **WebSocket**: Uses same HTTPS port (3443)

## Troubleshooting

### Service Won't Start

1. **Check service status and logs:**
   ```bash
   systemctl status fleximanage
   journalctl -u fleximanage -n 50
   ```

2. **Check MongoDB is running:**
   ```bash
   systemctl status mongod-27017 mongod-27018 mongod-27019
   ```

3. **Check Redis is running:**
   ```bash
   systemctl status redis-server
   # or
   systemctl status redis
   ```

4. **Check PM2 daemon:**
   ```bash
   pm2 ping
   pm2 list
   ```

5. **Check Node.js and PM2 paths:**
   ```bash
   which node
   which pm2
   /root/.nvm/versions/node/v20.11.1/bin/node --version
   /root/.nvm/versions/node/v20.11.1/bin/pm2 --version
   ```

6. **Try starting manually:**
   ```bash
   cd /root/fleximanage/backend
   /root/.nvm/versions/node/v20.11.1/bin/pm2 start bin/www --name fleximanage-backend
   ```

### Service Fails on Boot

1. **Check systemd boot logs:**
   ```bash
   journalctl -b -u fleximanage
   ```

2. **Verify service dependencies are met:**
   ```bash
   systemctl list-dependencies fleximanage
   ```

3. **Check if MongoDB services start before FlexiManage:**
   ```bash
   systemctl list-dependencies fleximanage | grep mongo
   ```

4. **Increase startup timeout if needed:**
   Edit `/etc/systemd/system/fleximanage.service`:
   ```ini
   [Service]
   TimeoutStartSec=120
   ```
   Then reload:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart fleximanage
   ```

### PM2 Process Issues

1. **PM2 daemon not running:**
   ```bash
   pm2 ping
   # If fails, restart PM2
   pm2 kill
   pm2 start /root/fleximanage/backend/bin/www --name fleximanage-backend
   ```

2. **Application crashed:**
   ```bash
   pm2 list
   pm2 logs fleximanage-backend --err
   pm2 restart fleximanage-backend
   ```

3. **Memory leaks:**
   ```bash
   pm2 monit
   # Check memory usage in real-time
   
   # Restart if needed
   pm2 restart fleximanage-backend
   ```

### Port Already in Use

1. **Check what's using the port:**
   ```bash
   ss -tlnp | grep :3443
   ss -tlnp | grep :3002
   ```

2. **Kill conflicting process:**
   ```bash
   # Find process ID
   lsof -ti:3443
   
   # Kill process
   kill -9 $(lsof -ti:3443)
   ```

3. **Restart service:**
   ```bash
   sudo systemctl restart fleximanage
   ```

### Database Connection Issues

1. **Check MongoDB replica set status:**
   ```bash
   mongosh --port 27017 --eval 'rs.status()'
   ```

2. **Verify connection string:**
   ```bash
   grep -i mongodb /root/fleximanage/backend/configs.js
   ```

3. **Test MongoDB connection:**
   ```bash
   mongosh --port 27017 --eval 'db.runCommand({ping: 1})'
   ```

4. **Check Redis connection:**
   ```bash
   redis-cli ping
   ```

### Application Errors

1. **Check application logs:**
   ```bash
   pm2 logs fleximanage-backend
   tail -f /root/fleximanage/logs/app.log
   ```

2. **Check for missing dependencies:**
   ```bash
   cd /root/fleximanage/backend
   npm install
   ```

3. **Verify configuration files:**
   ```bash
   ls -l /root/fleximanage/backend/configs.js
   node -e "console.log(require('/root/fleximanage/backend/configs.js')())"
   ```

### High CPU or Memory Usage

1. **Check resource usage:**
   ```bash
   pm2 monit
   top -p $(pgrep -f fleximanage-backend)
   ```

2. **Restart application:**
   ```bash
   pm2 restart fleximanage-backend
   ```

3. **Check for memory leaks:**
   ```bash
   pm2 logs fleximanage-backend | grep -i "memory\|heap"
   ```

## Uninstall

### Remove Systemd Service

```bash
# Run setup script with REMOVE=1
sudo bash scripts/setup_fleximanage_systemd.sh REMOVE=1

# This will:
# 1. Stop the FlexiManage service
# 2. Disable auto-start
# 3. Stop and delete PM2 processes
# 4. Remove service unit file
# 5. Reload systemd daemon
```

### Manual Removal (if needed)

```bash
# Stop and disable service
sudo systemctl stop fleximanage
sudo systemctl disable fleximanage

# Stop PM2 processes
pm2 stop fleximanage-backend
pm2 delete fleximanage-backend
pm2 kill

# Remove service file
sudo rm -f /etc/systemd/system/fleximanage.service

# Reload systemd
sudo systemctl daemon-reload
```

### Keep Data (Optional)

Application data is preserved after uninstalling the service. To remove all data:

```bash
# WARNING: This deletes all application data!
sudo rm -rf /root/fleximanage/logs/*.log
sudo rm -rf /root/.pm2/logs/*
```

## Advanced Operations

### Update FlexiManage

```bash
# Pull latest changes
cd /root/fleximanage
git pull origin main

# Install new dependencies
cd backend
npm install

# Restart service
sudo systemctl restart fleximanage

# Verify
pm2 logs fleximanage-backend
```

### Change Node.js Version

If you upgrade Node.js via NVM:

1. **Update service file:**
   ```bash
   sudo nano /etc/systemd/system/fleximanage.service
   ```
   
   Update paths:
   ```ini
   Environment="PATH=/root/.nvm/versions/node/v<NEW_VERSION>/bin:..."
   ExecStart=/root/.nvm/versions/node/v<NEW_VERSION>/bin/pm2 ...
   ```

2. **Reload and restart:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart fleximanage
   ```

### Monitor with PM2 Ecosystem File

Create `/root/fleximanage/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'fleximanage-backend',
    script: './backend/bin/www',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/root/fleximanage/logs/pm2-error.log',
    out_file: '/root/fleximanage/logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
```

Use ecosystem file:
```bash
pm2 start ecosystem.config.js
pm2 save
```

### Set Up PM2 Startup

For additional reliability:

```bash
# Generate startup script
pm2 startup systemd -u root --hp /root

# Save PM2 process list
pm2 save
```

### Performance Tuning

1. **Adjust PM2 max memory restart:**
   ```bash
   pm2 start bin/www --name fleximanage-backend --max-memory-restart 1G
   ```

2. **Enable PM2 monitoring:**
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 7
   ```

3. **Configure log rotation:**
   Create `/etc/logrotate.d/fleximanage`:
   ```
   /root/fleximanage/logs/*.log {
       daily
       missingok
       rotate 7
       compress
       delaycompress
       notifempty
       create 0644 root root
   }
   ```

## Service File Example

Complete systemd service unit file:

```ini
[Unit]
Description=FlexiManage SD-WAN Management Platform
Documentation=https://docs.flexiwan.com
After=network-online.target mongod-27017.service mongod-27018.service mongod-27019.service redis.service
Wants=network-online.target
Requires=mongod-27017.service mongod-27018.service mongod-27019.service redis.service

[Service]
Type=forking
User=root
Group=root
WorkingDirectory=/root/fleximanage/backend

# Environment variables
Environment="PATH=/root/.nvm/versions/node/v20.11.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="NODE_ENV=production"
Environment="PM2_HOME=/root/.pm2"

# Start FlexiManage using PM2
ExecStart=/root/.nvm/versions/node/v20.11.1/bin/pm2 start /root/fleximanage/backend/bin/www --name fleximanage-backend --update-env --no-autorestart
ExecReload=/root/.nvm/versions/node/v20.11.1/bin/pm2 reload fleximanage-backend
ExecStop=/root/.nvm/versions/node/v20.11.1/bin/pm2 stop fleximanage-backend

# Restart policy
Restart=on-failure
RestartSec=10

# Process management
PIDFile=/root/.pm2/pm2.pid
TimeoutStartSec=60
TimeoutStopSec=30

# Security settings
PrivateTmp=false
NoNewPrivileges=false

# File limits
LimitNOFILE=65536
LimitNPROC=65536

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=fleximanage

[Install]
WantedBy=multi-user.target
```

## References

- [FlexiManage Documentation](https://docs.flexiwan.com)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Systemd Service Configuration](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Node.js Production Best Practices](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)

## Notes

- This configuration uses PM2 for process management and automatic restarts
- The service runs as root to access NVM-installed Node.js
- For production environments, consider:
  - Using PM2 cluster mode for multi-core utilization
  - Setting up SSL certificates with Let's Encrypt
  - Configuring reverse proxy (nginx) for better security
  - Implementing proper logging and monitoring
  - Setting up backup strategies for MongoDB and Redis
  - Using PM2 Plus for advanced monitoring

## License

This configuration is part of the fleximanage project under GNU Affero General Public License.
