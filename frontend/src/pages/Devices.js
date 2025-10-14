import React, { useState, useEffect } from 'react';
import { Button, Badge, Card, Row, Col, Alert, Form, ButtonGroup } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { FaPlay, FaStop, FaSync, FaTrash, FaServer } from 'react-icons/fa';
import api from '../services/api';
import './Devices.css';

const Devices = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    fetchDevices();
  }, []);

  const apiCall = async (url, options = {}) => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return null;
    }

    try {
      const cleanUrl = url.replace(/^\/api/, '');
      const response = await api({
        url: cleanUrl,
        method: options.method || 'GET',
        data: options.body ? JSON.parse(options.body) : undefined,
        headers: {
          'Authorization': `Bearer ${token}`,
          ...options.headers
        }
      });

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        json: async () => response.data,
        text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
      };
    } catch (error) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/login');
        return null;
      }
      throw error;
    }
  };

  const fetchDevices = async () => {
    try {
      const response = await api.get('/devices?response=detailed');
      const data = response.data;
      console.log('Fetched devices:', data);
      
      const transformedDevices = data.map(device => ({
        id: device._id || device.id,
        name: device.name || 'Unknown Device',
        type: device.type || 'Router',
        hostname: device.hostname || 'N/A',
        wanIPs: device.interfaces?.filter(iface => iface.type === 'WAN')
          .map(iface => iface.IPv4 || iface.PublicIP)
          .filter(ip => ip)
          .join(', ') || 'N/A',
        status: device.isApproved ? 'Approved' : 'Pending',
        connection: device.isConnected ? 'Connected' : 'Not Connected',
        pps: device.stats?.pps || 'N/A',
        bps: device.stats?.bps || 'N/A',
        vRouter: device.state || device.sync?.state || device.deviceState || 'Unknown',
        location: device.location || '',
        lastSeen: device.lastSeen || '',
        serial: device.serial || 'N/A',
        description: device.description || '',
        machineId: device.machineId || 'N/A'
      }));

      setDevices(transformedDevices);
      setError(null);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching devices:', error);
      setError(error.message || 'Failed to fetch devices');
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      'Approved': 'success',
      'Pending': 'warning',
      'Rejected': 'danger'
    };
    return <Badge bg={variants[status] || 'secondary'}>{status}</Badge>;
  };

  const getConnectionBadge = (connection) => {
    const variants = {
      'Connected': 'success',
      'Not Connected': 'danger',
      'Connecting': 'warning'
    };
    return <Badge bg={variants[connection] || 'secondary'}>{connection}</Badge>;
  };

  const getVRouterBadge = (vRouterStatus) => {
    let status;
    if (typeof vRouterStatus === 'object' && vRouterStatus !== null) {
      status = vRouterStatus.state;
    } else {
      status = vRouterStatus;
    }

    const statusText = status === 'running' ? 'Running' : 
                    status === 'stopped' ? 'Not Running' :
                    status === 'synced' ? 'Synced' :
                    status === 'syncing' ? 'Syncing...' :
                    status === 'starting' ? 'Starting...' :
                    status === 'stopping' ? 'Stopping...' :
                    status || 'Unknown';
    
    const variants = {
      'running': 'success',
      'Running': 'success',
      'stopped': 'danger', 
      'Not Running': 'danger',
      'synced': 'info',
      'Synced': 'info',
      'syncing': 'warning',
      'Syncing...': 'warning',
      'starting': 'warning',
      'Starting...': 'warning',
      'stopping': 'warning',
      'Stopping...': 'warning',
      'pending': 'warning',
      'Pending': 'warning'
    };
    
    return <Badge bg={variants[status] || variants[statusText] || 'secondary'}>{statusText}</Badge>;
  };

  const handleDeviceSelect = (deviceId, isSelected) => {
    const newSelection = new Set(selectedDevices);
    if (isSelected) {
      newSelection.add(deviceId);
    } else {
      newSelection.delete(deviceId);
    }
    setSelectedDevices(newSelection);
  };

  const handleSelectAll = (isSelected) => {
    if (isSelected) {
      setSelectedDevices(new Set(devices.map(device => device.id)));
    } else {
      setSelectedDevices(new Set());
    }
  };

  const handleStartDevice = async (deviceId) => {
    try {
      const device = devices.find(d => d.id === deviceId);
      setDevices(prevDevices => 
        prevDevices.map(d => 
          d.id === deviceId 
            ? { ...d, vRouter: 'starting' }
            : d
        )
      );
      
      const response = await apiCall(`/api/devices/${deviceId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'start',
          entity: 'agent',
          message: 'start-router'
        })
      });
      
      if (response && response.ok) {
        setTimeout(() => fetchDevices(), 2000);
      } else {
        throw new Error(`Start device failed: ${response?.status}`);
      }
    } catch (error) {
      console.error('Error starting device:', error);
      const originalDevice = devices.find(d => d.id === deviceId);
      if (originalDevice) {
        setDevices(prevDevices => 
          prevDevices.map(d => 
            d.id === deviceId 
              ? { ...d, vRouter: originalDevice.vRouter }
              : d
          )
        );
      }
    }
  };

  const handleStopDevice = async (deviceId) => {
    try {
      const device = devices.find(d => d.id === deviceId);
      setDevices(prevDevices => 
        prevDevices.map(d => 
          d.id === deviceId 
            ? { ...d, vRouter: 'stopping' }
            : d
        )
      );
      
      const response = await apiCall(`/api/devices/${deviceId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'stop',
          entity: 'agent',
          message: 'stop-router'
        })
      });
      
      if (response && response.ok) {
        setTimeout(() => fetchDevices(), 2000);
      } else {
        throw new Error(`Stop device failed: ${response?.status}`);
      }
    } catch (error) {
      console.error('Error stopping device:', error);
      const originalDevice = devices.find(d => d.id === deviceId);
      if (originalDevice) {
        setDevices(prevDevices => 
          prevDevices.map(d => 
            d.id === deviceId 
              ? { ...d, vRouter: originalDevice.vRouter }
              : d
          )
        );
      }
    }
  };

  const handleSyncDevice = async (deviceId) => {
    try {
      setDevices(prevDevices => 
        prevDevices.map(d => 
          d.id === deviceId 
            ? { ...d, vRouter: 'syncing' }
            : d
        )
      );
      
      const response = await apiCall(`/api/devices/${deviceId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ method: 'sync' })
      });
      
      if (response && response.ok) {
        setTimeout(() => fetchDevices(), 2000);
      } else {
        throw new Error(`Sync device failed: ${response?.status}`);
      }
    } catch (error) {
      console.error('Error syncing device:', error);
      const originalDevice = devices.find(d => d.id === deviceId);
      if (originalDevice) {
        setDevices(prevDevices => 
          prevDevices.map(d => 
            d.id === deviceId 
              ? { ...d, vRouter: originalDevice.vRouter }
              : d
          )
        );
      }
    }
  };

  const handleDeleteDevice = async (deviceId) => {
    if (window.confirm('Are you sure you want to delete this device?')) {
      try {
        const response = await apiCall(`/api/devices/${deviceId}`, {
          method: 'DELETE'
        });
        
        if (response && response.ok) {
          fetchDevices();
        }
      } catch (error) {
        console.error('Error deleting device:', error);
      }
    }
  };

  return (
    <div className="devices-page">
      <div className="page-header">
        <div>
          <h2>Devices</h2>
          <p className="text-muted">Manage your network devices</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center">
          <p>Loading devices...</p>
        </div>
      ) : error ? (
        <Alert variant="danger">
          <Alert.Heading>Error Loading Devices</Alert.Heading>
          <p>{error}</p>
          <Button variant="outline-danger" onClick={fetchDevices}>
            Try Again
          </Button>
        </Alert>
      ) : devices.length === 0 ? (
        <Card className="text-center p-5">
          <Card.Body>
            <FaServer size={48} className="mb-3 text-muted" />
            <h4>No devices yet</h4>
            <p className="text-muted">No devices have been registered to your account.</p>
            <Button variant="primary" onClick={fetchDevices}>
              <FaSync className="me-1" />Refresh
            </Button>
          </Card.Body>
        </Card>
      ) : (
        <div>
          {selectedDevices.size > 0 && (
            <div className="bulk-actions-bar mb-3 p-3 bg-light border rounded">
              <Row className="align-items-center">
                <Col md={6}>
                  <span className="fw-bold">
                    {selectedDevices.size} device{selectedDevices.size !== 1 ? 's' : ''} selected
                  </span>
                </Col>
                <Col md={6} className="text-end">
                  <ButtonGroup>
                    <Button variant="success" size="sm" onClick={() => Array.from(selectedDevices).forEach(handleStartDevice)}>
                      <FaPlay className="me-1" />Start
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => Array.from(selectedDevices).forEach(handleStopDevice)}>
                      <FaStop className="me-1" />Stop
                    </Button>
                    <Button variant="info" size="sm" onClick={() => Array.from(selectedDevices).forEach(handleSyncDevice)}>
                      <FaSync className="me-1" />Sync
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => Array.from(selectedDevices).forEach(handleDeleteDevice)}>
                      <FaTrash className="me-1" />Delete
                    </Button>
                  </ButtonGroup>
                </Col>
              </Row>
            </div>
          )}

          <Card>
            <Card.Header>
              <Row className="align-items-center">
                <Col md={6}>
                  <Form.Check
                    type="checkbox"
                    id="select-all"
                    label="Select All Devices"
                    checked={devices.length > 0 && selectedDevices.size === devices.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </Col>
                <Col md={6} className="text-end">
                  <small className="text-muted">{devices.length} device{devices.length !== 1 ? 's' : ''} total</small>
                </Col>
              </Row>
            </Card.Header>
            <Card.Body>
              {devices.map((device) => (
                <div key={device.id} className="device-item mb-3 p-3 border rounded">
                  <Row className="align-items-center">
                    <Col xs={1}>
                      <Form.Check
                        type="checkbox"
                        id={`device-${device.id}`}
                        checked={selectedDevices.has(device.id)}
                        onChange={(e) => handleDeviceSelect(device.id, e.target.checked)}
                      />
                    </Col>
                    <Col xs={3}>
                      <Link to={`/devices/${device.id}`} className="device-name">
                        {device.name}
                      </Link>
                      <div className="small text-muted">
                        ID: {device.machineId}
                      </div>
                    </Col>
                    <Col xs={2}>
                      {getStatusBadge(device.status)}
                      <div className="mt-1">
                        {getConnectionBadge(device.connection)}
                      </div>
                    </Col>
                    <Col xs={2}>
                      {getVRouterBadge(device.vRouter)}
                    </Col>
                    <Col xs={2}>
                      <div className="small">
                        WAN IP: {device.wanIPs}
                      </div>
                      <div className="small text-muted">
                        Hostname: {device.hostname}
                      </div>
                    </Col>
                    <Col xs={2}>
                      <ButtonGroup size="sm">
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => handleStartDevice(device.id)}
                          disabled={device.vRouter === 'running' || device.vRouter === 'starting'}
                        >
                          <FaPlay />
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleStopDevice(device.id)}
                          disabled={device.vRouter === 'stopped' || device.vRouter === 'stopping'}
                        >
                          <FaStop />
                        </Button>
                        <Button
                          variant="info"
                          size="sm"
                          onClick={() => handleSyncDevice(device.id)}
                          disabled={device.vRouter === 'syncing'}
                        >
                          <FaSync />
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteDevice(device.id)}
                        >
                          <FaTrash />
                        </Button>
                      </ButtonGroup>
                    </Col>
                  </Row>
                </div>
              ))}
            </Card.Body>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Devices;