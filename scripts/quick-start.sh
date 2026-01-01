#!/bin/bash
# FlexiManage 快速启动脚本

echo "========================================"
echo "FlexiManage 服务快速启动"
echo "========================================"

# 检查后端进程
if pgrep -f "npm start" > /dev/null; then
    echo "✓ 后端服务已在运行"
else
    echo "启动后端服务..."
    cd /root/fleximanage/backend
    npm start > /tmp/backend.log 2>&1 &
    sleep 3
    echo "✓ 后端服务已启动"
fi

# 检查前端构建
if [ -d "/root/fleximanage/frontend/build" ]; then
    echo "✓ 前端已构建"
else
    echo "构建前端..."
    cd /root/fleximanage/frontend
    npm run build
    echo "✓ 前端构建完成"
fi

# 显示访问信息
echo ""
echo "========================================"
echo "访问地址"
echo "========================================"
echo "生产环境: http://manage.miwide.com:3000"
echo "本地开发: http://localhost:3000"
echo "API Docs: http://manage.miwide.com:3000/api-docs"
echo ""
echo "Home 页面特色："
echo "  • Network Status: 设备和隧道状态"
echo "  • Traffic Statistics: 流量统计"
echo "  • World Map: 交互式地图（Leaflet）"
echo "  • 完全响应式设计"
echo ""
echo "========================================"

# 显示后端日志最后几行
echo ""
echo "后端日志:"
tail -5 /tmp/backend.log
