# SSL/TLS Certificate Management

## Current Setup

The application uses **self-signed SSL certificates** for HTTPS at `https://manage.miwide.com:3443/`.

### Certificate Details
- **Domain**: manage.miwide.com
- **Valid Until**: December 29, 2026
- **Location**: `/root/fleximanage/backend/bin/cert.manage.miwide.com/`
  - Private Key: `domain.key`
  - Certificate: `certificate.pem`
- **Includes SANs (Subject Alternative Names)**:
  - DNS: manage.miwide.com
  - DNS: *.manage.miwide.com
  - IP: 127.0.0.1

## Browser Certificate Warnings

When accessing https://manage.miwide.com:3443/, browsers will show a self-signed certificate warning because:
1. The certificate is self-signed (not issued by a trusted CA)
2. The certificate is for testing/development purposes

### How to Proceed (for Users/Developers)

**Chrome/Edge/Firefox**:
1. Click "Advanced" or "More" on the warning page
2. Click "Proceed to manage.miwide.com (unsafe)" or similar button
3. The site will load normally

The warning appears every time because it's a self-signed certificate, which is expected behavior.

## Certificate Renewal

### Manual Renewal
To manually renew the certificate, run:
```bash
/root/fleximanage/backend/bin/renew-cert.sh
```

This script will:
- Check if the certificate is expiring within 30 days
- Backup the old certificate to `cert.manage.miwide.com/backups/`
- Generate a new self-signed certificate valid for 365 days
- Restart the application to load the new certificate
- Log all actions to `/var/log/fleximanage-cert-renewal.log`

### Automatic Renewal
A cron job is configured to check for renewal monthly:
```bash
0 0 1 * * /root/fleximanage/backend/bin/renew-cert.sh
```

The script only renews if the certificate expires within 30 days, so it's safe to run monthly.

### Verify Renewal
Check the log file:
```bash
tail -f /var/log/fleximanage-cert-renewal.log
```

## For Production (With Real Certificate Authority)

If manage.miwide.com becomes a publicly accessible domain:

### Option 1: Let's Encrypt (Recommended, Free)
```bash
certbot certonly --standalone -d manage.miwide.com --email admin@miwide.com
ln -s /etc/letsencrypt/live/manage.miwide.com/privkey.pem backend/bin/cert.manage.miwide.com/domain.key
ln -s /etc/letsencrypt/live/manage.miwide.com/fullchain.pem backend/bin/cert.manage.miwide.com/certificate.pem
```

Update cron to renew Let's Encrypt certificates:
```bash
0 0 1 * * certbot renew --quiet && pm2 restart fleximanage-backend
```

### Option 2: Commercial Certificate
Replace `domain.key` and `certificate.pem` with certificates from your CA.

## Troubleshooting

### Certificate Not Updating After Renewal
Ensure the application restarted successfully:
```bash
pm2 status fleximanage-backend
pm2 logs fleximanage-backend
```

### Verify Certificate in Use
```bash
echo | openssl s_client -connect manage.miwide.com:3443 2>/dev/null | openssl x509 -text
```

### Check Certificate Expiry
```bash
openssl x509 -in /root/fleximanage/backend/bin/cert.manage.miwide.com/certificate.pem -noout -enddate
```

## Files

- **Certificate Script**: `backend/bin/renew-cert.sh`
- **Certificate Directory**: `backend/bin/cert.manage.miwide.com/`
- **Logs**: `/var/log/fleximanage-cert-renewal.log`
- **Configuration**: `backend/configs.js` (lines 126-131)
