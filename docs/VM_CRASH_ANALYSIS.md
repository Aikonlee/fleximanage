# VM System Crash Analysis Report

**Date:** October 16, 2025, ~17:08 CST  
**System:** Oracle Cloud VM.Standard.A1.Flex (2 OCPU, 8 GiB RAM)  
**Location:** Tokyo Region (ap-tokyo-1)  
**Impact:** Complete VM freeze requiring manual restart via cloud console

---

## Executive Summary

The VM experienced a **system freeze due to memory exhaustion**, not an OOM killer event. The system became unresponsive and required a hard reboot. This is the **second similar incident** (first on Oct 13, 15:02 CST).

---

## Root Cause Analysis

### 1. Memory Pressure Evidence

**System Log (syslog):**
```
2025-10-13T15:02:31 systemd-journald[283]: Under memory pressure, flushing caches.
```

**Previous Boot Logs:**
- Journald logs end abruptly at `Oct 16 16:45:37` with SSH attacks
- No OOM killer messages found (system froze before kernel could react)
- System booted at `Oct 16 17:08:27` after manual restart

### 2. Current Memory Footprint (Post-Restart)

| Process | Memory Usage | % of RAM |
|---------|-------------|----------|
| VS Code Server (Extension Host) | 1.04 GB | 12.8% |
| Backend (Node.js) | 267 MB | 3.2% |
| MongoDB 27019 (PRIMARY) | 199 MB | 2.4% |
| MongoDB 27018 (SECONDARY) | 170 MB | 2.0% |
| MongoDB 27017 (SECONDARY) | 170 MB | 2.0% |
| VS Code Server (Main) | 124 MB | 1.5% |
| TypeScript Servers (3x) | ~88 MB each | ~3.0% total |
| **Total Top Processes** | **~2.3 GB** | **~28%** |

**Available Memory:** 5.4 GB / 7.7 GB (70%)  
**Note:** This is AFTER reboot with fresh caches.

### 3. Historical Pattern

**October 13, 2025:**
- `15:02:31` - Memory pressure warning
- `15:05:22` - System rebooted
- Result: 3-minute freeze before restart

**October 16, 2025:**
- `16:45:37` - Last log entry
- `17:08:27` - System back online
- Result: 22-minute freeze before restart

---

## Contributing Factors

### A. VS Code Remote Server
- Extension host consuming **1 GB+ RAM**
- Multiple TypeScript servers (3x ~88 MB each)
- File watcher, PTY host, markdown servers
- **Estimated total: 1.5-2 GB**

### B. MongoDB Replica Set
- 3 MongoDB instances (27017-27019)
- Each limited to 250 MB cache (`--wiredTigerCacheSizeGB 0.25`)
- Total memory: ~540 MB (actual usage)
- **Issue:** Cache limits are too small, causing disk I/O thrashing

### C. Node.js Backend
- FlexiManage backend: 267 MB
- Handling WebSocket connections, device stats, MongoDB queries
- No explicit heap size limits

### D. System Services
- PM2 daemon: 55 MB
- Redis: Not visible in top 15 (likely <50 MB)
- Oracle Cloud Agent (unified-monitoring-agent): 40 MB
- SSH brute-force attempts (continuous load)

### E. Memory Leak Indicators
**None found in logs**, but long-running processes may accumulate memory:
- VS Code server extensions
- Backend WebSocket connections
- MongoDB connection pools

---

## Timeline of Events (Oct 16)

```
16:23:25 - Oracle monitoring agent check (normal)
16:26:30 - Oracle monitoring agent check (normal)
16:31:17 - SSH session closed (session 16)
16:36:30 - Oracle monitoring agent check (normal)
16:43:27 - Monitoring agent config downloader started
16:43:33 - Config downloader finished
16:45:37 - Last log entry (SSH failed login attempt)
         - [SYSTEM FREEZE BEGINS]
17:08:27 - System boot begins (manual restart)
17:08:28 - Swap activated (1 GB)
17:08:28 - MongoDB replica set starting
17:08:29 - Services restored
17:11:00 - VS Code server reconnected
17:32:00 - Backend restarted, Home page deployed
```

---

## Risk Assessment

### Immediate Risks (HIGH)
1. **Production Service Downtime:** 22-minute outage on Oct 16
2. **Data Consistency:** MongoDB replica set may lose uncommitted writes
3. **User Experience:** Website unavailable during freeze
4. **Recurring Pattern:** 2 incidents in 3 days

### Medium-Term Risks (MEDIUM)
1. **Increased Frequency:** Memory pressure trending upward
2. **Longer Recovery:** Next incident may require longer downtime
3. **Data Corruption:** Risk of MongoDB data corruption during hard reboot

### Low Risks (LOW)
- No evidence of disk space issues (32% used)
- CPU usage acceptable (load avg 0.03-0.29)
- Network stable, no connectivity issues

---

## Preventive Measures (Recommendations)

### Immediate Actions (Priority 1)

#### 1. **Increase VM Memory to 12-16 GB**
```bash
# Oracle Cloud Console
# Instance Details → Edit → Memory: 12 GB
# Cost: ~$8-10/month increase
```
**Justification:**
- Current 8 GB insufficient for VS Code + MongoDB + Backend
- 12 GB provides 50% buffer
- 16 GB recommended for production stability

#### 2. **Configure Swap Space**
**Current:** 1 GB swap (activated at boot)  
**Recommended:** 4 GB swap for emergency buffer
```bash
sudo swapoff /swapfile
sudo dd if=/dev/zero of=/swapfile bs=1G count=4
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# Verify
free -h
```

#### 3. **Set Memory Limits for Backend**
```bash
# Edit PM2 ecosystem config
pm2 stop fleximanage-backend
pm2 delete fleximanage-backend

# Start with max heap size
node --max-old-space-size=512 /root/fleximanage/backend/bin/www
# Or via PM2:
pm2 start /root/fleximanage/backend/bin/www \
  --name fleximanage-backend \
  --node-args="--max-old-space-size=512"
```

#### 4. **Optimize MongoDB Cache**
```bash
# Edit /etc/systemd/system/mongodb-rs-*.service files
# Change wiredTigerCacheSizeGB from 0.25 to 0.5 (512 MB per instance)
sudo systemctl daemon-reload
sudo systemctl restart mongodb-rs-*
```

### Short-Term Actions (Priority 2)

#### 5. **Enable System Monitoring**
```bash
# Install monitoring tools
sudo apt install -y sysstat

# Enable automatic memory monitoring
cat > /etc/cron.d/memory-monitor <<'EOF'
*/5 * * * * root free -h >> /var/log/memory-usage.log
*/5 * * * * root ps aux --sort=-%mem | head -20 >> /var/log/top-processes.log
EOF
```

#### 6. **Configure OOM Killer Protection**
```bash
# Protect critical services from OOM killer
# MongoDB primary
echo -1000 > /proc/$(pgrep -f "mongod.*27019")/oom_score_adj

# Backend
echo -500 > /proc/$(pgrep -f "backend/bin/www")/oom_score_adj

# Make permanent in systemd service files
```

#### 7. **Set Up Memory Alerts**
- Configure Oracle Cloud Monitoring with memory threshold alarms
- Alert at 85% memory usage
- Email/SMS notification to admin

### Long-Term Actions (Priority 3)

#### 8. **Optimize VS Code Usage**
- Disable unused VS Code extensions
- Use local VS Code with remote file editing instead of full remote server
- Consider using lightweight editors (vim/nano) for quick edits

#### 9. **Backend Memory Profiling**
```bash
# Install heapdump for Node.js
cd /root/fleximanage/backend
npm install heapdump --save-dev

# Enable heap snapshot on signal
# Add to backend code:
# process.on('SIGUSR2', () => {
#   require('heapdump').writeSnapshot();
# });
```

#### 10. **MongoDB Optimization**
- Consider single MongoDB instance instead of 3-node replica set
  - Saves ~340 MB memory
  - Acceptable for development environment
- Or upgrade to dedicated MongoDB server
- Enable compression for oplog

---

## Monitoring Plan

### Real-Time Monitoring
```bash
# Add to crontab
*/1 * * * * root [ $(free | awk '/Mem:/ {print $3/$2 * 100}' | cut -d. -f1) -gt 85 ] && echo "HIGH MEMORY: $(free -h)" | mail -s "Memory Alert" admin@example.com
```

### Daily Reports
```bash
# Daily memory summary
0 9 * * * root sar -r 1 1 | mail -s "Daily Memory Report" admin@example.com
```

### Log Rotation
```bash
# Prevent log files from filling disk
sudo logrotate -f /etc/logrotate.conf
```

---

## Testing Recommendations

### 1. Memory Stress Test
```bash
# Install stress tool
sudo apt install stress-ng

# Test memory limits
stress-ng --vm 2 --vm-bytes 2G --timeout 60s

# Monitor behavior
watch -n 1 free -h
```

### 2. MongoDB Performance Test
```bash
# Test MongoDB with limited cache
mongo --port 27019 --eval "
  db.devices.find().explain('executionStats')
"
```

### 3. Backend Load Test
```bash
# Install Apache Bench
sudo apt install apache2-utils

# Test backend under load
ab -n 1000 -c 10 https://localhost:3443/
```

---

## Success Criteria

1. **No crashes for 30 days** after implementing memory increase
2. **Memory usage stays below 75%** under normal load
3. **Swap usage remains < 10%** (only emergency buffer)
4. **Response time < 500ms** for web interface
5. **MongoDB cache hit ratio > 90%**

---

## References

- System logs: `/var/log/syslog`, `journalctl`
- MongoDB logs: `/var/log/mongodb/mongod-*.log`
- PM2 logs: `~/.pm2/logs/`
- Memory analysis: `free -h`, `ps aux --sort=-%mem`

---

## Conclusion

The VM crash was caused by **memory exhaustion** due to:
1. **Insufficient RAM** (8 GB) for combined workload
2. **VS Code remote server** (largest consumer at 1+ GB)
3. **3-node MongoDB replica set** competing for memory
4. **No memory limits** on Node.js backend

**Primary recommendation:** Upgrade VM to **12-16 GB RAM** immediately to prevent recurring crashes.

**Secondary recommendation:** Implement **swap increase** and **process memory limits** as temporary mitigation.

**Long-term:** Consider **dedicated MongoDB server** or **single instance** for dev environment to free up 340 MB RAM.

---

**Report Generated:** October 16, 2025, 18:00 CST  
**Analyst:** System Administrator  
**Status:** ACTION REQUIRED - Pending Memory Upgrade
