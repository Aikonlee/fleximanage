# 隧道删除API说明

## FlexiWAN隧道删除的正确方法

根据后端代码分析,FlexiWAN删除隧道使用的是 **dispatcher模式**,而不是直接的REST DELETE。

### 删除隧道的正确API

**端点**: `POST /api/devices/apply`

**方法**: `deltunnels`

**请求格式**:
```json
{
  "method": "deltunnels",
  "tunnels": {
    "68ee1d22e921bb5893c42ffc": true,
    "68ee1d22e921bb5893c42ffd": true
  }
}
```

或使用过滤器删除:
```json
{
  "method": "deltunnels",
  "filters": ["status|equals|down"]
}
```

### 后端代码架构

**文件**: `/root/fleximanage/backend/deviceLogic/dispatcher.js`

```javascript
deltunnels: {
  apply: tunnels.apply.applyTunnelDel,      // 执行删除
  complete: tunnels.complete.completeTunnelDel,  // 完成回调
  error: errorNOOP                          // 错误处理
}
```

**删除实现**: `/root/fleximanage/backend/deviceLogic/tunnels.js`

关键函数:
1. `applyTunnelDel()` - 主删除函数
2. `delTunnel()` - 单个隧道删除逻辑
3. `prepareTunnelRemoveJob()` - 准备设备任务
4. `sendRemoveTunnelsJobs()` - 发送任务到设备

### 删除流程

1. **验证隧道存在且活动**
   ```javascript
   tunnelsModel.find({ _id: { $in: tunnelIds }, isActive: true, org: data.org })
   ```

2. **检查静态路由依赖**
   ```javascript
   // 确保没有静态路由使用此隧道
   if ([ip1, ip2].includes(s.gateway)) {
     throw new Error('Static routes defined via removed tunnel');
   }
   ```

3. **更新数据库**
   ```javascript
   updateOps.push({
     updateOne: {
       filter: { _id, org: org._id },
       update: {
         isActive: false,
         deviceAconf: false,
         deviceBconf: false,
         status: 'down',
         tunnelKeys: null
       }
     }
   });
   ```

4. **发送设备任务**
   ```javascript
   tasksDeviceA.push({ entity: 'agent', message: 'remove-tunnel', params: removeParams });
   tasksDeviceB.push({ entity: 'agent', message: 'remove-tunnel', params: removeParams });
   ```

5. **清理内存状态**
   ```javascript
   deviceStatus.clearTunnelStatus(deviceA.machineId, num);
   deviceStatus.clearTunnelStatus(deviceB.machineId, num);
   ```

### 前端实现建议

修改 `frontend/src/pages/Tunnels.js`:

```javascript
const handleDeleteTunnel = async (tunnelId) => {
  if (!window.confirm('Are you sure you want to delete this tunnel?')) {
    return;
  }
  
  try {
    // 使用正确的deltunnels方法
    const response = await api.post('/devices/apply', {
      method: 'deltunnels',
      tunnels: {
        [tunnelId]: true
      }
    });
    
    if (response.data) {
      alert('Tunnel deletion job queued successfully');
      fetchTunnelsAndDevices();
    }
  } catch (error) {
    console.error('Error deleting tunnel:', error);
    alert('Failed to delete tunnel: ' + (error.response?.data?.message || error.message));
  }
};
```

### 返回数据格式

```json
{
  "ids": ["job-id-1", "job-id-2"],
  "status": "completed",
  "message": "tunnel deletion jobs added."
}
```

### 注意事项

1. **异步操作**: 删除是异步的,返回job IDs
2. **批量删除**: 可以一次删除多个隧道
3. **依赖检查**: 自动检查静态路由依赖
4. **设备任务**: 会向两端设备发送remove-tunnel任务
5. **数据库**: 隧道标记为`isActive: false`,不是物理删除
6. **状态清理**: 自动清理内存中的隧道状态

### 测试命令

```bash
# 获取隧道列表
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://manage.miwide.com:3443/api/tunnels"

# 删除隧道
curl -k -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "deltunnels",
    "tunnels": {
      "68ee1d22e921bb5893c42ffc": true
    }
  }' \
  "https://manage.miwide.com:3443/api/devices/apply"

# 查看任务状态
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://manage.miwide.com:3443/api/jobs"
```

---

**更新时间**: 2025-10-14  
**结论**: 不要使用`DELETE /tunnels/{id}`,应该使用`POST /devices/apply`与`method: 'deltunnels'`
