#!/bin/bash
# Let's Encrypt certificate renewal hook for manage.miwide.com
# Certbot automatically renews Let's Encrypt certificates.
# This script installs the renewed certificate and private key into the deployed
# TLS directory (consistent with deploy/fleximanage-tls-hook) and restarts the
# staging systemd service.
#
# Install as a certbot deploy hook:
#   sudo certbot renew --cert-name manage.miwide.com \
#     --deploy-hook "/opt/fleximanage-stage/backend/bin/renew-cert.sh"

set -euo pipefail
umask 027

DOMAIN="manage.miwide.com"
CERT_DIR="/opt/fleximanage-stage/backend/bin/tls"
LE_LIVE_DIR="/etc/letsencrypt/live/${DOMAIN}"
TLS_GROUP="fleximanage"
SERVICE_NAME="fleximanage-staging.service"
LOG_FILE="/var/log/fleximanage-cert-renewal.log"

# Enforce root-only execution
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: $0 must be run as root" >&2
  exit 1
fi

log_message() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG_FILE"
}

log_message "Certificate renewal hook triggered for $DOMAIN"

# Verify Let's Encrypt certificate and private key exist
if [ ! -f "$LE_LIVE_DIR/fullchain.pem" ] || [ ! -f "$LE_LIVE_DIR/privkey.pem" ]; then
  log_message "ERROR: Let's Encrypt certificate or key not found in $LE_LIVE_DIR"
  exit 1
fi

# Install TLS files with least-privilege permissions matching deploy/fleximanage-tls-hook
install -d -m 750 -o root -g "$TLS_GROUP" "$CERT_DIR"
install -m 640 -o root -g "$TLS_GROUP" "$LE_LIVE_DIR/privkey.pem" "$CERT_DIR/domain.key"
install -m 644 -o root -g "$TLS_GROUP" "$LE_LIVE_DIR/fullchain.pem" "$CERT_DIR/certificate.pem"
log_message "Installed TLS certificate and key into $CERT_DIR"

# Log certificate expiry and issuer
EXPIRY_DATE="$(openssl x509 -in "$CERT_DIR/certificate.pem" -noout -enddate | cut -d= -f2)"
ISSUER="$(openssl x509 -in "$CERT_DIR/certificate.pem" -noout -issuer | cut -d= -f2-)"
log_message "Certificate in use: $DOMAIN | Expires: $EXPIRY_DATE | Issuer: $ISSUER"

# Restart the backend systemd service if active
log_message "Restarting $SERVICE_NAME..."
if systemctl try-restart "$SERVICE_NAME"; then
  log_message "$SERVICE_NAME restarted successfully. New certificate is now in use."
else
  log_message "ERROR: Failed to restart $SERVICE_NAME. Manual restart may be required."
  exit 1
fi

# Reload nginx if active (consistent with deploy/fleximanage-tls-hook)
if systemctl is-active --quiet nginx.service; then
  log_message "Reloading nginx.service..."
  if systemctl reload nginx.service; then
    log_message "nginx.service reloaded successfully."
  else
    log_message "ERROR: Failed to reload nginx.service."
    exit 1
  fi
fi

log_message "Certificate renewal hook completed successfully"
