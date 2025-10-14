#!/bin/bash
set -euo pipefail

# FlexiManage Systemd Service Setup Script
# Creates systemd service unit for FlexiManage backend with PM2 process manager
# Ensures auto-start on system boot

FLEXIMANAGE_DIR="/root/fleximanage"
BACKEND_DIR="${FLEXIMANAGE_DIR}/backend"
PM2_BIN="/root/.nvm/versions/node/v20.11.1/bin/pm2"
NODE_BIN="/root/.nvm/versions/node/v20.11.1/bin/node"
NPM_BIN="/root/.nvm/versions/node/v20.11.1/bin/npm"
SERVICE_NAME="fleximanage"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
PM2_HOME="/root/.pm2"
PM2_APP_NAME="fleximanage-backend"

# Parse arguments
for arg in "$@"; do [[ "$arg" == *=* ]] && key="${arg%%=*}" && val="${arg#*=}" && export "$key"="$val"; done

REMOVE=${REMOVE:-0}

log(){ echo "[$(date +'%Y-%m-%dT%H:%M:%SZ')] $*"; }
error_exit(){ log "ERROR: $1"; exit 1; }

# Check root privileges
[[ $(id -u) -ne 0 ]] && error_exit "Must run as root (sudo)"

# Check if FlexiManage directory exists
[[ ! -d "$BACKEND_DIR" ]] && error_exit "FlexiManage backend directory not found at $BACKEND_DIR"

# Check if PM2 is installed
[[ ! -f "$PM2_BIN" ]] && error_exit "PM2 not found at $PM2_BIN. Install PM2: npm install -g pm2"

# Check if Node.js is installed
[[ ! -f "$NODE_BIN" ]] && error_exit "Node.js not found at $NODE_BIN"

if [[ "$REMOVE" == 1 ]]; then
    log "Removing FlexiManage systemd service..."
    
    # Stop the service
    systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
    systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
    
    # Stop PM2 processes as root
    log "Stopping PM2 processes..."
    $PM2_BIN stop $PM2_APP_NAME 2>/dev/null || true
    $PM2_BIN delete $PM2_APP_NAME 2>/dev/null || true
    $PM2_BIN kill 2>/dev/null || true
    
    # Remove service file
    rm -f "$SERVICE_FILE"
    log "Removed service file: $SERVICE_FILE"
    
    # Reload systemd
    systemctl daemon-reload
    log "FlexiManage systemd service removed"
    exit 0
fi

log "=== FlexiManage Systemd Service Setup ==="
log "FlexiManage Directory: ${FLEXIMANAGE_DIR}"
log "Backend Directory: ${BACKEND_DIR}"
log "PM2 Binary: ${PM2_BIN}"
log "Node.js Binary: ${NODE_BIN}"

# Ensure dependencies are installed
log "Checking backend dependencies..."
if [[ ! -d "${BACKEND_DIR}/node_modules" ]]; then
    log "Installing backend dependencies..."
    cd "$BACKEND_DIR"
    $NPM_BIN install
fi

# Stop any existing PM2 processes
log "Stopping existing PM2 processes..."
$PM2_BIN stop $PM2_APP_NAME 2>/dev/null || true
$PM2_BIN delete $PM2_APP_NAME 2>/dev/null || true

# Create systemd service unit file
log "Creating systemd service unit..."
cat > "$SERVICE_FILE" <<EOF
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
WorkingDirectory=${BACKEND_DIR}

# Environment variables
Environment="PATH=/root/.nvm/versions/node/v20.11.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="NODE_ENV=production"
Environment="PM2_HOME=${PM2_HOME}"

# Start FlexiManage using PM2
ExecStart=${PM2_BIN} start ${BACKEND_DIR}/bin/www --name ${PM2_APP_NAME} --update-env --no-autorestart
ExecReload=${PM2_BIN} reload ${PM2_APP_NAME}
ExecStop=${PM2_BIN} stop ${PM2_APP_NAME}

# Restart policy
Restart=on-failure
RestartSec=10

# Process management
PIDFile=${PM2_HOME}/pm2.pid
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
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

log "Created service file: $SERVICE_FILE"

# Reload systemd daemon
log "Reloading systemd daemon..."
systemctl daemon-reload

# Enable service for auto-start
log "Enabling service for auto-start on boot..."
systemctl enable "${SERVICE_NAME}.service"

# Start the service
log "Starting FlexiManage service..."
systemctl start "${SERVICE_NAME}.service"

# Wait for service to start
sleep 5

# Check service status
if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
    log "✓ FlexiManage service is running"
else
    log "✗ FlexiManage service failed to start"
    log "Checking logs..."
    journalctl -u "${SERVICE_NAME}.service" -n 50 --no-pager || true
    error_exit "Service failed to start. Check logs with: journalctl -u ${SERVICE_NAME}.service -f"
fi

# Display PM2 status
log ""
log "PM2 Process Status:"
$PM2_BIN list || true

# Show service status
log ""
log "=== Service Status ==="
systemctl status "${SERVICE_NAME}.service" --no-pager || true

# Show summary
log ""
log "=== Setup Complete ==="
log "FlexiManage systemd service created and enabled"
log "Service: ${SERVICE_NAME}.service"
log "Backend Directory: ${BACKEND_DIR}"
log "PM2 Home: ${PM2_HOME}"
log ""
log "Useful Commands:"
log "  systemctl status ${SERVICE_NAME}      # Check service status"
log "  systemctl restart ${SERVICE_NAME}     # Restart service"
log "  systemctl stop ${SERVICE_NAME}        # Stop service"
log "  systemctl start ${SERVICE_NAME}       # Start service"
log "  journalctl -u ${SERVICE_NAME} -f      # View logs (systemd)"
log "  pm2 list                               # List PM2 processes"
log "  pm2 logs ${PM2_APP_NAME}              # View application logs"
log "  pm2 monit                              # Monitor processes"
log ""
log "FlexiManage should be accessible at:"
log "  HTTPS: https://manage.miwide.com:3443"
log "  HTTP:  http://manage.miwide.com:3002"
log ""
log "To remove service, run: sudo bash $0 REMOVE=1"
exit 0
