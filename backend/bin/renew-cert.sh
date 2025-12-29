#!/bin/bash
# Self-signed certificate renewal script for manage.miwide.com
# This script renews the self-signed certificate annually
# Run manually or schedule with cron: 0 0 1 * * /path/to/renew-cert.sh

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/cert.manage.miwide.com" && pwd)"
DOMAIN="manage.miwide.com"
DAYS_VALID=365
LOG_FILE="/var/log/fleximanage-cert-renewal.log"

# Function to log messages
log_message() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_message "Starting certificate renewal for $DOMAIN"

# Check if certificate exists and when it expires
if [ -f "$CERT_DIR/certificate.pem" ]; then
  EXPIRY_DATE=$(openssl x509 -in "$CERT_DIR/certificate.pem" -noout -enddate | cut -d= -f2)
  EXPIRY_EPOCH=$(date -d "$EXPIRY_DATE" +%s)
  CURRENT_EPOCH=$(date +%s)
  DAYS_LEFT=$(( ($EXPIRY_EPOCH - $CURRENT_EPOCH) / 86400 ))
  
  log_message "Certificate expires in $DAYS_LEFT days ($EXPIRY_DATE)"
  
  if [ $DAYS_LEFT -gt 30 ]; then
    log_message "Certificate is still valid for more than 30 days. No renewal needed."
    exit 0
  fi
else
  log_message "Certificate not found at $CERT_DIR/certificate.pem"
fi

# Backup old certificate
if [ -f "$CERT_DIR/certificate.pem" ]; then
  BACKUP_DIR="$CERT_DIR/backups"
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/certificate-$(date +%Y%m%d-%H%M%S).pem"
  cp "$CERT_DIR/certificate.pem" "$BACKUP_FILE"
  log_message "Backed up old certificate to $BACKUP_FILE"
fi

# Generate new self-signed certificate
log_message "Generating new self-signed certificate valid for $DAYS_VALID days..."

cd "$CERT_DIR" || exit 1

openssl req -x509 -newkey rsa:2048 \
  -keyout domain.key \
  -out certificate.pem \
  -days $DAYS_VALID \
  -nodes \
  -subj "/CN=$DOMAIN/O=OpenSource-OpenNetworking/C=US" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN,IP:127.0.0.1" 2>&1 | tee -a "$LOG_FILE"

if [ $? -eq 0 ]; then
  log_message "Certificate generated successfully"
  
  # Restart the application to load new certificate
  log_message "Restarting fleximanage-backend service..."
  pm2 restart fleximanage-backend --update-env
  
  if [ $? -eq 0 ]; then
    log_message "Service restarted successfully. New certificate is now in use."
  else
    log_message "ERROR: Failed to restart service. Manual restart may be required."
    exit 1
  fi
else
  log_message "ERROR: Failed to generate certificate"
  exit 1
fi

log_message "Certificate renewal completed successfully"
