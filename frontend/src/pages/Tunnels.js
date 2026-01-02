import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Badge, Button, Alert, Form } from 'react-bootstrap';
import { FaRoute, FaTrash, FaSync, FaNetworkWired, FaExclamationTriangle } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './Tunnels.css';
import '../styles/unified-table.css';

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
      if (!token) {
        navigate('/login');
        return;
      }

      // Fetch devices first
      const devicesResponse = await api.get('/devices?response=detailed');
      const devicesData = devicesResponse.data;
      
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
      const tunnelsResponse = await api.get('/tunnels');
      const tunnelsData = tunnelsResponse.data;
      
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
      setError(error.message || 'Failed to fetch tunnels');
      setLoading(false);
      
      if (error.response?.status === 401) {
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
    if (typeof deviceObj === 'object') {
      if (deviceObj.name) return deviceObj.name;
      if (deviceObj.hostname) return deviceObj.hostname;
      if (deviceObj._id) return deviceObj._id.toString().substring(0, 8);
      if (deviceObj.id) return deviceObj.id.toString().substring(0, 8);
      return 'Unknown';
    }
    const deviceId = deviceObj;
    const device = devices[deviceId?.toString()];
    return device ? (device.name || device.hostname || deviceId.toString().substring(0, 8)) : (deviceId?.toString().substring(0, 8) || 'N/A');
  };

  const getInterfaceName = (deviceObj, interfaceId) => {
    if (!deviceObj || !interfaceId) return 'N/A';
    let deviceInterfaces = [];
    if (typeof deviceObj === 'object' && Array.isArray(deviceObj.interfaces)) {
      deviceInterfaces = deviceObj.interfaces;
    } else {
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
      const id = typeof tunnelId === 'object' ? (tunnelId.toString() || tunnelId._id?.toString()) : tunnelId?.toString();
      if (!id) throw new Error('Invalid tunnel ID');
      
      const response = await api.post('/devices/apply', {
        method: 'deltunnels',
        tunnels: { [id]: true }
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
      <div className="tunnels-page p-4">
        <div className="text-center p-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-3 text-muted">Loading tunnels...</p>
        </div>
      </div>
    );
  }

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

  const handleToggleAll = (e) => {
    if (e.target.checked) {
      setSelectedTunnels(new Set(tunnels.map(t => t._id || t.id)));
    } else {
      setSelectedTunnels(new Set());
    }
  };

  const handleBatchOspf = async () => {
    if (selectedTunnels.size === 0) {
      alert('Please select at least one tunnel to configure first');
      return;
    }

    if (!window.confirm(`Confirm to automatically configure OSPF on LAN interfaces for ${selectedTunnels.size} selected tunnel(s)?`)) {
      return;
    }

    setBatchOspfLoading(true);
    const results = [];
    const errors = [];

    try {
      const deviceIds = new Set();
      tunnels.forEach(tunnel => {
        const tunnelId = tunnel._id || tunnel.id;
        if (selectedTunnels.has(tunnelId)) {
          const deviceAId = typeof tunnel.deviceA === 'object' ? 
            (tunnel.deviceA._id || tunnel.deviceA.id) : tunnel.deviceA;
          if (deviceAId) deviceIds.add(deviceAId.toString());
          
          if (!tunnel.peer && tunnel.deviceB) {
            const deviceBId = typeof tunnel.deviceB === 'object' ? 
              (tunnel.deviceB._id || tunnel.deviceB.id) : tunnel.deviceB;
            if (deviceBId) deviceIds.add(deviceBId.toString());
          }
        }
      });

      for (const deviceId of deviceIds) {
        try {
          const deviceResponse = await api.get(`/devices/${deviceId}`);
          let device = deviceResponse.data;
          if (Array.isArray(device) && device.length > 0) {
            device = device[0];
          }
          
          if (!device || !device.interfaces || !Array.isArray(device.interfaces)) {
            results.push(`${device?.name || deviceId}: Device has no interface information`);
            continue;
          }
          
          const lanInterfaces = device.interfaces.filter(iface => {
            const hasIP = iface.IPv4 && iface.IPv4 !== '';
            const isNotWAN = iface.type !== 'WAN';
            return iface.isAssigned && hasIP && isNotWAN;
          });

          if (lanInterfaces.length === 0) {
            results.push(`${device.name || deviceId}: No configurable LAN interfaces found`);
            continue;
          }

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

          await api.put(`/devices/${deviceId}`, {
            interfaces: updatedInterfaces,
            ospf: {
              routerId: device.ospf?.routerId || '',
              helloInterval: device.ospf?.helloInterval || 10,
              deadInterval: device.ospf?.deadInterval || 40,
              redistributeBgp: device.ospf?.redistributeBgp !== false
            }
          });

          results.push(`${device.name || deviceId}: Successfully configured ${lanInterfaces.length} LAN interface(s)`);
        } catch (err) {
          const errorMsg = err.response?.data?.message || err.message || 'Unknown error';
          errors.push(`${deviceId}: ${errorMsg}`);
        }
      }

      let message = 'Batch OSPF configuration completed:\n\n';
      if (results.length > 0) message += 'Successful:\n' + results.join('\n') + '\n\n';
      if (errors.length > 0) message += 'Failed:\n' + errors.join('\n');
      alert(message);

      setSelectedTunnels(new Set());
      fetchTunnelsAndDevices();
    } catch (error) {
      console.error('Batch OSPF configuration error:', error);
      alert('Batch configuration failed: ' + error.message);
    } finally {
      setBatchOspfLoading(false);
    }
  };

  return (
    <div className="tunnels-page p-3 p-md-4">
      <div className="page-header d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom">
        <div>
          <h1 className="h2 mb-0 text-primary fw-bold">Tunnels</h1>
          <p className="text-muted mb-0 mt-1 small">Manage and monitor network tunnels</p>
        </div>
        <div className="d-flex gap-2">
          {selectedTunnels.size > 0 && (
            <Button 
              variant="success" 
              onClick={handleBatchOspf}
              disabled={batchOspfLoading}
              className="d-flex align-items-center shadow-sm"
            >
              <FaNetworkWired className="me-2" />
              {batchOspfLoading ? 'Configuring...' : `Batch OSPF (${selectedTunnels.size})`}
            </Button>
          )}
          <Button 
            variant="primary" 
            onClick={handleRefresh} 
            disabled={loading}
            className="d-flex align-items-center shadow-sm"
          >
            <FaSync className={`me-2 ${loading ? 'fa-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)} className="shadow-sm">
          <Alert.Heading className="h5 d-flex align-items-center">
            <FaExclamationTriangle className="me-2" /> Error
          </Alert.Heading>
          {error}
        </Alert>
      )}

      {/* Statistics Cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <Card className="border-0 shadow-sm h-100">
            <Card.Body className="d-flex justify-content-between align-items-center">
              <div>
                <h6 className="text-muted text-uppercase small fw-bold mb-1">Total Tunnels</h6>
                <h3 className="mb-0 display-6 fw-bold">{stats.total}</h3>
              </div>
              <div className="bg-light rounded-circle p-3">
                <FaRoute size={24} className="text-primary" />
              </div>
            </Card.Body>
          </Card>
        </div>
        <div className="col-md-4">
          <Card className="border-0 shadow-sm h-100">
            <Card.Body className="d-flex justify-content-between align-items-center">
              <div>
                <h6 className="text-muted text-uppercase small fw-bold mb-1">Connected</h6>
                <h3 className="mb-0 display-6 fw-bold text-success">{stats.connected}</h3>
              </div>
              <div className="bg-success bg-opacity-10 rounded-circle p-3">
                <FaRoute size={24} className="text-success" />
              </div>
            </Card.Body>
          </Card>
        </div>
        <div className="col-md-4">
          <Card className="border-0 shadow-sm h-100">
            <Card.Body className="d-flex justify-content-between align-items-center">
              <div>
                <h6 className="text-muted text-uppercase small fw-bold mb-1">Inactive</h6>
                <h3 className="mb-0 display-6 fw-bold text-secondary">{stats.disconnected}</h3>
              </div>
              <div className="bg-secondary bg-opacity-10 rounded-circle p-3">
                <FaRoute size={24} className="text-secondary" />
              </div>
            </Card.Body>
          </Card>
        </div>
      </div>

      {/* Tunnels Table */}
      <Card className="border-0 shadow-sm">
        <Card.Body className="p-0">
          <div className="table-responsive">
            <Table hover className="unified-table mb-0 align-middle" striped>
              <thead className="table-light">
                <tr>
                  <th style={{ width: '40px' }} className="text-center">
                    <Form.Check
                      type="checkbox"
                      checked={tunnels.length > 0 && selectedTunnels.size === tunnels.length}
                      onChange={handleToggleAll}
                      title="Select/Deselect All"
                    />
                  </th>
                  <th>ID</th>
                  <th>Device A</th>
                  <th>Interface A</th>
                  <th>Device B / Peer</th>
                  <th>Interface B</th>
                  <th>Path Label</th>
                  <th>Latency</th>
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
                        <td className="text-center">
                          <Form.Check
                            type="checkbox"
                            checked={selectedTunnels.has(tunnelId)}
                            onChange={() => handleToggleTunnel(tunnelId)}
                          />
                        </td>
                        <td>
                          <code className="text-primary bg-light px-2 py-1 rounded">#{tunnel.num || 'N/A'}</code>
                        </td>
                      <td>
                        <strong>{getDeviceName(tunnel.deviceA)}</strong>
                      </td>
                      <td>
                        <span className="text-muted small">
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
                        <span className="text-muted small">
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
                          <span className="text-success fw-bold">{tunnel.stats.latency.toFixed(2)} ms</span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {tunnel.stats?.dropRate !== undefined ? (
                          <span className={tunnel.stats.dropRate > 0 ? 'text-warning fw-bold' : 'text-success'}>
                            {tunnel.stats.dropRate.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
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
                          className="btn-icon"
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
        <div className="mt-3 text-muted small d-flex justify-content-between">
          <span>Showing {tunnels.length} tunnel{tunnels.length !== 1 ? 's' : ''}</span>
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};

export default Tunnels;
