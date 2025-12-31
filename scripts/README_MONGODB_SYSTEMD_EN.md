# MongoDB Replica Set Boot Auto-Start Configuration

This document explains how to configure systemd services for MongoDB replica set auto-start on system boot.

## Table of Contents

- [Quick Start](#quick-start)
- [Service Management](#service-management)
- [Configuration Details](#configuration-details)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

## Quick Start

### Prerequisites

1. MongoDB 7.0.25 ARM64 already installed (via `install_mongodb_arm64.sh`)
2. Installation path: `/opt/mongodb-7.0.25` or `/opt/mongodb-current`
3. Root privileges (sudo)

### Install and Start Services

```bash
# Run setup script
sudo bash scripts/setup_mongodb_systemd.sh

# The script will:
# 1. Create 3 systemd service unit files (ports 27017, 27018, 27019)
# 2. Configure auto-start on boot
# 3. Start all MongoDB instances
# 4. Display service status
```

### Verify Installation

```bash
# Check if services are enabled for auto-start
systemctl is-enabled mongod-27017 mongod-27018 mongod-27019

# Check if services are running
systemctl is-active mongod-27017 mongod-27018 mongod-27019

# View detailed service status
systemctl status mongod-27017 mongod-27018 mongod-27019

# Check listening ports
ss -tlnp | grep :2701
```

## Service Management

### Start Services

```bash
# Start all services
sudo systemctl start mongod-27017 mongod-27018 mongod-27019

# Start a single service
sudo systemctl start mongod-27017
```

### Stop Services

```bash
# Stop all services
sudo systemctl stop mongod-27017 mongod-27018 mongod-27019

# Stop a single service
sudo systemctl stop mongod-27017
```

### Restart Services

```bash
# Restart all services
sudo systemctl restart mongod-27017 mongod-27018 mongod-27019

# Restart a single service
sudo systemctl restart mongod-27017
```

### Check Service Status

```bash
# Check all services
systemctl status mongod-27017 mongod-27018 mongod-27019

# Check a single service
systemctl status mongod-27017

# Check if service is running
systemctl is-active mongod-27017

# Check if service is enabled for auto-start
systemctl is-enabled mongod-27017
```

### View Logs

```bash
# View logs with journalctl (real-time)
journalctl -u mongod-27017 -f

# View recent logs
journalctl -u mongod-27017 -n 100

# View logs for all services
journalctl -u mongod-27017 -u mongod-27018 -u mongod-27019 -f

# View MongoDB log files directly
tail -f /var/log/mongodb/mongod-27017.log
tail -f /var/log/mongodb/mongod-27018.log
tail -f /var/log/mongodb/mongod-27019.log
```

### Enable/Disable Auto-Start

```bash
# Enable auto-start (already done by setup script)
sudo systemctl enable mongod-27017 mongod-27018 mongod-27019

# Disable auto-start
sudo systemctl disable mongod-27017 mongod-27018 mongod-27019

# Re-enable auto-start
sudo systemctl enable mongod-27017 mongod-27018 mongod-27019
```

## Configuration Details

### Service File Locations

```
/etc/systemd/system/mongod-27017.service
/etc/systemd/system/mongod-27018.service
/etc/systemd/system/mongod-27019.service
```

### Service Configuration

Each service is configured with:

- **Type**: `forking` (MongoDB daemonizes itself)
- **User**: `mongodb`
- **Group**: `mongodb`
- **PID File**: `/run/mongodb/mongod-<port>.pid`
- **Restart Policy**: `on-failure` (auto-restart on crash)
- **Restart Delay**: 10 seconds
- **File Limits**: 64000 open files and processes

### MongoDB Launch Parameters

```bash
/opt/mongodb-current/bin/mongod \
    --port=<27017|27018|27019> \
    --dbpath /data/db<port> \
    --replSet rs \
    --bind_ip_all \
    --oplogSize 256 \
    --wiredTigerCacheSizeGB 0.25 \
    --pidfilepath /run/mongodb/mongod-<port>.pid \
    --fork \
    --logpath /var/log/mongodb/mongod-<port>.log
```

### Data Directories

```
/data/db27017  # MongoDB instance on port 27017
/data/db27018  # MongoDB instance on port 27018
/data/db27019  # MongoDB instance on port 27019
```

### Log Files

```
/var/log/mongodb/mongod-27017.log
/var/log/mongodb/mongod-27018.log
/var/log/mongodb/mongod-27019.log
```

### PID Directory

The setup script creates `/etc/tmpfiles.d/mongodb.conf` to ensure the PID directory persists across reboots:

```
d /run/mongodb 0755 mongodb mongodb -
```

## Troubleshooting

### Service Won't Start

1. **Check service status and logs:**
   ```bash
   systemctl status mongod-27017
   journalctl -u mongod-27017 -n 50
   ```

2. **Check if port is already in use:**
   ```bash
   ss -tlnp | grep :27017
   ```

3. **Check data directory permissions:**
   ```bash
   ls -ld /data/db27017
   # Should be owned by mongodb:mongodb
   ```

4. **Check MongoDB binary:**
   ```bash
   ls -l /opt/mongodb-current/bin/mongod
   /opt/mongodb-current/bin/mongod --version
   ```

5. **Try starting manually:**
   ```bash
   sudo -u mongodb /opt/mongodb-current/bin/mongod \
       --port=27017 \
       --dbpath /data/db27017 \
       --replSet rs \
       --bind_ip_all \
       --oplogSize 256 \
       --wiredTigerCacheSizeGB 0.25 \
       --pidfilepath /run/mongodb/mongod-27017.pid \
       --fork \
       --logpath /var/log/mongodb/mongod-27017.log
   ```

### Service Fails on Boot

1. **Check systemd logs:**
   ```bash
   journalctl -b -u mongod-27017
   ```

2. **Verify PID directory exists:**
   ```bash
   ls -ld /run/mongodb
   # Should be created by tmpfiles.d
   ```

3. **Check if service is enabled:**
   ```bash
   systemctl is-enabled mongod-27017
   ```

### High Memory or CPU Usage

1. **Check resource usage:**
   ```bash
   ps aux | grep mongod
   top -p $(pgrep -d',' -f mongod)
   ```

2. **Adjust WiredTiger cache size:**
   Edit service files and change `--wiredTigerCacheSizeGB` value, then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart mongod-27017 mongod-27018 mongod-27019
   ```

3. **Monitor connections:**
   ```bash
   mongosh --port 27017 --eval 'db.serverStatus().connections'
   ```

### Replica Set Not Initialized

After starting services for the first time, initialize the replica set:

```bash
mongosh --port 27017 --eval '
rs.initiate({
  _id: "rs",
  members: [
    {_id: 0, host: "127.0.0.1:27017"},
    {_id: 1, host: "127.0.0.1:27018"},
    {_id: 2, host: "127.0.0.1:27019"}
  ]
})'
```

Check replica set status:

```bash
mongosh --port 27017 --eval 'rs.status()'
```

### Replica Set Member Down

1. **Check which member is down:**
   ```bash
   mongosh --port 27017 --eval 'rs.status().members.forEach(m => print(m.name + ": " + m.stateStr))'
   ```

2. **Restart the down member:**
   ```bash
   # If port 27018 is down
   sudo systemctl restart mongod-27018
   ```

3. **Check logs for errors:**
   ```bash
   journalctl -u mongod-27018 -n 100
   ```

### Disk Space Issues

1. **Check disk usage:**
   ```bash
   df -h /data
   du -sh /data/db2701*
   ```

2. **Check oplog size:**
   ```bash
   mongosh --port 27017 --eval 'db.getReplicationInfo()'
   ```

3. **Compact databases (if needed):**
   ```bash
   mongosh --port 27017 --eval 'db.runCommand({compact: "collection_name"})'
   ```

### Network Connectivity Issues

1. **Check firewall rules:**
   ```bash
   sudo ufw status
   sudo iptables -L -n | grep 2701
   ```

2. **Test connectivity between nodes:**
   ```bash
   telnet 127.0.0.1 27017
   nc -zv 127.0.0.1 27017
   ```

3. **Check bind address:**
   ```bash
   ss -tlnp | grep :2701
   # Should show 0.0.0.0 (all interfaces) or specific IP
   ```

## Uninstall

### Remove systemd Services

```bash
# Run setup script with REMOVE=1
sudo bash scripts/setup_mongodb_systemd.sh REMOVE=1

# This will:
# 1. Stop all MongoDB services
# 2. Disable auto-start
# 3. Remove service unit files
# 4. Reload systemd daemon
```

### Manual Removal (if needed)

```bash
# Stop and disable services
sudo systemctl stop mongod-27017 mongod-27018 mongod-27019
sudo systemctl disable mongod-27017 mongod-27018 mongod-27019

# Remove service files
sudo rm -f /etc/systemd/system/mongod-27017.service
sudo rm -f /etc/systemd/system/mongod-27018.service
sudo rm -f /etc/systemd/system/mongod-27019.service

# Remove tmpfiles.d configuration
sudo rm -f /etc/tmpfiles.d/mongodb.conf

# Reload systemd
sudo systemctl daemon-reload
```

### Keep Data (Optional)

Data directories are preserved after uninstalling services. To remove data:

```bash
# WARNING: This deletes all data!
sudo rm -rf /data/db27017 /data/db27018 /data/db27019
sudo rm -rf /var/log/mongodb/mongod-*.log
```

## Advanced Operations

### Change Replica Set Configuration

1. **Connect to primary:**
   ```bash
   mongosh --port 27017
   ```

2. **Get current configuration:**
   ```javascript
   cfg = rs.conf()
   ```

3. **Modify configuration:**
   ```javascript
   // Example: Change member priority
   cfg.members[0].priority = 2
   rs.reconfig(cfg)
   ```

### Add Monitoring

1. **Check replica lag:**
   ```bash
   mongosh --port 27017 --eval 'rs.printReplicationInfo()'
   mongosh --port 27017 --eval 'rs.printSecondaryReplicationInfo()'
   ```

2. **Monitor oplog window:**
   ```bash
   mongosh --port 27017 --eval 'db.getReplicationInfo()'
   ```

3. **Set up systemd notifications (optional):**
   Add to service files:
   ```ini
   [Service]
   NotifyAccess=all
   ```

### Backup and Restore

1. **Create backup:**
   ```bash
   # Stop service first
   sudo systemctl stop mongod-27017
   
   # Backup data directory
   sudo tar -czf mongodb-backup-$(date +%Y%m%d).tar.gz /data/db27017
   
   # Restart service
   sudo systemctl start mongod-27017
   ```

2. **Restore from backup:**
   ```bash
   # Stop service
   sudo systemctl stop mongod-27017
   
   # Restore data
   sudo rm -rf /data/db27017
   sudo tar -xzf mongodb-backup-YYYYMMDD.tar.gz -C /
   sudo chown -R mongodb:mongodb /data/db27017
   
   # Start service
   sudo systemctl start mongod-27017
   ```

## Service Configuration Example

Here's a complete example of a service unit file:

```ini
[Unit]
Description=MongoDB Database Server on port 27017
Documentation=https://docs.mongodb.org/manual
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=mongodb
Group=mongodb

# PID file location
PIDFile=/run/mongodb/mongod-27017.pid

# Start with config inline (fork mode)
ExecStart=/opt/mongodb-current/bin/mongod \
    --port=27017 \
    --dbpath /data/db27017 \
    --replSet rs \
    --bind_ip_all \
    --oplogSize 256 \
    --wiredTigerCacheSizeGB 0.25 \
    --pidfilepath /run/mongodb/mongod-27017.pid \
    --fork \
    --logpath /var/log/mongodb/mongod-27017.log

# Graceful shutdown
ExecStop=/bin/kill -SIGTERM $MAINPID
TimeoutStopSec=30

# Restart policy
Restart=on-failure
RestartSec=10

# Security settings
PrivateTmp=true
NoNewPrivileges=true

# File limits
LimitNOFILE=64000
LimitNPROC=64000

# Working directory
WorkingDirectory=/tmp

[Install]
WantedBy=multi-user.target
```

## References

- [MongoDB Documentation](https://docs.mongodb.org/manual)
- [Systemd Service Configuration](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [MongoDB Replication](https://docs.mongodb.org/manual/replication)
- [MongoDB Production Notes](https://docs.mongodb.org/manual/administration/production-notes)

## Notes

- This configuration is designed for development/testing environments
- For production use, consider:
  - Authentication and authorization (security.authorization)
  - TLS/SSL encryption (net.tls)
  - Proper backup strategy
  - Monitoring and alerting
  - Resource limits tuning
  - Network security (firewall rules)

## License

This configuration is part of the fleximanage project.
