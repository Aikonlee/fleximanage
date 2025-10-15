#!/bin/bash

# Tunnels Page Deployment Verification
# Verifies all components are correctly deployed

echo "╔═══════════════════════════════════════════╗"
echo "║  Tunnels Page Deployment Verification    ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

SUCCESS_COUNT=0
FAIL_COUNT=0

# Function to check and report
check() {
    local name=$1
    local command=$2
    echo -n "✓ Checking $name... "
    if eval "$command" &>/dev/null; then
        echo "✅ OK"
        ((SUCCESS_COUNT++))
        return 0
    else
        echo "❌ FAIL"
        ((FAIL_COUNT++))
        return 1
    fi
}

echo "📁 File Checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check "Tunnels.js exists" "test -f /root/fleximanage/frontend/src/pages/Tunnels.js"
check "Tunnels.js backup exists" "test -f /root/fleximanage/frontend/src/pages/Tunnels.js.backup"
check "Build file exists" "test -f /root/fleximanage/frontend/build/static/js/main.e2476fa8.js"
check "Tunnels route exists" "test -f /root/fleximanage/backend/routes/tunnels.js"
echo ""

echo "📊 Code Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check "Tunnels.js imports api" "grep -q 'api.get' /root/fleximanage/frontend/src/pages/Tunnels.js"
check "Tunnels.js has fetchTunnelsAndDevices" "grep -q 'fetchTunnelsAndDevices' /root/fleximanage/frontend/src/pages/Tunnels.js"
check "Tunnels.js has handleDeleteTunnel" "grep -q 'handleDeleteTunnel' /root/fleximanage/frontend/src/pages/Tunnels.js"
check "Build contains Tunnels component" "grep -q 'Tunnels' /root/fleximanage/frontend/build/static/js/main.*.js"
echo ""

echo "🗄️  Database Checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check "MongoDB is running" "pgrep mongod"
check "flexiwan database exists" "mongosh --quiet flexiwan --eval 'db.getName()' | grep -q 'flexiwan'"
check "tunnels collection exists" "mongosh --quiet flexiwan --eval 'db.getCollectionNames()' | grep -q 'tunnels'"

TUNNEL_COUNT=$(mongosh --quiet flexiwan --eval "db.tunnels.find({isActive: true}).count()" 2>/dev/null)
echo -n "✓ Checking active tunnels count... "
if [ "$TUNNEL_COUNT" -gt 0 ]; then
    echo "✅ OK ($TUNNEL_COUNT tunnels)"
    ((SUCCESS_COUNT++))
else
    echo "⚠️  WARNING (0 tunnels)"
fi
echo ""

echo "🚀 Backend Service Checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check "PM2 is running" "pgrep -f PM2"
check "Backend service running" "pm2 list | grep -q 'fleximanage'"
check "Backend listening on 3443" "netstat -tln | grep -q ':3443'"
echo ""

echo "📝 Documentation Checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check "User guide exists" "test -f /root/fleximanage/docs/TUNNELS_PAGE_GUIDE.md"
check "Summary exists" "test -f /root/fleximanage/docs/TUNNELS_PAGE_SUMMARY.md"
check "Quick reference exists" "test -f /root/fleximanage/docs/TUNNELS_PAGE_QUICKREF.md"
check "Test script exists" "test -f /root/fleximanage/scripts/test_tunnels_api.sh"
check "Test script is executable" "test -x /root/fleximanage/scripts/test_tunnels_api.sh"
echo ""

echo "╔═══════════════════════════════════════════╗"
echo "║  Verification Summary                     ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "✅ Passed: $SUCCESS_COUNT"
echo "❌ Failed: $FAIL_COUNT"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo "🎉 All checks passed! Tunnels page is ready."
    echo ""
    echo "Next steps:"
    echo "1. Open browser: https://manage.miwide.com:3443/tunnels"
    echo "2. Verify tunnels display correctly"
    echo "3. Test refresh and delete functions"
    echo ""
    echo "📚 Documentation:"
    echo "   User Guide: /root/fleximanage/docs/TUNNELS_PAGE_GUIDE.md"
    echo "   Quick Ref:  /root/fleximanage/docs/TUNNELS_PAGE_QUICKREF.md"
    exit 0
else
    echo "⚠️  Some checks failed. Please review above."
    exit 1
fi
