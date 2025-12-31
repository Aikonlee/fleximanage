import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Badge, Button, Alert, Form } from 'react-bootstrap';
import { FaRoute, FaTrash, FaSync, FaNetworkWired } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './Tunnels.css';

const Tunnels = () => {
  const [tunnels, setTunnels] = useState([]);
  const [devices, setDevices] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ connected: 0, disconnected: 0, total: 0 });
  const [selectedTunnels, setSelectedTunnels] = useState(new Set());
  const [batchOspfLoading, setBatchOspfLoading] = useState(false);
  const navigate = useNavigate();

  const fetchTunnelsAndDevices = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      console.log('TUNNELS: Token check - exists:', !!token);
      if (!token) {
        console.log('TUNNELS: No token found, redirecting to login');
        navigate('/login');
        return;
      }

      // Fetch devices first
      console.log('TUNNELS: Fetching devices...');
      const devicesResponse = await api.get('/devices?response=detailed');
      const devicesData = devicesResponse.data;
      console.log('TUNNELS: Devices fetched:', devicesData.length);
      
      // Create device map
      const deviceMap = {};
      devicesData.forEach(device => {
        const deviceId = device._id || device.id;
        deviceMap[deviceId] = {
          name: device.name || device.hostname || 'Unknown',
          hostname: device.hostname,
          interfaces: device.interfaces || []
        };
      });
      
      // Fetch tunnels
      console.log('TUNNELS: Fetching tunnels...');
      const tunnelsResponse = await api.get('/tunnels');
      const tunnelsData = tunnelsResponse.data;
      console.log('TUNNELS: Tunnels fetched:', tunnelsData.length, tunnelsData);
      
      // Calculate stats
      const connected = tunnelsData.filter(t => t.isActive).length;
      const total = tunnelsData.length;
      
      setDevices(deviceMap);
      setTunnels(tunnelsData);
      setStats({
        connected: connected,
        disconnected: total - connected,
        total: total
      });
      setError(null);
      setLoading(false);
    } catch (error) {
      console.error('TUNNELS: Error fetching data:', error);
      console.error('TUNNELS: Error response:', error.response?.data);
      console.error('TUNNELS: Error status:', error.response?.status);
      setError(error.message || 'Failed to fetch tunnels');
      setLoading(false);
      
      if (error.response?.status === 401) {
        console.log('TUNNELS: 401 error - clearing token and redirecting');
        localStorage.removeItem('token');
        navigate('/login');
      }
    }
  }, [navigate]);

  useEffect(() => {
    fetchTunnelsAndDevices();
    const interval = setInterval(fetchTunnelsAndDevices, 30000);
    return () => clearInterval(interval);
  }, [fetchTunnelsAndDevices]);

  const getDeviceName = (deviceObj) => {
    if (!deviceObj) return 'N/A';
    // If deviceObj is an object (populated from API), use its properties directly
    if (typeof deviceObj === 'object') {
      // Try to get name, hostname, or _id
      if (deviceObj.name) return deviceObj.name;
      if (deviceObj.hostname) return deviceObj.hostname;
      if (deviceObj._id) return deviceObj._id.toString().substring(0, 8);
      if (deviceObj.id) return deviceObj.id.toString().substring(0, 8);
      return 'Unknown';
    }
    // Otherwise treat it as an ID and look it up
    const deviceId = deviceObj;
    const device = devices[deviceId?.toString()];
    return device ? (device.name || device.hostname || deviceId.toString().substring(0, 8)) : (deviceId?.toString().substring(0, 8) || 'N/A');
  };

  const getInterfaceName = (deviceObj, interfaceId) => {
    if (!deviceObj || !interfaceId) return 'N/A';
    // If deviceObj is populated, use its interfaces directly
    let deviceInterfaces = [];
    if (typeof deviceObj === 'object' && Array.isArray(deviceObj.interfaces)) {
      deviceInterfaces = deviceObj.interfaces;
    } else {
      // Otherwise look up device by ID
      const deviceId = typeof deviceObj === 'object' ? (deviceObj._id || deviceObj.id) : deviceObj;
      const device = devices[deviceId?.toString()];
      if (device && Array.isArray(device.interfaces)) {
        deviceInterfaces = device.interfaces;
      }
    }
    if (!deviceInterfaces || deviceInterfaces.length === 0) return 'N/A';
    const iface = deviceInterfaces.find(i => 
      (i._id && i._id.toString() === interfaceId.toString()) ||
      (i.id && i.id.toString() === interfaceId.toString()) ||
      (i.devId && i.devId.toString() === interfaceId.toString())
    );
    return iface ? (iface.name || iface.devId || 'N/A') : 'N/A';
  };

  const getStatusBadge = (isActive) => {
    return (
      <Badge bg={isActive ? 'success' : 'secondary'}>
        {isActive ? 'Connected' : 'Inactive'}
      </Badge>
    );
  };

  const getEncryptionBadge = (encryptionMethod) => {
    if (!encryptionMethod || encryptionMethod === 'none') {
      return <Badge bg="warning">None</Badge>;
    }
    return <Badge bg="info">{encryptionMethod.toUpperCase()}</Badge>;
  };

  const handleDeleteTunnel = async (tunnelId) => {
    if (!window.confirm('Are you sure you want to delete this tunnel?')) {
      return;
    }
    
    try {
      // Ensure tunnelId is a string
      const id = typeof tunnelId === 'object' ? (tunnelId.toString() || tunnelId._id?.toString()) : tunnelId?.toString();
      
      if (!id) {
        throw new Error('Invalid tunnel ID');
      }
      
      console.log('Deleting tunnel with ID:', id);
      
      // Use the correct FlexiWAN API: POST /devices/apply with method='deltunnels'
      const response = await api.post('/devices/apply', {
        method: 'deltunnels',
        tunnels: {
          [id]: true
        }
      });
      
      if (response.data) {
        const { message, ids } = response.data;
        alert(`Tunnel deletion initiated: ${message}\nJob IDs: ${ids.join(', ')}`);
        fetchTunnelsAndDevices();
      }
    } catch (error) {
      console.error('Error deleting tunnel:', error);
      const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message || 'Unknown error';
      alert('Failed to delete tunnel: ' + errorMsg);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchTunnelsAndDevices();
  };

  if (loading && tunnels.length === 0) {
    return (
      <div className="tunnels-page">
        <div className="text-center p-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-3">Loading tunnels...</p>
        </div>
      </div>
    );
  }

  // Handle checkbox toggle for individual tunnel
  const handleToggleTunnel = (tunnelId) => {
    setSelectedTunnels(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tunnelId)) {
        newSet.delete(tunnelId);
      } else {
        newSet.add(tunnelId);
      }
      return newSet;
    });
  };

  // Handle select all / deselect all
  const handleToggleAll = (e) => {
    if (e.target.checked) {
      setSelectedTunnels(new Set(tunnels.map(t => t._id || t.id)));
    } else {
      setSelectedTunnels(new Set());
    }
  };

  // Handle Batch OSPF configuration
  const handleBatchOspf = async () => {
    if (selectedTunnels.size === 0) {
      alert('请先选择要配置的隧道');
      return;
    }

    if (!window.confirm(`确认为选中的 ${selectedTunnels.size} 个隧道的设备LAN接口自动配置OSPF？`)) {
      return;
    }

    setBatchOspfLoading(true);
    const results = [];
    const errors = [];

    try {
      // Get unique devices from selected tunnels
      const deviceIds = new Set();
      tunnels.forEach(tunnel => {
        const tunnelId = tunnel._id || tunnel.id;
        if (selectedTunnels.has(tunnelId)) {
          // Add deviceA
          const deviceAId = typeof tunnel.deviceA === 'object' ? 
            (tunnel.deviceA._id || tunnel.deviceA.id) : tunnel.deviceA;
          if (deviceAId) deviceIds.add(deviceAId.toString());
          
          // Add deviceB (if not peer)
          if (!tunnel.peer && tunnel.deviceB) {
            const deviceBId = typeof tunnel.deviceB === 'object' ? 
              (tunnel.deviceB._id || tunnel.deviceB.id) : tunnel.deviceB;
            if (deviceBId) deviceIds.add(deviceBId.toString());
          }
        }
      });

      console.log('配置OSPF的设备:', Array.from(deviceIds));

      // Configure OSPF for each device's LAN interfaces
      for (const deviceId of deviceIds) {
        try {
          // Fetch device details
          const deviceResponse = await api.get(`/devices/${deviceId}`);
          
          // Handle API response - may return array or object
          let device = deviceResponse.data;
          if (Array.isArray(device) && device.length > 0) {
            device = device[0]; // Take first element if array
          }
          
          console.log(`设备 ${device?.name || deviceId}:`, {
            responseType: Array.isArray(deviceResponse.data) ? 'array' : 'object',
            hasInterfaces: !!device?.interfaces,
            interfacesCount: device?.interfaces?.length || 0,
            interfaces: device?.interfaces?.map(i => ({
              name: i.name,
              type: i.type,
              isAssigned: i.isAssigned,
              IPv4: i.IPv4
            }))
          });
          
          // Check if device data is valid
          if (!device || !device.interfaces || !Array.isArray(device.interfaces)) {
            console.error(`设备 ${deviceId} 数据无效:`, device);
            results.push(`${device?.name || deviceId}: 设备没有接口信息`);
            continue;
          }
          
          // Find LAN interfaces: assigned, with IP, not WAN type
          const lanInterfaces = device.interfaces.filter(iface => {
            const hasIP = iface.IPv4 && iface.IPv4 !== '';
            const isNotWAN = iface.type !== 'WAN';
            const isLan = iface.isAssigned && hasIP && isNotWAN;
            console.log(`  接口 ${iface.name}: isAssigned=${iface.isAssigned}, type=${iface.type}, IPv4="${iface.IPv4}", 判定=${isLan}`);
            return isLan;
          });

          console.log(`找到 ${lanInterfaces.length} 个LAN接口:`, lanInterfaces.map(i => i.name));

          if (lanInterfaces.length === 0) {
            results.push(`${device.name || deviceId}: 未找到可配置的LAN接口`);
            continue;
          }

          // Update interfaces to enable OSPF
          const updatedInterfaces = device.interfaces.map(iface => {
            const isLan = lanInterfaces.find(lan => 
              (lan._id && lan._id.toString() === iface._id?.toString()) ||
              (lan.devId === iface.devId)
            );
            
            if (isLan) {
              return {
                ...iface,
                routing: 'OSPF',
                ospf: {
                  area: iface.ospf?.area || '0',
                  keyId: iface.ospf?.keyId || '',
                  key: iface.ospf?.key || '',
                  cost: iface.ospf?.cost || 10
                }
              };
            }
            return iface;
          });

          // Update device with OSPF configuration
          await api.put(`/devices/${deviceId}`, {
            interfaces: updatedInterfaces,
            ospf: {
              routerId: device.ospf?.routerId || '',
              helloInterval: device.ospf?.helloInterval || 10,
              deadInterval: device.ospf?.deadInterval || 40,
              redistributeBgp: device.ospf?.redistributeBgp !== false
            }
          });

          results.push(`${device.name || deviceId}: 成功配置 ${lanInterfaces.length} 个LAN接口`);
        } catch (err) {
          console.error(`配置设备 ${deviceId} 失败:`, err);
          console.error('错误详情:', {
            message: err.message,
            response: err.response?.data,
            status: err.response?.status
          });
          const errorMsg = err.response?.data?.message || err.message || '未知错误';
          errors.push(`${deviceId}: ${errorMsg}`);
        }
      }

      // Show results
      let message = '批量OSPF配置完成:\n\n';
      if (results.length > 0) {
        message += '成功:\n' + results.join('\n') + '\n\n';
      }
      if (errors.length > 0) {
        message += '失败:\n' + errors.join('\n');
      }
      alert(message);

      // Clear selection
      setSelectedTunnels(new Set());
      
      // Refresh tunnels
      fetchTunnelsAndDevices();
    } catch (error) {
      console.error('批量OSPF配置错误:', error);
      alert('批量配置失败: ' + error.message);
    } finally {
      setBatchOspfLoading(false);
    }
  };

  return (
    <div className="tunnels-page">
      <div className="page-header mb-4">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2><FaRoute className="me-2" />Tunnels</h2>
            <p className="text-muted mb-0">Manage and monitor network tunnels</p>
          </div>
          <div className="d-flex gap-2">
            {selectedTunnels.size > 0 && (
              <Button 
                variant="success" 
                size="sm" 
                onClick={handleBatchOspf}
                disabled={batchOspfLoading}
              >
                <FaNetworkWired className="me-1" />
                {batchOspfLoading ? '配置中...' : `Batch OSPF (${selectedTunnels.size})`}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={handleRefresh} disabled={loading}>
              <FaSync className={loading ? 'fa-spin' : ''} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Statistics Cards */}
      <div className="row mb-4">
        <div className="col-md-4">
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="text-muted mb-1">Total Tunnels</h6>
                  <h3 className="mb-0">{stats.total}</h3>
                </div>
                <FaRoute size={32} className="text-primary" />
              </div>
            </Card.Body>
          </Card>
        </div>
        <div className="col-md-4">
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="text-muted mb-1">Connected</h6>
                  <h3 className="mb-0 text-success">{stats.connected}</h3>
                </div>
                <FaRoute size={32} className="text-success" />
              </div>
            </Card.Body>
          </Card>
        </div>
        <div className="col-md-4">
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="text-muted mb-1">Inactive</h6>
                  <h3 className="mb-0 text-secondary">{stats.disconnected}</h3>
                </div>
                <FaRoute size={32} className="text-secondary" />
              </div>
            </Card.Body>
          </Card>
        </div>
      </div>

      {/* Tunnels Table */}
      <Card className="border-0 shadow-sm">
        <Card.Body className="p-0">
          <div className="table-responsive">
            <Table hover className="mb-0 align-middle">
              <thead className="bg-light">
                <tr>
                  <th style={{ width: '40px' }}>
                    <Form.Check
                      type="checkbox"
                      checked={tunnels.length > 0 && selectedTunnels.size === tunnels.length}
                      onChange={handleToggleAll}
                      title="全选/取消全选"
                    />
                  </th>
                  <th>ID</th>
                  <th>Device A</th>
                  <th>Interface A</th>
                  <th>Device B / Peer</th>
                  <th>Interface B</th>
                  <th>Path Label</th>
                  <th>AVG Latency</th>
                  <th>Drop Rate</th>
                  <th>Encrypt</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tunnels.length === 0 ? (
                  <tr>
                    <td colSpan="12" className="text-center py-5 text-muted">
                      <FaRoute size={48} className="mb-3 opacity-25" />
                      <p className="mb-0">No tunnels found</p>
                      <small>Create tunnels from the Devices page</small>
                    </td>
                  </tr>
                ) : (
                  tunnels.map((tunnel) => {
                    const tunnelId = tunnel._id || tunnel.id;
                    return (
                      <tr key={tunnelId}>
                        <td>
                          <Form.Check
                            type="checkbox"
                            checked={selectedTunnels.has(tunnelId)}
                            onChange={() => handleToggleTunnel(tunnelId)}
                          />
                        </td>
                        <td>
                          <code className="text-primary">#{tunnel.num || 'N/A'}</code>
                        </td>
                      <td>
                        <strong>{getDeviceName(tunnel.deviceA)}</strong>
                      </td>
                      <td>
                        <span className="text-muted">
                          {getInterfaceName(tunnel.deviceA, tunnel.interfaceA)}
                        </span>
                      </td>
                      <td>
                        {tunnel.peer ? (
                          <span className="badge bg-info">Peer: {tunnel.peer.name || 'Unknown'}</span>
                        ) : (
                          <strong>{getDeviceName(tunnel.deviceB)}</strong>
                        )}
                      </td>
                      <td>
                        <span className="text-muted">
                          {tunnel.peer ? 'N/A' : getInterfaceName(tunnel.deviceB, tunnel.interfaceB)}
                        </span>
                      </td>
                      <td>
                        {tunnel.pathlabel ? (
                          <Badge bg="secondary">{tunnel.pathlabel.name || 'Label'}</Badge>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {tunnel.stats?.latency ? (
                          <span className="text-success">{tunnel.stats.latency.toFixed(2)} ms</span>
                        ) : (
                          <span className="text-muted">N/A</span>
                        )}
                      </td>
                      <td>
                        {tunnel.stats?.dropRate !== undefined ? (
                          <span className={tunnel.stats.dropRate > 0 ? 'text-warning' : 'text-success'}>
                            {tunnel.stats.dropRate.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-muted">N/A</span>
                        )}
                      </td>
                      <td>
                        {getEncryptionBadge(tunnel.encryptionMethod || 'psk')}
                      </td>
                      <td>
                        {getStatusBadge(tunnel.isActive)}
                      </td>
                      <td>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => handleDeleteTunnel(tunnel._id || tunnel.id)}
                          title="Delete tunnel"
                        >
                          <FaTrash />
                        </Button>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>

      {/* Footer Info */}
      {tunnels.length > 0 && (
        <div className="mt-3 text-muted small">
          <p className="mb-0">
            Showing {tunnels.length} tunnel{tunnels.length !== 1 ? 's' : ''} • 
            Last updated: {new Date().toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
};

export default Tunnels;
