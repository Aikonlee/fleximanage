# FlexiManage Home 页面 - 快速参考

**更新时间**: 2025-12-31  
**状态**: ✅ 完成

---

## 快速启动

### 一行命令启动

```bash
bash /root/fleximanage/scripts/start-frontend.sh
```

### 或使用快速启动脚本

```bash
bash /root/fleximanage/quick-start.sh
```

### 访问地址

```
http://localhost:3000
```

---

## 关键文件位置

| 文件 | 位置 | 用途 |
|------|------|------|
| Home 组件 | `/root/fleximanage/frontend/src/pages/Home.js` | React 主组件 |
| 样式表 | `/root/fleximanage/frontend/src/pages/Home.css` | 所有样式 |
| 母本参考 | `/root/fleximanage/tmp/home_code.html` | HTML 原始设计 |
| HTML 入口 | `/root/fleximanage/frontend/public/index.html` | Leaflet CDN 链接 |
| 完成总结 | `/root/fleximanage/docs/COMPLETION_SUMMARY.md` | 项目总结 |
| 规格验证 | `/root/fleximanage/docs/HOME_PAGE_SPECIFICATION_VERIFICATION.md` | 详细核对 |
| 实现指南 | `/root/fleximanage/docs/HOME_PAGE_IMPLEMENTATION_GUIDE.md` | 完整文档 |

---

## 核心规格

### CSS 关键参数

| 元素 | 规格 |
|------|------|
| Body 背景 | `#f0f3f5`, padding `20px` |
| 容器宽度 | `max-width: 1200px` |
| 面包屑 | `14px`, `#73818f`, `margin-bottom: 5px` |
| H1 标题 | `28px`, `font-weight: 500`, `margin-bottom: 20px` |
| 卡片头 | `padding: 12px 20px`, `#f0f3f5` 背景 |
| 状态圆圈 | `44px`, `2px border`, 4 种颜色 |
| 地图 | `400px height`, `100% width`, `#eeb` 背景 |

### 状态颜色

```css
.green .circle  { border-color: #4dbd74; }  /* 成功 */
.red .circle    { border-color: #f86c6b; }  /* 失败 */
.orange .circle { border-color: #ffc107; }  /* 警告 */
.grey .circle   { border-color: #c8ced3; }  /* 中立 */
```

---

## 页面结构

```
Home Page
├── Breadcrumb: "Home" (14px, #73818f)
├── H1: "Home" (28px, font-weight 500)
├── Card 1: Network Status
│   ├── Devices 行
│   │   ├── Running (green)
│   │   ├── Not Running (red)
│   │   ├── Connected (green)
│   │   ├── Not Connected (red)
│   │   ├── Not Approved (grey)
│   │   └── Warning (orange)
│   └── Tunnels 行
│       ├── Connected (green)
│       ├── Not Connected (red)
│       ├── Pending (orange)
│       └── Unknown (grey)
├── Card 2: Traffic this month
│   └── Total | Value | Link
└── Card 3: World Map
    └── Leaflet Map (400px height)
```

---

## 常见操作

### 启动和停止

```bash
# 启动
bash /root/fleximanage/scripts/start-frontend.sh

# 停止
pkill -f 'npm start'
```

### 查看日志

```bash
# 后端日志
tail -f /tmp/backend.log

# 前端控制台
# 打开浏览器 → F12 → Console
```

### 重新构建

```bash
cd /root/fleximanage/frontend
npm run build
```

### 清除缓存

```bash
# 清除 npm 缓存
npm cache clean --force

# 删除 node_modules
rm -rf /root/fleximanage/frontend/node_modules
npm install

# 清除构建输出
rm -rf /root/fleximanage/frontend/build
npm run build
```

---

## API 端点

### 获取仪表板数据

```
GET /organizations/summary
```

**响应示例**:
```json
{
  "devices": {
    "total": 10,
    "running": 8,
    "connected": 7,
    "approved": 9
  },
  "tunnels": {
    "total": 5,
    "active": 4
  },
  "traffic": {
    "total": 1024,
    "unit": "GB"
  }
}
```

---

## 修改指南

### 修改样式

1. 编辑 `/root/fleximanage/frontend/src/pages/Home.css`
2. 运行 `npm run build`
3. 刷新浏览器

### 修改内容

1. 编辑 `/root/fleximanage/frontend/src/pages/Home.js`
2. 运行 `npm run build`
3. 刷新浏览器

### 修改地图

编辑 Home.js 的 `initializeMap()` 函数：

```javascript
const map = window.L.map('map', {
  zoomControl: true
}).setView([50.1109, 8.6821], 5);  // 修改坐标和缩放级别
```

---

## 故障排除

| 问题 | 解决方案 |
|------|--------|
| 地图不显示 | 检查 F12 → Console，确认 Leaflet 库加载 |
| 数据为空 | 查看后端日志: `tail -f /tmp/backend.log` |
| 样式错乱 | 清除缓存: Ctrl+Shift+Delete, 重新构建 |
| 端口被占用 | `lsof -i :3000` 查看占用进程，然后 kill |
| npm 报错 | 删除 node_modules 和 package-lock.json，重新 install |

---

## 项目统计

| 指标 | 数值 |
|------|------|
| 代码行数 (JS) | 281 行 |
| 代码行数 (CSS) | 402 行 |
| 组件数 | 1 个主组件 |
| 外部库 | React, Leaflet |
| CSS 类数 | 25+ 个 |
| 响应式断点 | 2 个 (768px, 480px) |
| 文档文件 | 3 个 (详细) |

---

## 验收清单

- ✅ React 组件重构完成
- ✅ CSS 样式 100% 符合母本
- ✅ Leaflet 地图集成完成
- ✅ API 数据绑定完成
- ✅ 响应式设计验证完成
- ✅ 前端构建成功
- ✅ 所有文档完成

---

## 下次迭代建议

1. **添加数据刷新功能**
   - 自动刷新 (30s)
   - 手动刷新按钮

2. **增强地图功能**
   - 添加标记点
   - 自定义样式
   - 工具提示

3. **性能优化**
   - 代码拆分
   - 图片优化
   - 懒加载

4. **功能扩展**
   - 数据导出
   - 日期范围选择
   - 高级过滤

---

**更多信息**: 查看 `/root/fleximanage/docs/` 目录中的详细文档
