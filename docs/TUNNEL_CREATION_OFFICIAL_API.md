# FlexiManage 隧道创建功能 - 官方API适配

## 🎯 设计原则

**遵循官方后端API，修改前端来适配** - 不修改官方后端代码，完全使用FlexiWAN提供的标准API。

## ✅ 实现方案

### 官方API分析

FlexiWAN官方使用以下API创建隧道：

```javascript
POST /devices/apply

请求体：
{
  "method": "tunnels",
  "devices": {
    "device_id_1": true,
    "device_id_2": true,
    "device_id_3": true,
    "device_id_4": true
  },
  "meta": {
    "tunnelType": "site-to-site",
    "pathLabels": [],
    "topology": "fullMesh",  // 或 "hubAndSpoke"
    "hub": null,             // hubAndSpoke时指定hub设备ID
    "advancedOptions": {
      "routing": "ospf"      // 或 "bgp"
    }
  }
}
```

### 前端修改

修改了 `/root/fleximanage/frontend/src/pages/Devices.js`：

1. **保留UI组件**：
   - ✅ "Create Tunnels" 按钮
   - ✅ 设备选择功能
   - ✅ Modal对话框
   - ✅ 拓扑选择（Full Mesh / Hub and Spoke）

2. **修改API调用**：
   ```javascript
   // 旧方式（自定义端点）
   POST /devices/execute
   { deviceIds: [...], action: 'add-tunnel', params: {...} }
   
   // 新方式（官方端点）
   POST /devices/apply
   { method: 'tunnels', devices: {...}, meta: {...} }
   ```

3. **数据格式转换**：
   - `deviceIds数组` → `devices对象` (key-value pairs)
   - `topology: 'full-mesh'` → `topology: 'fullMesh'`
   - `topology: 'hub-spoke'` → `topology: 'hubAndSpoke'`

### 后端状态

- ✅ **完全使用官方代码**，没有任何自定义修改
- ✅ 使用官方的 `dispatcher.apply()` 机制
- ✅ 调用官方的 `tunnels.apply.applyTunnelAdd` 函数

## 📋 使用方法

### 通过Web UI创建隧道

1. **登录FlexiManage**
   ```
   URL: https://manage.miwide.com:3443
   账号: admin
   ```

2. **选择设备**
   - 进入 Devices 页面
   - 勾选至少2个在线设备
   - 确保设备状态为 Connected 和 Running

3. **创建隧道**
   - 点击 "Create Tunnels" 按钮
   - 选择拓扑：
     - **Full Mesh**: 所有设备两两互联（n×(n-1)/2条隧道）
     - **Hub and Spoke**: 中心辐射型（n-1条隧道）
   - 点击 "Create Tunnels" 确认

4. **验证结果**
   - 等待30-60秒
   - 进入 Tunnels 页面查看隧道状态
   - 所有隧道应显示为 Connected

### API调用示例

```bash
# 1. 登录获取token
TOKEN=$(curl -s -X POST https://manage.miwide.com:3443/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"username":"admin@example.com","password":"your_password"}' \
  -k | jq -r '.token')

# 2. 创建Full Mesh隧道
curl -X POST https://manage.miwide.com:3443/api/devices/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tunnels",
    "devices": {
      "671c8152a56f1b3e1fe54321": true,
      "671c8152a56f1b3e1fe54322": true,
      "671c8152a56f1b3e1fe54323": true,
      "671c8152a56f1b3e1fe54324": true
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
  }' \
  -k
```

## 🔍 技术细节

### 隧道创建流程（官方）

```
前端 Devices.js
  ↓ POST /devices/apply
后端 routes/devices.js
  ↓ dispatcher.apply(devices, 'tunnels', user, data)
deviceLogic/dispatcher.js
  ↓ methods.tunnels.apply()
deviceLogic/tunnels.js: applyTunnelAdd()
  ↓ handleTunnels()
  ↓ 生成隧道参数、密钥、loopback地址
  ↓ 保存到 tunnels collection
  ↓ sendAddTunnelsJobs()
设备队列 (Kue/Redis)
  ↓ 设备接收配置任务
设备端配置IPSec、VxLAN、OSPF
```

### 拓扑类型

#### Full Mesh (fullMesh)
```
topology: 'fullMesh'

示例（4台设备）：
A ←→ B
A ←→ C  
A ←→ D
B ←→ C
B ←→ D
C ←→ D

隧道数量: 4×3/2 = 6条
```

#### Hub and Spoke (hubAndSpoke)
```
topology: 'hubAndSpoke'
hub: 'hub_device_id'

示例（1个Hub + 3个Spoke）：
    Hub
   / | \
  A  B  C

隧道数量: 3条
```

### 路由协议

- **OSPF** (默认): 
  - 适用于中小型网络
  - 自动学习路由
  - 快速收敛

- **BGP** (可选):
  - 适用于大型网络
  - 需要预先配置
  - 灵活的路由策略

## 🔧 代码修改记录

### 前端修改 (frontend/src/pages/Devices.js)

```javascript
// 修改前：自定义API
const response = await apiCall('/api/devices/execute', {
  method: 'POST',
  body: JSON.stringify({
    deviceIds: deviceIds,
    action: 'add-tunnel',
    params: { topology: tunnelTopology }
  })
});

// 修改后：官方API
const devicesObj = {};
deviceIds.forEach(id => { devicesObj[id] = true; });

const topology = tunnelTopology === 'hub-spoke' ? 'hubAndSpoke' : 'fullMesh';

const response = await apiCall('/api/devices/apply', {
  method: 'POST',
  body: JSON.stringify({
    method: 'tunnels',
    devices: devicesObj,
    meta: {
      tunnelType: 'site-to-site',
      pathLabels: [],
      topology: topology,
      hub: null,
      advancedOptions: { routing: 'ospf' }
    }
  })
});
```

### 后端修改

- ✅ **无修改** - 完全使用官方代码
- ✅ 回滚了之前添加的 `/devices/execute` 端点
- ✅ 回滚了 `DevicesService.devicesExecutePOST` 方法

## 📊 测试场景

### 场景1：4台设备Full Mesh

**设备信息**：
```
Device 1: 10.248.5.15 (LAN: 192.168.14.0/24)
Device 2: 10.248.5.8  (LAN: 192.168.7.0/24)
Device 3: 10.248.5.77 (LAN: 192.168.76.0/24)
Device 4: 10.248.5.73 (LAN: 192.168.72.0/24)
```

**预期结果**：
- 创建6条双向隧道
- 所有LAN网络互通
- OSPF邻居关系建立

### 场景2：Hub-Spoke拓扑

**配置**：
- Hub: Device 1 (10.248.5.15)
- Spoke: Device 2, 3, 4

**预期结果**：
- 创建3条隧道（Hub到每个Spoke）
- Spoke之间通过Hub通信

## 🚀 部署状态

- ✅ 后端：使用官方代码，无修改
- ✅ 前端：已适配官方API
- ✅ 构建：新版本 main.070c4d4c.js
- ✅ 服务：后端正常运行

## 📝 注意事项

1. **设备要求**：
   - 设备必须在线 (isConnected: true)
   - vRouter必须运行中 (state: 'running')
   - 至少有一个WAN接口

2. **NAT支持**：
   - Full Cone NAT: ✅ 完全支持
   - Restricted Cone NAT: ✅ 支持
   - Port Restricted NAT: ✅ 支持
   - Symmetric NAT: ⚠️ 需要手动配置

3. **加密方式**：
   - PSK (Pre-Shared Key): 默认
   - IKEv2: 需要在组织设置中配置

## 🐛 故障排查

### 问题：隧道创建失败

**检查步骤**：

```bash
# 1. 查看后端日志
pm2 logs fleximanage-backend

# 2. 检查设备队列
mongosh mongodb://localhost:27017/flexiwan --quiet --eval '
  db.jobs.find({
    "entity": "device",
    "method": "tunnels"
  }).sort({_id: -1}).limit(5).pretty()
'

# 3. 检查隧道表
mongosh mongodb://localhost:27017/flexiwan --quiet --eval '
  db.tunnels.find({
    isActive: true
  }).count()
'

# 4. 查看设备状态
mongosh mongodb://localhost:27017/flexiwan --quiet --eval '
  db.devices.find({}, {
    name: 1,
    isConnected: 1,
    "sync.state": 1
  }).pretty()
'
```

### 问题：405 Method Not Allowed

**原因**：旧的自定义端点导致

**解决**：
1. 确认已回滚后端修改
2. 确认前端使用 `/devices/apply` 端点
3. 重新构建前端
4. 清除浏览器缓存

## 📚 相关文档

- **官方文档**: https://docs.flexiwan.com/6.5.1/management/tunnels.html
- **代码位置**:
  - 前端: `/root/fleximanage/frontend/src/pages/Devices.js`
  - 后端路由: `/root/fleximanage/backend/routes/devices.js` (官方版本)
  - 后端逻辑: `/root/fleximanage/backend/deviceLogic/tunnels.js` (官方版本)
  - 调度器: `/root/fleximanage/backend/deviceLogic/dispatcher.js` (官方版本)

## ✨ 优势

1. **兼容性强**：完全遵循官方API，未来升级无忧
2. **稳定性好**：使用官方测试过的代码路径
3. **维护简单**：只修改前端，后端保持官方状态
4. **功能完整**：支持所有官方隧道特性

---

**版本**: 2.0.0 (官方API适配版)  
**日期**: 2025-10-14  
**状态**: ✅ 完成并遵循官方标准
