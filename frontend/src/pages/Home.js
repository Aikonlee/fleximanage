import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './Home.css';

const Home = () => {
  const [deviceStats, setDeviceStats] = useState({
    running: 0,
    notRunning: 0,
    connected: 0,
    notConnected: 0,
    approved: 0,
    notApproved: 0,
    warning: 0
  });

  const [tunnelStats, setTunnelStats] = useState({
    connected: 0,
    notConnected: 0,
    pending: 0,
    unknown: 0
  });

  const [trafficStats, setTrafficStats] = useState({
    total: '0 B',
    totalBytes: 0,
    lastUpdate: null
  });

  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Fetch data only on component mount
    fetchDashboardData();
  }, []);

  const initializeMap = (devicesList = []) => {
    // 延迟初始化，确保 DOM 已准备好
    setTimeout(() => {
      if (!window.L) {
        console.warn('Leaflet 库未加载');
        return;
      }

      const mapElement = document.getElementById('map');
      if (!mapElement) {
        console.warn('地图容器未找到');
        return;
      }

      // 如果地图已初始化过，先清理它
      if (mapElement._leaflet_id) {
        console.log('地图已存在，跳过重新初始化');
        return;
      }

      try {
        // 确保地图容器有高度
        if (!mapElement.style.height) {
          mapElement.style.height = '400px';
        }

        const map = window.L.map('map', {
          zoomControl: true
        }).setView([50.1109, 8.6821], 5);

        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // 应用滤镜效果
        const tilePanes = document.querySelector('.leaflet-tile-pane');
        if (tilePanes) {
          tilePanes.style.filter = "grayscale(20%) sepia(10%)";
        }

        // 添加设备标记
        if (devicesList && devicesList.length > 0) {
          devicesList.forEach((device) => {
            // Device coords is [longitude, latitude]
            const coords = device.coords || [];
            if (coords.length === 2) {
              const [longitude, latitude] = coords;
              const status = device.status === 'running' ? 'running' : 'stopped';
              const color = device.status === 'running' ? '#4dbd74' : '#f86c6b';
              
              // 创建自定义图标
              const icon = window.L.divIcon({
                className: 'device-marker',
                html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
                iconSize: [24, 24],
                popupAnchor: [0, -12]
              });

              // 添加标记和弹窗
              const marker = window.L.marker([latitude, longitude], { icon })
                .bindPopup(`<strong>${device.name}</strong><br/>Status: ${status}<br/>IP: ${device.ipAddress || 'N/A'}`);
              
              marker.addTo(map);
            }
          });
        }

        console.log('地图初始化成功，添加了', devicesList.length, '个设备标记');

      } catch (err) {
        console.error('地图初始化错误:', err);
      }
    }, 200);
  };

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await api.get('/organizations/summary');
      const data = response.data;
      console.log('[Home] Summary API response:', data);
      
      // 获取详细的设备列表（包含地理位置信息和准确的状态）
      let devicesList = [];
      try {
        console.log('[Home] Fetching devices from /devices endpoint...');
        const devicesResponse = await api.get('/devices');
        console.log('[Home] Devices API response:', devicesResponse.data);
        devicesList = devicesResponse.data?.devices || devicesResponse.data || [];
        console.log('[Home] Parsed devicesList:', devicesList);
      } catch (err) {
        console.warn('[Home] Failed to fetch /devices, falling back to summary API data:', err);
        // 如果 /devices 失败，回退到 summary API 的数据
        if (data.devices && Array.isArray(data.devices)) {
          devicesList = data.devices;
          console.log('[Home] Using devices from summary API:', devicesList);
        }
      }
      
      console.log('[Home] Final devicesList after logic:', {
        length: devicesList.length,
        data: devicesList
      });
      
      // 详细日志：显示每个设备的status字段值
      if (devicesList.length > 0) {
        console.log('[Home] Sample device objects:');
        devicesList.slice(0, 3).forEach((d, i) => {
          console.log(`  Device ${i}:`, {
            name: d.name,
            status: d.status,
            statusType: typeof d.status,
            isConnected: d.isConnected,
            isApproved: d.isApproved,
            fullObj: d
          });
        });
      }
      
      setDevices(devicesList);
      
      // 根据实际设备列表计算统计数据，而不是依赖summary API
      // Note: Device schema:
      //   - status: 'running' | 'stopped' | 'failed' | '' (是否启动了vRouter)
      //   - isConnected: true | false (与后台通讯是否正常)
      //   - isApproved: true | false (设备是否已批准)
      const deviceTotal = devicesList.length;
      const deviceRunning = devicesList.filter(d => d.status === 'running').length;
      const deviceConnected = devicesList.filter(d => d.isConnected === true).length;
      const deviceApproved = devicesList.filter(d => d.isApproved === true).length;
      const deviceNotRunning = deviceTotal - deviceRunning;
      
      console.log('[Home] Calculated device stats:', {
        total: deviceTotal,
        running: deviceRunning,
        notRunning: deviceTotal - deviceRunning,
        connected: deviceConnected,
        notConnected: deviceTotal - deviceConnected,
        approved: deviceApproved,
        notApproved: deviceTotal - deviceApproved
      });
      
      setDeviceStats({
        running: deviceRunning,
        notRunning: deviceNotRunning,
        connected: deviceConnected,
        notConnected: Math.max(0, deviceTotal - deviceConnected),
        approved: deviceApproved,
        notApproved: Math.max(0, deviceTotal - deviceApproved),
        warning: 0
      });

      // 更新隧道统计
      const tunnelTotal = data.tunnels?.total || 0;
      const tunnelActive = data.tunnels?.active || 0;
      
      console.log('[Home] Tunnel stats from summary:', {
        total: tunnelTotal,
        active: tunnelActive
      });
      
      setTunnelStats({
        connected: tunnelActive,
        notConnected: Math.max(0, tunnelTotal - tunnelActive),
        pending: 0,
        unknown: 0
      });

      // 更新流量统计
      if (data.traffic) {
        setTrafficStats({
          total: `${(data.traffic.total || 0).toFixed(2)} ${data.traffic.unit || 'MBytes'}`,
          totalBytes: data.traffic.totalBytes || 0,
          lastUpdate: data.traffic.lastUpdate
        });
      } else {
        setTrafficStats({
          total: '0 B',
          totalBytes: 0,
          lastUpdate: null
        });
      }

      // 初始化地图并添加设备标记
      initializeMap(devicesList);

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setError(error.response?.data?.message || error.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // Format last update time
  const formatLastUpdate = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch (e) {
      return 'N/A';
    }
  };

  return (
    <div className="home-page">
      <div className="container">
        {/* 面包屑 */}
        <div className="breadcrumb">Home</div>
        
        {/* 大标题和刷新按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h1>Home</h1>
          <button 
            className="btn btn-primary" 
            onClick={fetchDashboardData}
            disabled={loading}
            style={{ height: '40px', minWidth: '100px' }}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="card error-card">
            <div className="card-body error-body">
              <strong>Error:</strong> {error}
              <button 
                className="btn-retry" 
                onClick={fetchDashboardData}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* 第一部分：Network Status */}
        <div className="card">
          <div className="card-header">Network Status</div>
          <div className="card-body">
            <div className="status-table">
              
              {/* Devices 行 */}
              <div className="status-row">
                <div className="status-label">Devices</div>
                <div className="status-content">
                  <div className="status-group-container">
                    {/* Running */}
                    <div className="status-item green">
                      <div className="status-title">Running</div>
                      <div className="circle">{loading ? '-' : deviceStats.running}</div>
                    </div>
                    <div className="dots">....</div>
                    
                    {/* Not Running */}
                    <div className="status-item red">
                      <div className="status-title">Not Running/NA</div>
                      <div className="circle">{loading ? '-' : deviceStats.notRunning}</div>
                    </div>
                    <div className="dots">....</div>
                    
                    {/* Connected */}
                    <div className="status-item green" style={{marginLeft: '30px'}}>
                      <div className="status-title">Connected</div>
                      <div className="circle">{loading ? '-' : deviceStats.connected}</div>
                    </div>
                    <div className="dots">....</div>

                    {/* Not Connected */}
                    <div className="status-item red">
                      <div className="status-title">Not Connected</div>
                      <div className="circle">{loading ? '-' : deviceStats.notConnected}</div>
                    </div>
                    <div className="dots">....</div>

                    {/* Approved */}
                    <div className="status-item green" style={{marginLeft: '30px'}}>
                      <div className="status-title">Approved</div>
                      <div className="circle">{loading ? '-' : deviceStats.approved}</div>
                    </div>
                    <div className="dots">....</div>

                    {/* Not Approved */}
                    <div className="status-item grey">
                      <div className="status-title">Not Approved</div>
                      <div className="circle">{loading ? '-' : deviceStats.notApproved}</div>
                    </div>
                    <div className="dots">....</div>

                    {/* Warning */}
                    <div className="status-item orange" style={{marginLeft: '30px'}}>
                      <div className="status-title">Warning</div>
                      <div className="circle">{loading ? '-' : deviceStats.warning}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tunnels 行 */}
              <div className="status-row">
                <div className="status-label">Tunnels</div>
                <div className="status-content">
                  <div className="status-group-container">
                    {/* Connected */}
                    <div className="status-item green">
                      <div className="status-title">Connected</div>
                      <div className="circle">{loading ? '-' : tunnelStats.connected}</div>
                    </div>
                    <div className="dots">....</div>

                    {/* Not Connected */}
                    <div className="status-item red">
                      <div className="status-title">Not Connected</div>
                      <div className="circle">{loading ? '-' : tunnelStats.notConnected}</div>
                    </div>
                    <div className="dots">....</div>

                    {/* Pending */}
                    <div className="status-item orange">
                      <div className="status-title">Pending</div>
                      <div className="circle">{loading ? '-' : tunnelStats.pending}</div>
                    </div>
                    <div className="dots">....</div>

                    {/* Unknown */}
                    <div className="status-item grey">
                      <div className="status-title">Unknown</div>
                      <div className="circle">{loading ? '-' : tunnelStats.unknown}</div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* 第二部分：Traffic this month */}
        <div className="card">
          <div className="card-header">Traffic this month</div>
          <div className="card-body traffic-body">
            <div className="traffic-info">
              <div className="traffic-label">Total</div>
              <div className="traffic-value">{loading ? 'Loading...' : trafficStats.total}</div>
              <a href="/traffic-dashboard" className="traffic-link">Check traffic dashboard for more</a>
            </div>
          </div>
        </div>

        {/* 第三部分：World Map */}
        <div className="card">
          <div className="card-header">
            World Map 
            <a href="/world-map-dashboard">Larger map in World Map dashboard</a>
          </div>
          <div className="card-body no-padding">
            <div id="map"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;