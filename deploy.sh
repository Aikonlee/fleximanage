#!/bin/bash
# Deploy script for fleximanage frontend
# Builds the frontend and deploys static files to backend/public
# Then restarts the backend service

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BUILD_DIR="$FRONTEND_DIR/build"
BACKEND_PUBLIC_DIR="$PROJECT_ROOT/backend/public"

echo "================================================"
echo "FlexiManage Frontend Build & Deployment"
echo "================================================"
echo ""
echo "Project Root: $PROJECT_ROOT"
echo "Frontend Dir: $FRONTEND_DIR"
echo "Build Dir: $BUILD_DIR"
echo "Backend Public Dir: $BACKEND_PUBLIC_DIR"
echo ""

# Step 1: Build frontend
echo "[1/4] Building frontend..."
cd "$FRONTEND_DIR"

if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found in $FRONTEND_DIR"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install
fi

echo "  Running build..."
npm run build

if [ ! -d "$BUILD_DIR" ]; then
  echo "ERROR: Build failed - build directory not created"
  exit 1
fi

BUILD_SIZE=$(du -sh "$BUILD_DIR" | cut -f1)
echo "  ✓ Build successful (Size: $BUILD_SIZE)"
echo ""

# Step 2: Remove old public directory
echo "[2/4] Cleaning backend public directory..."
if [ -d "$BACKEND_PUBLIC_DIR" ]; then
  rm -rf "$BACKEND_PUBLIC_DIR"
  echo "  ✓ Old public directory removed"
else
  echo "  ℹ No existing public directory"
fi
echo ""

# Step 3: Copy new build to backend/public
echo "[3/4] Deploying static files..."
cp -r "$BUILD_DIR" "$BACKEND_PUBLIC_DIR"

if [ ! -d "$BACKEND_PUBLIC_DIR" ]; then
  echo "ERROR: Failed to copy build directory"
  exit 1
fi

DEPLOYED_SIZE=$(du -sh "$BACKEND_PUBLIC_DIR" | cut -f1)
FILE_COUNT=$(find "$BACKEND_PUBLIC_DIR" -type f | wc -l)
echo "  ✓ Static files deployed"
echo "    Size: $DEPLOYED_SIZE"
echo "    Files: $FILE_COUNT"
echo ""

# Step 4: Restart backend service
echo "[4/4] Restarting backend service..."
cd "$PROJECT_ROOT"

# Check if pm2 is installed
if ! command -v pm2 &> /dev/null; then
  echo "WARNING: pm2 not found, skipping service restart"
  echo "  To restart manually, run: pm2 restart fleximanage-backend --update-env"
else
  # Check if service exists
  if pm2 list | grep -q "fleximanage-backend"; then
    pm2 restart fleximanage-backend --update-env
    sleep 2
    
    # Verify service is running
    SERVICE_STATUS=$(pm2 status fleximanage-backend 2>/dev/null | grep "online" | wc -l)
    if [ "$SERVICE_STATUS" -gt 0 ]; then
      echo "  ✓ Backend service restarted successfully"
    else
      echo "  WARNING: Backend service status could not be verified"
      pm2 status | grep fleximanage-backend
    fi
  else
    echo "  ℹ Service not found in PM2"
    echo "    To start the service, run: pm2 start ecosystem.config.js"
  fi
fi

echo ""
echo "================================================"
echo "✓ Deployment completed successfully!"
echo "================================================"
echo ""
echo "Frontend is now available at:"
echo "  https://manage.miwide.com:3443/"
echo ""
echo "To view logs:"
echo "  pm2 logs fleximanage-backend"
echo ""
