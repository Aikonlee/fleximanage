## 🎯 FlexiManage 隧道创建 - 快速测试指南

### 当前状态
- ✅ 后端：官方代码，无修改
- ✅ 前端：已适配官方API (main.070c4d4c.js)
- ✅ 服务：运行中

### 测试步骤

1. **打开浏览器**
   ```
   URL: https://manage.miwide.com:3443
   ```

2. **登录**
   ```
   用户名: admin@example.com (或您的邮箱)
   密码: 您的密码
   ```

3. **进入Devices页面**
   - 点击左侧菜单 "Devices"
   - 您应该看到4台在线设备

4. **创建Full Mesh隧道**
   - 勾选所有4台设备（或至少2台）
   - 点击顶部 "Create Tunnels" 按钮
   - 在弹出的对话框中：
     - 拓扑类型：保持 "Full Mesh" 
     - 点击 "Create Tunnels"
   - 等待提示消息

5. **验证结果**
   - 等待30-60秒
   - 进入 "Tunnels" 页面
   - 应该看到新创建的隧道
   - 状态应为 "Connected"

### API对比

#### 旧方式（已废弃）
```javascript
POST /devices/execute
{
  "deviceIds": ["id1", "id2", "id3", "id4"],
  "action": "add-tunnel",
  "params": {
    "topology": "full-mesh"
  }
}
```
❌ 405 Method Not Allowed（自定义端点不存在）

#### 新方式（官方标准）
```javascript
POST /devices/apply
{
  "method": "tunnels",
  "devices": {
    "id1": true,
    "id2": true,
    "id3": true,
    "id4": true
  },
  "meta": {
    "tunnelType": "site-to-site",
    "pathLabels": [],
    "topology": "fullMesh",
    "hub": null,
    "advancedOptions": {
      "routing": "ospf"
    }
  }
}
```
✅ 202 Accepted（官方端点，正常工作）

### 浏览器Console测试

打开浏览器开发者工具(F12)，在Console中执行：

```javascript
// 检查API端点
fetch('/api/devices/apply', {
  method: 'OPTIONS',
  headers: {
    'Authorization': 'Bearer ' + localStorage.getItem('token')
  }
}).then(r => console.log('API Status:', r.status));

// 应该返回: API Status: 200
```

### 数据库查询

```bash
# 查看最近的隧道创建任务
echo "db.jobs.find({method:'tunnels'}).sort({_id:-1}).limit(3).pretty()" | \
  mongosh mongodb://localhost:27017/flexiwan --quiet

# 查看活动隧道数量
echo "db.tunnels.countDocuments({isActive:true})" | \
  mongosh mongodb://localhost:27017/flexiwan --quiet
```

### 预期输出

#### 成功创建（4台设备Full Mesh）
```
Alert消息：
"Tunnels are being created in full-mesh topology! 
Please check the Tunnels page in a moment."

隧道数量：6条
- Device1 ↔ Device2
- Device1 ↔ Device3
- Device1 ↔ Device4
- Device2 ↔ Device3
- Device2 ↔ Device4
- Device3 ↔ Device4
```

#### 后端日志（正常）
```bash
pm2 logs fleximanage-backend --lines 20
```
应该看到：
```
Creating tunnels between devices
Tunnel creation...
Job queued successfully
```

### 关键改进

| 方面 | 旧实现 | 新实现（官方API） |
|------|--------|-------------------|
| 端点 | `/devices/execute` | `/devices/apply` ✅ |
| 方法 | `add-tunnel` | `tunnels` ✅ |
| 后端修改 | 需要自定义代码 | 无需修改 ✅ |
| 兼容性 | 不兼容官方 | 完全兼容 ✅ |
| 升级风险 | 高 | 低 ✅ |

### 如果遇到问题

1. **清除浏览器缓存** (Ctrl+Shift+Delete)
2. **检查构建版本**：
   ```bash
   ls -lh /root/fleximanage/frontend/build/static/js/main.*.js
   ```
   应该看到 `main.070c4d4c.js` (不是旧的 `main.20fb7545.js`)

3. **重启服务**：
   ```bash
   pm2 restart fleximanage-backend
   ```

4. **查看实时日志**：
   ```bash
   pm2 logs fleximanage-backend
   ```

---

**准备就绪！现在可以使用官方API创建隧道了！** 🚀
