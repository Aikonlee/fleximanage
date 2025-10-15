# FlexiManage Full-Mesh 隧道创建功能

## 📋 功能说明

本次实现了完整的 Web UI 批量创建隧道功能，支持在 FlexiManage 前端界面通过选择多个设备一键创建 Full-Mesh 或 Hub-Spoke 网络拓扑。

## ✅ 已完成的工作

### 1. 前端实现 (`frontend/src/pages/Devices.js`)

- ✅ 添加了"Create Tunnels"按钮在设备批量操作栏
- ✅ 按钮智能启用（仅在选择≥2个设备时可用）
- ✅ 创建了隧道创建Modal对话框
- ✅ 支持拓扑选择：
  - **Full Mesh**: 全网状连接，所有设备两两互联
  - **Hub and Spoke**: 星型连接，一个中心节点连接所有分支
- ✅ 实时显示将创建的隧道数量
  - Full Mesh: n×(n-1)/2 条双向隧道
  - 例如：4台设备 = 6条隧道
- ✅ 前端成功编译并部署

### 2. 后端API实现

#### `/backend/routes/devices.js`
- ✅ 添加了 `POST /api/devices/execute` 端点
- ✅ 配置了CORS和权限验证
- ✅ 路由顺序优化（在wrapper之前注册）

#### `/backend/services/DevicesService.js`
- ✅ 实现了 `devicesExecutePOST` 方法
- ✅ 支持 `add-tunnel` 动作
- ✅ 验证设备数量（至少2个）
- ✅ 使用 FlexiWAN dispatcher 调用隧道创建逻辑
- ✅ 支持 Full Mesh 和 Hub-Spoke 拓扑
- ✅ 返回任务状态和ID

## 🔧 技术实现

### 隧道创建流程

```
用户操作
  ↓
前端 Devices.js
  ↓ (API调用)
后端 /api/devices/execute
  ↓
DevicesService.devicesExecutePOST
  ↓
dispatcher.apply('add-tunnel')
  ↓
deviceLogic/tunnels.js: applyTunnelAdd
  ↓
handleTunnels (生成隧道参数)
  ↓
保存到数据库 (tunnels collection)
  ↓
sendAddTunnelsJobs (发送配置任务)
  ↓
设备队列 (Kue/Redis)
  ↓
设备接收并配置隧道
```

### 隧道技术细节

- **封装**: IPSec over VxLAN
- **VxLAN端口**: 4789
- **Loopback网络**: 10.100.0.0/16
- **路由协议**: OSPF (默认) 或 BGP
- **加密方式**: PSK (Pre-Shared Key) 或 IKEv2
- **NAT支持**: Full Cone NAT, Symmetric NAT, 公网IP等多种场景

### 支持的拓扑

#### Full Mesh (全网状)
```
Device A ←→ Device B
    ↕    ×    ↕
Device C ←→ Device D
```
- 所有设备两两互联
- 隧道数量 = n×(n-1)/2
- 适用于：小规模、高可用性需求

#### Hub and Spoke (星型)
```
      Hub
     / | \
    /  |  \
   A   B   C
```
- 中心节点连接所有分支
- 隧道数量 = n-1
- 适用于：大规模、集中管理

## 📝 使用方法

### 通过Web UI创建隧道

1. **登录FlexiManage**
   - 访问: `https://manage.miwide.com:3443`
   - 使用管理员凭据登录

2. **进入Devices页面**
   - 左侧菜单点击"Devices"
   - 查看所有在线设备

3. **选择设备**
   - 勾选至少2个设备
   - 确保设备状态为"Connected"且vRouter为"Running"

4. **创建隧道**
   - 点击顶部的"Create Tunnels"按钮
   - 在弹出对话框中：
     - 选择拓扑类型（Full Mesh 或 Hub and Spoke）
     - 查看将创建的隧道数量
     - 点击"Create Tunnels"确认

5. **等待创建完成**
   - 系统自动：
     - 生成IPSec密钥
     - 配置VxLAN隧道
     - 设置OSPF路由
     - 发送配置到设备
   - 通常需要30-60秒完成

6. **验证隧道**
   - 进入"Tunnels"页面查看隧道状态
   - 每个隧道应显示"Connected"

### 通过API创建隧道

```bash
# 1. 获取认证token
curl -X POST https://manage.miwide.com:3443/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}' \
  -k

# 2. 创建Full-Mesh隧道
curl -X POST https://manage.miwide.com:3443/api/devices/execute \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceIds": [
      "device_id_1",
      "device_id_2",
      "device_id_3",
      "device_id_4"
    ],
    "action": "add-tunnel",
    "params": {
      "topology": "full-mesh"
    }
  }' \
  -k
```

## 🎯 示例：4台设备Full-Mesh

### 设备信息
```
设备1: 10.248.5.15 (LAN: 192.168.14.0/24)
设备2: 10.248.5.8  (LAN: 192.168.7.0/24)
设备3: 10.248.5.77 (LAN: 192.168.76.0/24)
设备4: 10.248.5.73 (LAN: 192.168.72.0/24)

NAT类型: Full Cone NAT
公网IP: 122.194.232.225 (共享)
端口: 各不相同
```

### 创建结果
- 将创建6条双向隧道
- 每条隧道包含：
  - 一对loopback地址（10.100.x.x）
  - IPSec加密连接
  - OSPF邻居关系
- 所有LAN网络自动互通

### 网络连通性
```
192.168.14.0/24 ←→ 192.168.7.0/24
192.168.14.0/24 ←→ 192.168.76.0/24
192.168.14.0/24 ←→ 192.168.72.0/24
192.168.7.0/24  ←→ 192.168.76.0/24
192.168.7.0/24  ←→ 192.168.72.0/24
192.168.76.0/24 ←→ 192.168.72.0/24
```

## 🔍 故障排查

### 405 Method Not Allowed 错误
**原因**: 路由顺序问题，wrapper.assignRoutes 覆盖了自定义路由

**解决方案**: 
- 已修复：将 `/execute` 路由定义移到 wrapper.assignRoutes 之前
- 确保执行了 `pm2 restart fleximanage-backend`

### 隧道创建失败
**可能原因**:
1. 设备不在线
2. 设备vRouter未运行
3. 没有可用的WAN接口
4. NAT类型不兼容

**检查方法**:
```bash
# 查看后端日志
pm2 logs fleximanage-backend

# 查看设备队列
echo 'db.jobs.find({entityType:"tunnel"}).limit(5)' | \
  mongosh mongodb://localhost:27017/flexiwan --quiet

# 查看隧道状态
echo 'db.tunnels.find({isActive:true}).count()' | \
  mongosh mongodb://localhost:27017/flexiwan --quiet
```

## 📊 数据库结构

### Tunnels Collection
```javascript
{
  _id: ObjectId,
  num: Number,              // 隧道编号
  org: ObjectId,            // 组织ID
  deviceA: ObjectId,        // 设备A ID
  deviceB: ObjectId,        // 设备B ID
  interfaceA: ObjectId,     // 接口A ID
  interfaceB: ObjectId,     // 接口B ID
  isActive: Boolean,        // 是否激活
  pathlabel: ObjectId,      // 路径标签（可选）
  encryptionMethod: String, // 加密方式
  tunnelKeys: {
    psk: String,            // Pre-shared key
    ikev2: Object           // IKEv2配置
  },
  params: {
    loopback: {
      A: String,            // 设备A loopback IP
      B: String             // 设备B loopback IP
    },
    vxlan: {
      A: Number,            // 设备A VNI
      B: Number             // 设备B VNI
    }
  }
}
```

## 🚀 部署状态

- ✅ 后端代码已更新
- ✅ 前端代码已构建
- ✅ 服务器已重启
- ✅ API端点已测试
- ✅ 路由配置已优化

## 📚 相关文档

- FlexiWAN Tunnels官方文档: https://docs.flexiwan.com/6.5.1/management/tunnels.html
- 代码位置:
  - 前端: `/root/fleximanage/frontend/src/pages/Devices.js`
  - 后端路由: `/root/fleximanage/backend/routes/devices.js`
  - 后端服务: `/root/fleximanage/backend/services/DevicesService.js`
  - 隧道逻辑: `/root/fleximanage/backend/deviceLogic/tunnels.js`

## 📞 联系支持

如有问题，请查看：
1. PM2日志: `pm2 logs fleximanage-backend`
2. MongoDB数据: 使用 mongosh 查询设备和隧道表
3. 前端console: 浏览器开发者工具查看API调用

---

**版本**: 1.0.0  
**日期**: 2025-10-14  
**状态**: ✅ 已完成并测试
