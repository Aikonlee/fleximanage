#!/bin/bash

# Tunnels Page API Test Script
# Tests the API endpoints used by the Tunnels page

BASE_URL="https://manage.miwide.com:3443/api"
TOKEN=$(cat /root/fleximanage/docs/test_token.txt 2>/dev/null || echo "YOUR_TOKEN_HERE")

echo "================================"
echo "Tunnels Page API Test"
echo "================================"
echo ""

# Test 1: Get Devices
echo "Test 1: GET /devices?response=detailed"
echo "---------------------------------------"
curl -s -k -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/devices?response=detailed" | jq -r '.[] | {id: ._id, name: .name, hostname: .hostname, interfaceCount: (.interfaces | length)}' | head -20
echo ""

# Test 2: Get Tunnels
echo "Test 2: GET /tunnels"
echo "--------------------"
TUNNELS=$(curl -s -k -H "Authorization: Bearer $TOKEN" "$BASE_URL/tunnels")
echo "$TUNNELS" | jq -r '.[] | {id: ._id, num: .num, deviceA: .deviceA._id, deviceB: .deviceB._id, isActive: .isActive, status: .status}'
echo ""

# Test 3: Count Statistics
echo "Test 3: Calculate Statistics"
echo "-----------------------------"
TOTAL=$(echo "$TUNNELS" | jq '. | length')
CONNECTED=$(echo "$TUNNELS" | jq '[.[] | select(.isActive == true)] | length')
INACTIVE=$(echo "$TUNNELS" | jq '[.[] | select(.isActive == false)] | length')

echo "Total Tunnels: $TOTAL"
echo "Connected: $CONNECTED"
echo "Inactive: $INACTIVE"
echo ""

# Test 4: Interface Resolution
echo "Test 4: Interface Name Resolution"
echo "----------------------------------"
echo "$TUNNELS" | jq -r '.[] | select(.num == 1) | "Tunnel #\(.num): \(.deviceA.name) (\(.interfaceADetails.name)) ↔ \(.deviceB.name) (\(.interfaceBDetails.name))"'
echo ""

# Test 5: Tunnel Details
echo "Test 5: Full Tunnel Details (First Tunnel)"
echo "--------------------------------------------"
echo "$TUNNELS" | jq '.[0] | {
  id: .num,
  deviceA: .deviceA.name,
  interfaceA: .interfaceADetails.name,
  deviceB: .deviceB.name,
  interfaceB: .interfaceBDetails.name,
  encryption: .encryptionMethod,
  status: .status,
  isActive: .isActive,
  tunnelStatusA: .tunnelStatusA,
  tunnelStatusB: .tunnelStatusB
}'
echo ""

echo "================================"
echo "Test Complete"
echo "================================"
