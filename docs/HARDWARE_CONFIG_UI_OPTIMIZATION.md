# Hardware Configuration UI - CPU Optimization Feature

## 概述

在设备的 Hardware Configuration 界面中添加了实时 CPU 优化建议功能,帮助用户根据设备实际配置做出最佳的 CPU 分配决策。

## 功能位置

**路径:** Device Details → General Tab → Hardware Configuration Button

**URL示例:** `https://manage.miwide.com:3443/devices/{deviceId}`

## 界面元素

### Hardware Configuration Modal

当用户点击 "Hardware Configuration" 按钮时,会弹出配置对话框,包含以下元素:

1. **HW CPU cores** (只读)
   - 显示设备的物理 CPU 核心数
   - 例如: 4

2. **Current vRouter cores** (只读)
   - 显示当前实际使用的 vRouter 核心数
   - 例如: 1

3. **vRouter cores** (可编辑)
   - 允许用户修改 vRouter 核心分配
   - 范围: 1 到 HW CPU cores
   - 例如: 用户可以将其从 1 改为 2

4. **CPU Optimization Analysis** (新增)
   - 根据设备配置自动显示优化建议
   - 分为两种状态:
     - ✓ **Optimally Configured** (绿色提示框)
     - ⚠ **Optimization Available** (黄色提示框)

5. **Power Saving** (开关)
   - 启用/禁用省电模式

## CPU Optimization Analysis 详细信息

### 优化状态

#### 1. Optimally Configured (最优配置)
```
✓ Optimally Configured
Your device is using the recommended configuration.

Current: 4 VPP cores (62.5% utilization)
Hardware: 8 cores total
✓ QoS Enabled
```

**显示条件:**
- 当前 VPP 核心数 = 推荐核心数
- `optimization.status === 'optimal'`

#### 2. Optimization Available (可优化)
```
⚠ Optimization Available
Device is using 1 vRouter core but can benefit from 2 cores for better performance.

Recommended: 2 VPP cores (currently 1)
Expected gain: 2.0x (100% improvement)

Current utilization: 50.0%
Recommended utilization: 75.0%
WAN interfaces: 1
Device is ready for QoS deployment

[Apply Recommended Configuration]
```

**显示条件:**
- 当前 VPP 核心数 < 推荐核心数
- `optimization.status === 'underutilized'`

**可用信息:**
- 当前和推荐的核心数对比
- 预期性能提升百分比
- CPU 利用率
- WAN 接口数量
- QoS 兼容性状态

**操作:**
- 点击 "Apply Recommended Configuration" 按钮自动填充推荐值

### 3. Minimal Configuration (最小配置)
```
⚠ Device has minimal CPU configuration (2 cores). No optimization available.
```

**显示条件:**
- 设备只有 2 个 CPU 核心
- `optimization.status === 'minimal'`

### 4. Over-allocated (过度分配)
```
⚠ Device is using 6 vRouter cores, which may be more than needed. Recommended: 4 cores.
```

**显示条件:**
- 当前 VPP 核心数 > 推荐核心数
- `optimization.status === 'over-allocated'`

## API 端点

### GET /devices/{id}/cpu-optimization

获取设备的 CPU 优化建议

**请求参数:**
- `id` (path): 设备 ID
- `org` (query): 组织 ID

**响应示例:**
```json
{
  "deviceId": "68f06bf0db5775a14c42156c",
  "hostname": "Branch-Office-Router",
  "current": {
    "hwCores": 4,
    "vppCores": 1,
    "configuredVppCores": 1,
    "powerSaving": false,
    "utilization": "50.0%"
  },
  "recommended": {
    "vppCores": 2,
    "utilization": "75.0%",
    "improvement": "+100%"
  },
  "optimization": {
    "status": "underutilized",
    "message": "Device is using 1 vRouter core but can benefit from 2 cores for better performance.",
    "canOptimize": true,
    "estimatedThroughputGain": "2.0x (100% improvement)"
  },
  "workload": {
    "wanInterfaces": 1,
    "hasQos": false,
    "qosCompatible": true,
    "qosRecommendation": "Device is ready for QoS deployment"
  },
  "recommendations": [
    {
      "priority": "high",
      "action": "increase_vpp_cores",
      "description": "Increase vRouter cores from 1 to 2",
      "expectedBenefit": "Estimated 100% throughput improvement",
      "steps": [
        "Go to Device Settings → Hardware Configuration",
        "Set vRouter Cores to 2",
        "Apply changes (device will restart)"
      ]
    }
  ]
}
```

## 前端实现

### 文件: `/root/fleximanage/frontend/src/pages/DeviceInfo.js`

**新增状态:**
```javascript
const [cpuOptimization, setCpuOptimization] = useState(null);
const [loadingOptimization, setLoadingOptimization] = useState(false);
```

**新增函数:**
```javascript
const fetchCpuOptimization = useCallback(async () => {
  if (!deviceId) return;
  
  setLoadingOptimization(true);
  try {
    const response = await apiCall(`/devices/${deviceId}/cpu-optimization`, {
      method: 'GET'
    });
    
    if (response && response.ok) {
      const data = await response.json();
      setCpuOptimization(data);
    }
  } catch (error) {
    console.error('Error fetching CPU optimization:', error);
  } finally {
    setLoadingOptimization(false);
  }
}, [deviceId, apiCall]);
```

**调用时机:**
- 设备信息加载完成后自动调用
- 用户打开 Hardware Configuration 弹窗时显示

## 后端实现

### 文件位置
- API 定义: `/root/fleximanage/backend/api/openapi.yaml`
- 控制器: `/root/fleximanage/backend/controllers/DevicesController.js`
- 服务: `/root/fleximanage/backend/services/DevicesService.js`
- 工具函数: `/root/fleximanage/backend/utils/deviceUtils.js`

### 核心算法

```javascript
/**
 * Calculate optimal VPP cores based on device characteristics
 * @param {Number} hwCores - Hardware CPU cores
 * @param {Boolean} hasQos - Whether QoS is enabled
 * @param {Number} wanInterfaces - Number of WAN interfaces
 * @returns {Number} Recommended VPP cores
 */
const calculateOptimalVppCores = ({ hwCores, hasQos, wanInterfaces }) => {
  // Algorithm logic...
  // 2 cores: 1 VPP core
  // 3-4 cores: 2 VPP cores
  // 5-8 cores: 60% allocation
  // 9-16 cores: 60-75% allocation
  // 17+ cores: 60-75% with interface scaling
};
```

## 优化建议规则

### 1. 核心数分配
| CPU 核心 | 推荐 VPP 核心 | 说明 |
|---------|-------------|------|
| 2 | 1 | 最小配置,无优化空间 |
| 3-4 | 2 | 小型部署 |
| 5-8 | 60% (3-4) | 中型部署 |
| 9-16 | 60-75% (5-12) | 大型部署 |
| 17+ | 60-75% + 接口调整 | 企业级部署 |

### 2. QoS 要求
- **最低要求:** 2 个 VPP 核心
- **推荐:** 3+ CPU 核心的设备
- **检查:** 自动检测 QoS 策略并验证兼容性

### 3. 多 WAN 接口调整
- 每增加 2 个 WAN 接口,额外分配 1 个 VPP 核心
- 确保高流量场景下的性能

## 用户工作流程

1. **查看设备信息**
   - 访问设备详情页面
   - 切换到 General 标签页

2. **打开硬件配置**
   - 点击 "Hardware Configuration" 按钮
   - 查看当前 CPU 配置

3. **查看优化建议**
   - 自动显示 CPU Optimization Analysis
   - 如果有优化空间,显示黄色提示框
   - 如果已最优,显示绿色提示框

4. **应用优化**
   - 如果需要优化,点击 "Apply Recommended Configuration"
   - 推荐值自动填入 vRouter cores 字段
   - 点击 "Apply Configuration" 应用更改
   - 设备将重启并应用新配置

5. **验证结果**
   - 等待设备重启完成
   - 重新查看 Hardware Configuration
   - 确认显示为 "Optimally Configured"

## 性能预期

### 示例场景

#### 场景 1: 4核设备优化
- **优化前:** 1 VPP 核心 → ~2 Gbps
- **优化后:** 2 VPP 核心 → ~4.8 Gbps
- **提升:** +140%

#### 场景 2: 8核设备优化
- **优化前:** 1 VPP 核心 → ~2 Gbps
- **优化后:** 4 VPP 核心 → ~9.6 Gbps
- **提升:** +380%

#### 场景 3: 16核设备优化
- **优化前:** 1 VPP 核心 → ~2 Gbps
- **优化后:** 9 VPP 核心 → ~21.6 Gbps
- **提升:** +980%

## 测试清单

- [ ] 访问设备详情页面
- [ ] 点击 "Hardware Configuration" 按钮
- [ ] 验证显示当前 CPU 配置
- [ ] 验证显示 CPU Optimization Analysis
- [ ] 对于未优化设备,验证显示优化建议
- [ ] 点击 "Apply Recommended Configuration" 按钮
- [ ] 验证推荐值自动填入
- [ ] 修改 vRouter cores 值
- [ ] 点击 "Apply Configuration"
- [ ] 验证配置成功应用
- [ ] 验证设备重启后配置生效
- [ ] 验证优化后状态变为 "Optimally Configured"

## 注意事项

1. **设备重启**
   - 修改 vRouter cores 需要重启设备
   - 建议在维护窗口期间操作

2. **最小配置**
   - 2核设备无优化空间
   - 系统会明确提示

3. **QoS 要求**
   - QoS 功能需要至少 2 个 VPP 核心
   - 系统会自动检查并提示

4. **性能权衡**
   - 更多核心 = 更高性能
   - 但也会增加 CPU 整体负载
   - 推荐配置已考虑平衡

## 故障排除

### 问题: 优化建议未显示
**解决方案:**
1. 检查后端服务是否正常运行
2. 检查 API 端点是否可访问: `/api/devices/{id}/cpu-optimization`
3. 查看浏览器控制台错误信息
4. 检查设备是否有有效的 CPU 信息

### 问题: 应用配置后未生效
**解决方案:**
1. 确认设备已完全重启
2. 检查设备日志
3. 验证配置是否正确保存到数据库
4. 重新打开 Hardware Configuration 查看当前值

### 问题: 推荐值不合理
**解决方案:**
1. 检查设备的实际 CPU 核心数
2. 验证 WAN 接口数量是否正确
3. 检查 QoS 策略是否正确识别
4. 查看后端日志获取详细计算过程

## 相关文档

- [VPP DPDK CPU Optimization](./VPP_DPDK_CPU_OPTIMIZATION.md)
- [VPP CPU Optimization Implementation](./VPP_CPU_OPTIMIZATION_IMPLEMENTATION.md)
- [VPP CPU Optimization Final Report](./VPP_CPU_OPTIMIZATION_FINAL_REPORT.md)

## 更新历史

- **2025-10-17**: 初始版本 - 添加 CPU 优化建议到 Hardware Configuration UI
