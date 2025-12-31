# 稳定版本验证测试计划

**测试日期**: 2025-12-29
**系统**: 回滚后的 fleximanage (提交 8557fdd1)
**目标**: 验证系统功能正常，确认是否真的比 12 月 29 日的修改版本更稳定

---

## 1. 基础系统检查

### 1.1 服务可用性

```bash
# 验证后端运行
curl -s https://manage.miwide.com:3443/api/status 2>&1 | head -c 100

# 验证前端运行
curl -s -I http://manage.miwide.com:3000 | grep HTTP

# 检查 PM2 状态
pm2 status

# 检查进程内存使用
pm2 monit
```

### 1.2 数据库连接

```bash
# 验证 MongoDB 连接状态
pm2 logs fleximanage-backend --lines 5 | grep "Connected to MongoDB"

# 验证 Redis 连接
pm2 logs fleximanage-backend --lines 5 | grep "Connected to Redis"
```

---

## 2. 用户注册和登录流程

### 测试步骤

1. **访问注册页面**
   - URL: `https://manage.miwide.com:3443/register`
   - 验证 CAPTCHA 是否显示
   - 检查表单字段

2. **填写注册表单**
   ```
   - Email: test-user-20251229@example.com
   - Password: TestPass123!
   - Organization: Test Org
   - First Name: Test
   - Last Name: User
   ```

3. **提交注册**
   - 验证是否收到确认邮件
   - 检查后端日志中的错误

4. **登录验证**
   - 使用注册邮箱和密码登录
   - 验证是否成功获取 JWT 令牌
   - 检查令牌过期时间（应为 300 秒）

---

## 3. 设备注册流程（关键测试）

### 3.1 生成设备令牌

```bash
# 模拟设备令牌生成
node -e "
const jwt = require('jsonwebtoken');
const secret = 'abcdefg1234567';
const payload = {
  sub: 'test-device-001',
  macAddress: 'AA:BB:CC:DD:EE:FF',
  type: 'device'
};
const token = jwt.sign(payload, secret, { expiresIn: '24h' });
console.log(token);
"
```

### 3.2 发送设备注册请求

```bash
# 测试设备注册端点
DEVICE_TOKEN="<生成的令牌>"
curl -X POST https://manage.miwide.com:3443/api/connect/register \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-001",
    "interfaces": [{
      "name": "eth0",
      "macAddress": "AA:BB:CC:DD:EE:FF",
      "ip": "192.168.1.100"
    }]
  }'
```

### 3.3 验证设备是否出现在 UI

- 登录到管理界面
- 导航到 **Devices** 页面
- 检查新设备是否出现
- 验证设备状态为 "Online" 或 "Registered"

---

## 4. 隧道管理流程

### 4.1 创建隧道

1. **UI 操作**
   - 点击 "Create Tunnel"
   - 选择两个设备
   - 配置隧道参数
   - 提交创建

2. **验证响应**
   - 检查是否收到成功消息
   - 隧道是否出现在列表中
   - 检查后端日志中的 Promise 处理

### 4.2 删除隧道（关键 - 12 月 29 日的修复）

```bash
# 通过 API 测试隧道删除
curl -X DELETE https://manage.miwide.com:3443/api/tunnels/TUNNEL_ID \
  -H "Authorization: Bearer $USER_TOKEN"
```

**预期结果**:
- ✓ 不出现 "Cannot read properties of undefined" 错误
- ✓ 不出现 "Cannot read property 'flat' of undefined" 错误
- ✓ 隧道从列表中删除

**可能出现的问题**:
- ✗ "jwt expired" - 由于 userTokenExpiration: 300 秒
- ✗ Promise 处理错误（如果 Dec 29 修复未应用）

---

## 5. JWT 令牌过期行为测试

### 5.1 测试令牌过期

```bash
# 登录获取令牌
USER_TOKEN=$(curl -s -X POST https://manage.miwide.com:3443/api/authenticate \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }' | jq -r '.token')

# 立即使用 - 应该成功
curl -s https://manage.miwide.com:3443/api/devices \
  -H "Authorization: Bearer $USER_TOKEN"

# 等待 5+ 分钟后再使用 - 应该失败
sleep 310
curl -s https://manage.miwide.com:3443/api/devices \
  -H "Authorization: Bearer $USER_TOKEN"
```

**预期结果**:
- 登录后 5 分钟内请求成功
- 5 分钟后请求失败，返回 "jwt expired"

**问题分析**:
- 这是生产设计，不是回归
- 需要在前端实现自动刷新或提示用户

---

## 6. 系统稳定性监测

### 6.1 PM2 进程监控

```bash
# 监视进程重启情况
watch -n 5 'pm2 status'

# 监视内存和 CPU
pm2 monit

# 检查日志中的错误
pm2 logs fleximanage-backend --lines 100 | grep -i error
```

### 6.2 数据库查询

```bash
# 检查数据库中的设备数
db.devices.count()

# 检查数据库中的隧道数
db.tunnels.count()

# 检查是否有错误记录
db.logs.find({ level: 'error' }).limit(10)
```

---

## 7. 性能测试

### 7.1 并发请求

```bash
# 发送 100 个并发 API 请求
for i in {1..100}; do
  curl -s https://manage.miwide.com:3443/api/devices \
    -H "Authorization: Bearer $USER_TOKEN" &
done
wait
```

### 7.2 观察资源使用

- 监视内存增长
- 检查是否有内存泄漏
- 验证进程是否自动重启

---

## 8. 错误日志分析

### 8.1 查看关键错误

```bash
# 设备令牌验证错误
pm2 logs | grep -i "invalid token"

# JWT 错误
pm2 logs | grep -i "jwt"

# Promise 错误
pm2 logs | grep -i "cannot read"

# 数据库错误
pm2 logs | grep -i "mongodb\|database"
```

### 8.2 记录错误发生的时间

- 第一次错误: _______________
- 错误频率: _______________
- 影响的功能: _______________

---

## 9. 对比 12 月 29 日版本

### 问题清单

| 问题 | 12 月 29 日 | 稳定版本 | 改进? |
|------|-----------|--------|------|
| 设备注册失败 | ❌ | ? | ? |
| JWT 过期错误 | ❌ | ? | ? |
| Promise 处理错误 | ✓ (已修复) | ❌ | ✗ |
| PM2 重启频率 | 频繁 | ? | ? |
| 系统崩溃 | 有报告 | ? | ? |

---

## 10. 测试记录表

```
测试项目                    | 状态  | 时间  | 备注
---------------------------|------|------|--------
后端 API 响应              | [ ]  | ___  | 
前端加载                   | [ ]  | ___  |
用户注册                   | [ ]  | ___  |
用户登录                   | [ ]  | ___  |
设备令牌验证               | [ ]  | ___  |
设备注册                   | [ ]  | ___  |
隧道创建                   | [ ]  | ___  |
隧道删除                   | [ ]  | ___  |
令牌过期行为               | [ ]  | ___  |
并发请求                   | [ ]  | ___  |
系统稳定性 (1 小时)       | [ ]  | ___  |
错误日志检查               | [ ]  | ___  |
```

---

## 11. 下一步决策

### 如果稳定版本工作正常 ✓
1. **保持稳定版本作为基础**
2. **逐个应用 12 月 29 日的修复**
   - 首先应用隧道删除 Promise 修复
   - 测试后应用其他修复
3. **创建改进版本**
4. **添加自动化测试**

### 如果稳定版本仍有问题 ✗
1. **分析错误日志**
2. **对比两个版本的差异**
3. **检查环境配置**
4. **考虑更早的提交**
5. **检查外部依赖（MongoDB, Redis）**

---

## 测试开始时间

**开始时间**: _______________
**预期完成**: _______________

---

## 测试完成签名

**测试人员**: _______________
**完成时间**: _______________
**总体评估**: 

- [ ] ✓ 系统稳定，可用于生产
- [ ] ⚠ 系统基本可用，存在已知问题
- [ ] ✗ 系统不稳定，需要进一步调查

**主要发现**:
