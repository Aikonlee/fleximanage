# 浏览器Console测试隧道创建API

## 步骤1: 打开浏览器Console

1. 访问: https://manage.miwide.com:3443
2. 登录到FlexiManage
3. 按 F12 打开开发者工具
4. 切换到 "Console" 标签页

## 步骤2: 获取设备列表

在Console中运行:

```javascript
// 获取token
const token = localStorage.getItem('token');
console.log('Token:', token ? token.substring(0, 30) + '...' : 'NOT FOUND');

// 获取设备列表
fetch('https://manage.miwide.com:3443/api/devices', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(r => r.json())
.then(devices => {
  console.log('设备数量:', devices.length);
  // 获取前4个设备ID
  window.deviceIds = devices.slice(0, 4).map(d => d._id);
  console.log('设备IDs:', window.deviceIds);
});
```

## 步骤3: 测试隧道创建API

等待步骤2完成后，运行:

```javascript
// 创建Full-Mesh隧道
fetch('https://manage.miwide.com:3443/api/devices/execute', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    deviceIds: window.deviceIds,
    action: 'add-tunnel',
    params: {
      topology: 'full-mesh'
    }
  })
})
.then(response => {
  console.log('HTTP状态:', response.status);
  console.log('状态文本:', response.statusText);
  return response.json();
})
.then(data => {
  console.log('响应数据:', data);
  if (data.message) {
    alert('成功: ' + data.message);
  }
})
.catch(error => {
  console.error('错误:', error);
  alert('失败: ' + error.message);
});
```

## 步骤4: 查看Network标签页

1. 切换到 "Network" 标签页
2. 找到 `execute` 请求
3. 查看:
   - Request URL
   - Request Method
   - Status Code
   - Request Headers
   - Request Payload
   - Response

## 如果看到405错误

检查:
1. Request URL 是否是 `https://manage.miwide.com:3443/api/devices/execute`
2. Method 是否是 `POST`
3. 是否有CORS预检(OPTIONS)请求失败

## 如果看到401错误

说明:
- 路由正常工作
- 但token无效或过期
- 需要重新登录

## 如果看到400/500错误

说明:
- 路由正常工作
- 但请求参数或服务器逻辑有问题
- 查看Response了解详细错误信息

## 成功的响应示例

```json
{
  "ids": [...],
  "status": "completed",
  "message": "Creating tunnels in fullMesh topology",
  "topology": "full-mesh"
}
```

HTTP状态码应该是 200 或 202
