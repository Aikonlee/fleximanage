# Redis 安全加固指南

## 当前状态（2025-12-31）

### 问题分析
Redis 曾被配置为对所有网络接口开放（`0.0.0.0:6379`），这在生产环境中存在严重的安全风险：
- **无密码保护**: 任何能访问 6379 端口的人都可以执行任意命令
- **对外开放**: 不必要地暴露了内部服务

### 安全风险
| 威胁 | 影响 | 修复状态 |
|------|------|--------|
| 未授权访问 | 🔴 严重 - 数据泄露、服务中断 | ✅ 已修复 |
| 配置不当 | 🟠 高 - 暴露内部服务 | ✅ 已修复 |
| 缺少认证 | 🟠 高 - 任意命令执行 | ⏳ 需补充 |

## 已应用的修复

### 1. Redis 绑定地址限制 ✅

**修改前**:
```bash
bind 0.0.0.0  # 对所有接口开放
```

**修改后**:
```bash
bind 127.0.0.1  # 仅本地访问
```

**命令**:
```bash
sudo sed -i 's/^bind 0\.0\.0\.0/bind 127.0.0.1/' /etc/redis/redis.conf
sudo systemctl restart redis-server
```

**验证**:
```bash
$ ss -tulnp | grep 6379
tcp   LISTEN 0  511  127.0.0.1:6379  0.0.0.0:*  (redis-server)
```

### 2. 保留 Protected Mode ✅

Redis 的 `protected-mode yes` 已启用，进一步防止未授权访问：
- 仅允许本地 TCP 连接（当未设置密码时）
- 仅允许 Unix socket 连接
- 防止远程客户端访问

**验证**:
```bash
$ redis-cli CONFIG GET protected-mode
1) "protected-mode"
2) "yes"
```

## 后续安全建议

### 建议 1: 设置 Redis 密码 (生产必须)

```bash
# 生成强密码
openssl rand -base64 32

# 在 /etc/redis/redis.conf 中添加
requirepass <your-strong-password>

# 更新后端 .env 中的 REDIS_URL
REDIS_URL=redis://:password@localhost:6379

# 重启 Redis
sudo systemctl restart redis-server

# 测试连接
redis-cli -a <password> ping
```

### 建议 2: 防火墙配置

即使 Redis 绑定到 127.0.0.1，也建议添加防火墙规则：

```bash
# UFW 防火墙
sudo ufw deny from any to any port 6379

# 或者使用 iptables
sudo iptables -I INPUT -p tcp --dport 6379 -j DROP
sudo iptables-save > /etc/iptables/rules.v4
```

### 建议 3: 监控和日志

启用 Redis 命令日志用于审计：
```bash
# 在 /etc/redis/redis.conf 中
loglevel notice  # 改为 'debug' 用于开发环境
logfile "/var/log/redis/redis-server.log"
```

## 架构图

```
┌─────────────────────────────────────┐
│  FlexiManage Backend (Port 3000/3443)│
│  localhost:3000                      │
└────────────┬────────────────────────┘
             │
             │ redis://localhost:6379
             │ (内部通信，无需对外)
             ▼
┌─────────────────────────────────────┐
│  Redis Cache Layer                   │
│  Bound to: 127.0.0.1:6379           │
│  Protected Mode: YES                 │
│  External Access: BLOCKED            │
└─────────────────────────────────────┘
```

## 验证清单

- ✅ Redis 仅绑定到 127.0.0.1
- ✅ Protected Mode 已启用
- ✅ 后端能正常连接到 Redis
- ✅ 无对外暴露的 6379 端口
- ⏳ 需要设置 Redis 密码（生产环保）
- ⏳ 建议添加防火墙规则

## 相关配置文件

- `/etc/redis/redis.conf` - Redis 配置文件
- `/root/fleximanage/backend/.env` - 后端 Redis 连接配置
- `REDIS_URL=redis://localhost:6379` - 当前连接字符串

## 回退计划

如果需要恢复之前的配置：
```bash
sudo cp /etc/redis/redis.conf.bak.20251231 /etc/redis/redis.conf
sudo systemctl restart redis-server
```

## 相关文档

- [Redis 安全指南](https://redis.io/docs/management/security/)
- [Redis 配置参考](https://redis.io/docs/management/config/)
