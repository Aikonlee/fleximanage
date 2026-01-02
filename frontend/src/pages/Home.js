import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Row, Col, Alert } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { FaSync, FaServer, FaNetworkWired, FaChartArea, FaGlobeAmericas, FaExclamationTriangle } from 'react-icons/fa';
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
              const color = device.status === 'running' ? '#27ae60' : '#e74c3c'; // Use theme colors
              
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

  const fetchDashboardData = useCallback(async () => {
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
      
      // 根据实际设备列表计算统计数据
      const deviceTotal = devicesList.length;
      const deviceRunning = devicesList.filter(d => d.status === 'running').length;
      const deviceConnected = devicesList.filter(d => d.isConnected === true).length;
      const deviceApproved = devicesList.filter(d => d.isApproved === true).length;
      const deviceNotRunning = deviceTotal - deviceRunning;
      
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
  }, []);

  useEffect(() => {
    // Fetch data only on component mount
    fetchDashboardData();
  }, [fetchDashboardData]);

  const renderStatusItem = (title, count, colorClass, icon = null) => (
    <div className="text-center p-3 border rounded h-100 bg-white shadow-sm status-card-item">
      <div className={`status-value text-${colorClass} mb-1 display-6 fw-bold`}>
        {loading ? '-' : count}
      </div>
      <div className="text-muted small fw-bold text-uppercase d-flex align-items-center justify-content-center">
        {icon && <span className="me-1">{icon}</span>}
        {title}
      </div>
    </div>
  );

  return (
    <div className="home-page p-3 p-md-4">
      <div className="container-fluid">
        {/* Page Header */}
        <div className="page-header d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom">
          <div>
            <h1 className="h2 mb-0 text-primary fw-bold">Dashboard</h1>
            <p className="text-muted mb-0 mt-1 small">Overview of your network status</p>
          </div>
          <Button 
            variant="primary" 
            onClick={fetchDashboardData}
            disabled={loading}
            className="d-flex align-items-center shadow-sm"
          >
            <FaSync className={`me-2 ${loading ? 'fa-spin' : ''}`} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible className="shadow-sm">
            <Alert.Heading className="h5 d-flex align-items-center">
              <FaExclamationTriangle className="me-2" /> Error Loading Dashboard
            </Alert.Heading>
            <p className="mb-0">{error}</p>
            <div className="mt-2">
              <Button variant="outline-danger" size="sm" onClick={fetchDashboardData}>Try Again</Button>
            </div>
          </Alert>
        )}

        <Row className="mb-4">
          <Col lg={8} className="mb-4 mb-lg-0">
            {/* Network Status Card */}
            <Card className="h-100 shadow-sm border-0">
              <Card.Header className="bg-white border-bottom py-3">
                <h5 className="mb-0 text-primary d-flex align-items-center">
                  <FaServer className="me-2" />
                  Network Status
                </h5>
              </Card.Header>
              <Card.Body>
                <h6 className="text-muted text-uppercase small fw-bold mb-3">Devices</h6>
                <Row className="g-3 mb-4">
                  <Col xs={6} md={4} lg={2}>
                    {renderStatusItem('Running', deviceStats.running, 'success')}
                  </Col>
                  <Col xs={6} md={4} lg={2}>
                    {renderStatusItem('Stopped', deviceStats.notRunning, 'danger')}
                  </Col>
                  <Col xs={6} md={4} lg={2}>
                    {renderStatusItem('Connected', deviceStats.connected, 'info')}
                  </Col>
                  <Col xs={6} md={4} lg={2}>
                    {renderStatusItem('Offline', deviceStats.notConnected, 'secondary')}
                  </Col>
                  <Col xs={6} md={4} lg={2}>
                    {renderStatusItem('Approved', deviceStats.approved, 'success')}
                  </Col>
                  <Col xs={6} md={4} lg={2}>
                    {renderStatusItem('Pending', deviceStats.notApproved, 'warning')}
                  </Col>
                </Row>

                <h6 className="text-muted text-uppercase small fw-bold mb-3">Tunnels</h6>
                <Row className="g-3">
                  <Col xs={6} md={3}>
                    {renderStatusItem('Connected', tunnelStats.connected, 'success', <FaNetworkWired />)}
                  </Col>
                  <Col xs={6} md={3}>
                    {renderStatusItem('Down', tunnelStats.notConnected, 'danger', <FaExclamationTriangle />)}
                  </Col>
                  <Col xs={6} md={3}>
                    {renderStatusItem('Pending', tunnelStats.pending, 'warning')}
                  </Col>
                  <Col xs={6} md={3}>
                    {renderStatusItem('Unknown', tunnelStats.unknown, 'secondary')}
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4}>
            {/* Traffic Card */}
            <Card className="shadow-sm border-0 mb-4">
              <Card.Header className="bg-white border-bottom py-3">
                <h5 className="mb-0 text-primary d-flex align-items-center">
                  <FaChartArea className="me-2" />
                  Traffic (This Month)
                </h5>
              </Card.Header>
              <Card.Body className="text-center py-4">
                <div className="display-4 fw-bold text-dark mb-2">{loading ? '...' : trafficStats.total}</div>
                <div className="text-muted small mb-3">Total Data Transferred</div>
                <Link to="/traffic-dashboard" className="btn btn-outline-primary btn-sm rounded-pill px-4">
                  View Details
                </Link>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Map Card */}
        <Card className="shadow-sm border-0">
          <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <h5 className="mb-0 text-primary d-flex align-items-center">
              <FaGlobeAmericas className="me-2" />
              World Map
            </h5>
            <Link to="/world-map-dashboard" className="btn btn-link btn-sm text-decoration-none">
              View Larger Map &rarr;
            </Link>
          </Card.Header>
          <Card.Body className="p-0">
            <div id="map" style={{ height: '400px', width: '100%', borderRadius: '0 0 0.375rem 0.375rem' }}></div>
          </Card.Body>
        </Card>
      </div>
    </div>
  );
};

export default Home;