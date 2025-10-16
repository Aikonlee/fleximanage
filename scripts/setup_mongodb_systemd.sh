#!/bin/bash
set -euo pipefail

# MongoDB Replica Set Systemd Service Setup Script
# Creates systemd service units for MongoDB 3-node replica set with auto-start on boot

MONGO_VERSION="8.0.15"
MONGO_INSTALL_DIR="/opt/mongodb-${MONGO_VERSION}"
MONGO_BIN="/opt/mongodb-current/bin/mongod"
MONGOSH_BIN="/opt/mongodb-current/bin/mongosh"
DATA_BASE_DIR="/data/db"
REPLICA_SET_NAME="rs"
LOG_DIR="/var/log/mongodb"
RS_HOST="${MONGO_HOST:-127.0.0.1}"
OPLOG_SIZE_MB=${OPLOG_SIZE_MB:-256}
MONGODB_USER="mongodb"
MONGODB_GROUP="mongodb"

# Parse arguments
for arg in "$@"; do [[ "$arg" == *=* ]] && key="${arg%%=*}" && val="${arg#*=}" && export "$key"="$val"; done

REMOVE=${REMOVE:-0}
PORTS=(27017 27018 27019)

log(){ echo "[$(date +'%Y-%m-%dT%H:%M:%SZ')] $*"; }
error_exit(){ log "ERROR: $1"; exit 1; }

# Check root
[[ $(id -u) -ne 0 ]] && error_exit "Must run as root (sudo)"

# Check if MongoDB is installed
[[ ! -f "$MONGO_BIN" ]] && error_exit "MongoDB not found at $MONGO_BIN. Run install_mongodb_arm64.sh first."

if [[ "$REMOVE" == 1 ]]; then
    log "Removing MongoDB systemd services..."
    for port in "${PORTS[@]}"; do
        systemctl stop "mongod-${port}.service" 2>/dev/null || true
        systemctl disable "mongod-${port}.service" 2>/dev/null || true
        rm -f "/etc/systemd/system/mongod-${port}.service"
        log "Removed service for port $port"
    done
    systemctl daemon-reload
    log "MongoDB systemd services removed"
    exit 0
fi

log "=== MongoDB Replica Set Systemd Service Setup ==="
log "MongoDB Version: ${MONGO_VERSION}"
log "Replica Set: ${REPLICA_SET_NAME}"
log "Ports: ${PORTS[*]}"

# Ensure MongoDB user exists
if ! id "$MONGODB_USER" &>/dev/null; then
    log "Creating mongodb user..."
    useradd -r -s /bin/false -d /var/lib/mongodb -U mongodb
fi

# Create data directories and set permissions
log "Setting up data directories..."
mkdir -p "$LOG_DIR"
for port in "${PORTS[@]}"; do
    mkdir -p "${DATA_BASE_DIR}${port}"
    chown -R ${MONGODB_USER}:${MONGODB_GROUP} "${DATA_BASE_DIR}${port}"
done
chown -R ${MONGODB_USER}:${MONGODB_GROUP} "$LOG_DIR"

# Create systemd service unit for each MongoDB instance
log "Creating systemd service units..."
for port in "${PORTS[@]}"; do
    SERVICE_FILE="/etc/systemd/system/mongod-${port}.service"
    
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=MongoDB Database Server on port ${port}
Documentation=https://docs.mongodb.org/manual
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=${MONGODB_USER}
Group=${MONGODB_GROUP}

# PID file location
PIDFile=/run/mongodb/mongod-${port}.pid

# Start with config inline (fork mode)
ExecStart=${MONGO_BIN} \\
    --port=${port} \\
    --dbpath ${DATA_BASE_DIR}${port} \\
    --replSet ${REPLICA_SET_NAME} \\
    --bind_ip_all \\
    --oplogSize ${OPLOG_SIZE_MB} \\
    --wiredTigerCacheSizeGB 0.25 \\
    --pidfilepath /run/mongodb/mongod-${port}.pid \\
    --fork \\
    --logpath ${LOG_DIR}/mongod-${port}.log

# Graceful shutdown
ExecStop=/bin/kill -SIGTERM \$MAINPID
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
EOF

    log "Created service file: $SERVICE_FILE"
done

# Create PID directory
log "Creating PID directory..."
mkdir -p /run/mongodb
chown -R ${MONGODB_USER}:${MONGODB_GROUP} /run/mongodb

# Create systemd tmpfiles.d config to ensure PID directory persists across reboots
cat > /etc/tmpfiles.d/mongodb.conf <<EOF
# MongoDB runtime directory
d /run/mongodb 0755 ${MONGODB_USER} ${MONGODB_GROUP} -
EOF

log "Created tmpfiles.d configuration"

# Reload systemd
log "Reloading systemd daemon..."
systemctl daemon-reload

# Stop any running instances to ensure clean start
log "Stopping existing MongoDB instances..."
pids=$(pgrep -f "mongod.*--port=" || true)
if [[ -n "$pids" ]]; then
    log "Found running instances, stopping..."
    for pid in $pids; do
        kill -SIGTERM $pid 2>/dev/null || true
    done
    sleep 3
    # Force kill if still running
    pids=$(pgrep -f "mongod.*--port=" || true)
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
fi

# Enable and start services
log "Enabling and starting MongoDB services..."
for port in "${PORTS[@]}"; do
    SERVICE_NAME="mongod-${port}.service"
    
    # Enable service
    systemctl enable "$SERVICE_NAME"
    log "Enabled $SERVICE_NAME"
    
    # Start service
    systemctl start "$SERVICE_NAME"
    sleep 2
    
    # Check status
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log "✓ $SERVICE_NAME is running"
    else
        log "✗ $SERVICE_NAME failed to start"
        systemctl status "$SERVICE_NAME" --no-pager || true
    fi
done

# Wait for instances to be ready
log "Waiting for MongoDB instances to be ready..."
sleep 10

# Check if replica set is initialized
log "Checking replica set status..."
if [[ -f "$MONGOSH_BIN" ]]; then
    rs_status=$($MONGOSH_BIN --port 27017 --quiet --eval 'try { rs.status().ok } catch(e){ 0 }' 2>/dev/null || echo 0)
    
    if [[ "$rs_status" == "1" ]]; then
        log "✓ Replica set is already initialized"
        
        # Show replica set members
        log "Replica set members:"
        $MONGOSH_BIN --port 27017 --quiet --eval 'rs.status().members.forEach(m => print("  - " + m.name + " [" + m.stateStr + "]"))' 2>/dev/null || true
    else
        log "⚠ Replica set not initialized. To initialize, run:"
        log "  mongosh --port 27017 --eval 'rs.initiate({_id:\"${REPLICA_SET_NAME}\",members:[{_id:0,host:\"${RS_HOST}:27017\"},{_id:1,host:\"${RS_HOST}:27018\"},{_id:2,host:\"${RS_HOST}:27019\"}]})'"
    fi
else
    log "⚠ mongosh not found, skipping replica set check"
fi

# Show service status
log ""
log "=== Service Status ==="
systemctl status mongod-27017.service mongod-27018.service mongod-27019.service --no-pager || true

# Show summary
log ""
log "=== Setup Complete ==="
log "MongoDB replica set systemd services created and enabled"
log "Services: mongod-27017.service, mongod-27018.service, mongod-27019.service"
log ""
log "Useful commands:"
log "  systemctl status mongod-27017    # Check service status"
log "  systemctl restart mongod-27017   # Restart a service"
log "  journalctl -u mongod-27017 -f    # View logs"
log "  mongosh --port 27017              # Connect to MongoDB"
log ""
log "To remove services, run: sudo bash $0 REMOVE=1"
exit 0
