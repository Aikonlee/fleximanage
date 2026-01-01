#!/bin/bash
# FlexiManage 前端 Home 页面开发启动脚本

set -e

echo "========================================"
echo "FlexiManage Home 页面启动"
echo "========================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查依赖
echo "检查依赖..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "错误: 未找到 npm，请先安装"
    exit 1
fi
echo -e "${GREEN}✓${NC} npm $(npm -v)"

# 进入前端目录
cd /root/fleximanage/frontend

# 检查依赖是否已安装
if [ ! -d "node_modules" ]; then
    echo ""
    echo "安装前端依赖..."
    npm install
fi
echo -e "${GREEN}✓${NC} 前端依赖已就绪"

# 检查构建
if [ ! -d "build" ]; then
    echo ""
    echo "构建前端..."
    npm run build
fi
echo -e "${GREEN}✓${NC} 前端已构建"

# 启动后端服务（如果未运行）
echo ""
echo "检查后端服务..."
if ! netstat -tuln | grep -q ":3000 "; then
    echo "启动后端服务..."
    cd /root/fleximanage/backend
    npm start > /tmp/backend.log 2>&1 &
    sleep 3
    echo -e "${GREEN}✓${NC} 后端服务已启动 (PID: $!)"
else
    echo -e "${GREEN}✓${NC} 后端服务已在运行"
fi

# 返回前端目录
cd /root/fleximanage/frontend

# 显示访问信息
echo ""
echo "========================================"
echo -e "${BLUE}服务已就绪${NC}"
echo "========================================"
echo ""
echo "访问地址:"
echo -e "  ${BLUE}http://localhost:3000${NC}"
echo ""
echo "功能特性:"
echo "  • Network Status - 设备和隧道状态统计"
echo "  • Traffic Statistics - 月度流量统计"
echo "  • World Map - 交互式 Leaflet 地图"
echo "  • 完全响应式设计"
echo ""
echo "停止服务:"
echo "  pkill -f 'npm start'"
echo ""
echo "查看后端日志:"
echo "  tail -f /tmp/backend.log"
echo ""
echo "========================================"
