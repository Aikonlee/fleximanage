# MongoDB Replica Set 开机自启动配置

本文档说明如何配置 MongoDB 副本集的 systemd 开机自启动服务。

## 系统要求

- Ubuntu 24.04 (或其他支持 systemd 的 Linux 发行版)
- MongoDB 8.0.15 (ARM64 或 x86_64)
- 已安装并初始化的 MongoDB 副本集（3个节点）

## 快速开始

### 1. 安装 MongoDB 副本集

```bash
# 对于 ARM64 系统
sudo bash scripts/install_mongodb_arm64.sh

# 对于 x86_64 系统
sudo bash scripts/install_mongodb_x86_64.sh
```

### 2. 配置开机自启动

```bash
sudo bash scripts/setup_mongodb_systemd.sh
```

该脚本会自动：
- 创建 3 个 systemd 服务单元（端口 27017, 27018, 27019）
- 配置服务开机自启动
- 启动所有 MongoDB 实例
- 验证副本集状态

### 3. 验证服务状态

```bash
# 查看服务状态
systemctl status mongod-27017 mongod-27018 mongod-27019

# 查看开机自启动状态
systemctl is-enabled mongod-27017 mongod-27018 mongod-27019

# 查看 MongoDB 进程
ps aux | grep mongod

# 查看监听端口
ss -tlnp | grep :2701
```

## 服务管理

### 启动/停止/重启服务

```bash
# 启动所有服务
sudo systemctl start mongod-27017 mongod-27018 mongod-27019

# 停止所有服务
sudo systemctl stop mongod-27017 mongod-27018 mongod-27019

# 重启所有服务
sudo systemctl restart mongod-27017 mongod-27018 mongod-27019

# 重启单个服务
sudo systemctl restart mongod-27017
```

### 查看日志

```bash
# 查看系统日志
journalctl -u mongod-27017 -f

# 查看 MongoDB 日志文件
tail -f /var/log/mongodb/mongod-27017.log
```

### 启用/禁用开机自启动

```bash
# 启用开机自启动
sudo systemctl enable mongod-27017 mongod-27018 mongod-27019

# 禁用开机自启动
sudo systemctl disable mongod-27017 mongod-27018 mongod-27019
```

## 服务配置

systemd 服务单元文件位于：
```
/etc/systemd/system/mongod-27017.service
/etc/systemd/system/mongod-27018.service
/etc/systemd/system/mongod-27019.service
```

### 服务配置说明

- **Type**: `forking` - MongoDB 以守护进程模式运行
- **User/Group**: `mongodb` - 使用专用的 mongodb 用户运行
- **PIDFile**: `/var/run/mongodb/mongod-<port>.pid` - PID 文件位置
- **Restart**: `on-failure` - 失败时自动重启
- **RestartSec**: `10` - 重启前等待 10 秒

### MongoDB 启动参数

```bash
--port=<27017|27018|27019>          # 端口号
--dbpath /data/db<port>              # 数据目录
--replSet rs                         # 副本集名称
--bind_ip_all                        # 绑定所有网络接口
--oplogSize 256                      # Oplog 大小 (MB)
--wiredTigerCacheSizeGB 0.25         # WiredTiger 缓存大小
--pidfilepath /var/run/mongodb/...   # PID 文件路径
--fork                               # 后台运行
--logpath /var/log/mongodb/...       # 日志文件路径
```

## 副本集管理

### 检查副本集状态

```bash
# 使用 mongo shell (如果已安装 mongosh)
mongosh --port 27017 --eval 'rs.status()'

# 简化输出
mongosh --port 27017 --eval 'rs.status().members.forEach(m => print(m.name + " [" + m.stateStr + "]"))'
```

### 连接到 PRIMARY 节点

```bash
# 连接到副本集
mongosh --port 27017

# 在 shell 中执行
rs.status()
db.isMaster()
```

## 故障排查

### 服务无法启动

1. 查看系统日志：
```bash
journalctl -u mongod-27017 -n 50
```

2. 查看 MongoDB 日志：
```bash
tail -100 /var/log/mongodb/mongod-27017.log
```

3. 检查端口占用：
```bash
ss -tlnp | grep :27017
```

4. 检查数据目录权限：
```bash
ls -la /data/db27017
sudo chown -R mongodb:mongodb /data/db27017
```

### 服务启动后无法连接

1. 检查防火墙规则：
```bash
sudo ufw status
sudo ufw allow 27017/tcp
sudo ufw allow 27018/tcp
sudo ufw allow 27019/tcp
```

2. 检查 MongoDB 绑定地址：
```bash
# 应该看到 0.0.0.0:27017 表示绑定所有接口
ss -tlnp | grep mongod
```

### 副本集无法初始化

1. 确保所有节点都在运行：
```bash
systemctl status mongod-27017 mongod-27018 mongod-27019
```

2. 手动初始化副本集：
```bash
mongosh --port 27017 --eval '
rs.initiate({
  _id: "rs",
  members: [
    { _id: 0, host: "127.0.0.1:27017" },
    { _id: 1, host: "127.0.0.1:27018" },
    { _id: 2, host: "127.0.0.1:27019" }
  ]
})
'
```

## 卸载服务

如需移除 systemd 服务配置：

```bash
sudo bash scripts/setup_mongodb_systemd.sh REMOVE=1
```

这将：
- 停止所有 MongoDB 服务
- 禁用开机自启动
- 删除 systemd 服务单元文件
- 不会删除数据目录和日志文件

## 重要提示

1. **数据备份**: 在进行任何维护操作前，请确保备份数据
2. **生产环境**: 建议调整缓存大小 (`--wiredTigerCacheSizeGB`) 以适应实际内存
3. **安全性**: 生产环境应启用认证和访问控制
4. **监控**: 建议配置监控系统监控 MongoDB 服务状态

## 相关文件

- **安装脚本**: `scripts/install_mongodb_arm64.sh`
- **系统服务配置**: `scripts/setup_mongodb_systemd.sh`
- **服务单元**: `/etc/systemd/system/mongod-*.service`
- **数据目录**: `/data/db27017`, `/data/db27018`, `/data/db27019`
- **日志目录**: `/var/log/mongodb/`
- **PID 目录**: `/var/run/mongodb/`

## 参考资源

- [MongoDB 官方文档](https://docs.mongodb.com/manual/)
- [Systemd 服务管理](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [MongoDB 副本集部署](https://docs.mongodb.com/manual/tutorial/deploy-replica-set/)
