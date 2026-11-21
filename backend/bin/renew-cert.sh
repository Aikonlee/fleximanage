#!/bin/bash
# Let's Encrypt certificate renewal hook for manage.miwide.com
# Certbot automatically renews Let's Encrypt certificates
# This script is called by certbot post-renewal to restart the application
# 
# Install as certbot renewal hook:
# sudo certbot install --cert-name manage.miwide.com \
#   --post-hook "/root/fleximanage/backend/bin/renew-cert.sh"

DOMAIN="manage.miwide.com"
CERT_DIR="/root/fleximanage/backend/bin/cert.manage.miwide.com"
LE_LIVE_DIR="/etc/letsencrypt/live/manage.miwide.com"
LOG_FILE="/var/log/fleximanage-cert-renewal.log"

# Function to log messages
log_message() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_message "Certificate renewal hook triggered for $DOMAIN"

# Verify Let's Encrypt certificate exists
if [ ! -f "$LE_LIVE_DIR/fullchain.pem" ]; then
  log_message "ERROR: Let's Encrypt certificate not found at $LE_LIVE_DIR/fullchain.pem"
  exit 1
fi

# Check if symlinks are correctly set up
if [ ! -L "$CERT_DIR/certificate.pem" ] || [ ! -L "$CERT_DIR/domain.key" ]; then
  log_message "Setting up symlinks to Let's Encrypt certificates..."
  cd "$CERT_DIR" || exit 1
  
  # Backup old certificates if they exist
  if [ -f "certificate.pem" ] && [ ! -L "certificate.pem" ]; then
    BACKUP_DIR="backups"
    mkdir -p "$BACKUP_DIR"
    cp certificate.pem "$BACKUP_DIR/certificate-$(date +%Y%m%d-%H%M%S).pem"
    log_message "Backed up old certificate"
  fi
  
  # Create symlinks
  ln -sf "$LE_LIVE_DIR/privkey.pem" domain.key
  ln -sf "$LE_LIVE_DIR/fullchain.pem" certificate.pem
  log_message "Symlinks created/updated"
fi

# Get certificate expiry info
EXPIRY_DATE=$(openssl x509 -in "$LE_LIVE_DIR/fullchain.pem" -noout -enddate | cut -d= -f2)
ISSUER=$(openssl x509 -in "$LE_LIVE_DIR/fullchain.pem" -noout -issuer | cut -d= -f2-)
log_message "Certificate in use: $DOMAIN | Expires: $EXPIRY_DATE | Issuer: $ISSUER"

# Restart the application to load new certificate
log_message "Restarting fleximanage-backend service..."
pm2 restart fleximanage-backend --update-env

if [ $? -eq 0 ]; then
  log_message "Service restarted successfully. New certificate is now in use."
else
  log_message "ERROR: Failed to restart service. Manual restart may be required."
  exit 1
fi

log_message "Certificate renewal hook completed successfully"
