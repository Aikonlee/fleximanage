import React, { useState, useEffect } from 'react';
import { Button, Badge, Card, Row, Col, Alert, Form, ButtonGroup, Modal } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { FaPlay, FaStop, FaSync, FaTrash, FaServer } from 'react-icons/fa';
import api from '../services/api';
import './Devices.css';

const Devices = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const [showTunnelModal, setShowTunnelModal] = useState(false);
  const [tunnelTopology, setTunnelTopology] = useState('full-mesh');
  const [creatingTunnels, setCreatingTunnels] = useState(false);
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
        isConnected: device.isConnected,
        isApproved: device.isApproved,
        pps: device.stats?.pps || 'N/A',
        bps: device.stats?.bps || 'N/A',
        vRouter: device.state || '',
        syncState: device.sync?.state || 'unknown',
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

  const getVRouterBadge = (vRouterStatus, isConnected) => {
    // Don't show status if device is not connected
    if (!isConnected) {
      return <Badge bg="secondary">Offline</Badge>;
    }

    let statusText, variant;
    
    switch(vRouterStatus) {
      case 'running':
        statusText = 'Running';
        variant = 'success';
        break;
      case 'stopped':
        statusText = 'Stopped';
        variant = 'secondary';
        break;
      case 'failed':
        statusText = 'Failed';
        variant = 'danger';
        break;
      case 'pending':
        statusText = 'Pending';
        variant = 'warning';
        break;
      case 'starting':
        statusText = 'Starting...';
        variant = 'warning';
        break;
      case 'stopping':
        statusText = 'Stopping...';
        variant = 'warning';
        break;
      case '':
      default:
        statusText = 'Not Running';
        variant = 'secondary';
        break;
    }
    
    return <Badge bg={variant}>{statusText}</Badge>;
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

  const handleCreateTunnels = () => {
    if (selectedDevices.size < 2) {
      alert('Please select at least 2 devices to create tunnels');
      return;
    }
    setShowTunnelModal(true);
  };

  const handleTunnelModalClose = () => {
    setShowTunnelModal(false);
    setTunnelTopology('full-mesh');
  };

  const handleCreateTunnelsSubmit = async () => {
    try {
      setCreatingTunnels(true);
      const deviceIds = Array.from(selectedDevices);
      
      // Build devices object for official API
      const devicesObj = {};
      deviceIds.forEach(id => {
        devicesObj[id] = true;
      });
      
      // Map topology to official format
      const topology = tunnelTopology === 'hub-spoke' ? 'hubAndSpoke' : 'fullMesh';
      
      // Use official /devices/apply endpoint with method='tunnels'
      const response = await apiCall('/api/devices/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'tunnels',
          devices: devicesObj,
          meta: {
            tunnelType: 'site-to-site',
            pathLabels: [],
            topology: topology,
            hub: null,
            advancedOptions: {
              routing: 'ospf'
            }
          }
        })
      });

      if (response && response.ok) {
        await response.json().catch(() => ({}));
        alert(`Tunnels are being created in ${tunnelTopology} topology! Please check the Tunnels page in a moment.`);
        setShowTunnelModal(false);
        setSelectedDevices(new Set());
        setTimeout(() => fetchDevices(), 2000);
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `Failed to create tunnels: ${response?.status}`);
      }
    } catch (error) {
      console.error('Error creating tunnels:', error);
      alert(`Error creating tunnels: ${error.message}`);
    } finally {
      setCreatingTunnels(false);
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
                    <Button variant="primary" size="sm" onClick={handleCreateTunnels} disabled={selectedDevices.size < 2}>
                      <FaSync className="me-1" />Create Tunnels
                    </Button>
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
                      {getVRouterBadge(device.vRouter, device.isConnected)}
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
                          disabled={
                            !device.isConnected ||
                            !device.isApproved ||
                            device.vRouter === 'running' ||
                            device.vRouter === 'starting' ||
                            device.vRouter === 'pending'
                          }
                          title={
                            !device.isConnected ? 'Device must be connected' :
                            !device.isApproved ? 'Device must be approved' :
                            device.vRouter === 'running' ? 'Device is already running' :
                            'Start vRouter'
                          }
                        >
                          <FaPlay />
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleStopDevice(device.id)}
                          disabled={
                            !device.isConnected ||
                            !device.isApproved ||
                            device.vRouter === 'stopped' ||
                            device.vRouter === '' ||
                            device.vRouter === 'stopping' ||
                            device.vRouter === 'pending'
                          }
                          title={
                            !device.isConnected ? 'Device must be connected' :
                            !device.isApproved ? 'Device must be approved' :
                            (device.vRouter === 'stopped' || device.vRouter === '') ? 'Device is not running' :
                            'Stop vRouter'
                          }
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

      {/* Tunnel Creation Modal */}
      <Modal show={showTunnelModal} onHide={handleTunnelModalClose}>
        <Modal.Header closeButton>
          <Modal.Title>Create Tunnels</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            You have selected <strong>{selectedDevices.size}</strong> devices to create tunnels.
          </p>
          <Form.Group className="mb-3">
            <Form.Label>Tunnel Topology</Form.Label>
            <Form.Select 
              value={tunnelTopology} 
              onChange={(e) => setTunnelTopology(e.target.value)}
            >
              <option value="full-mesh">Full Mesh</option>
              <option value="hub-spoke">Hub and Spoke</option>
            </Form.Select>
            <Form.Text className="text-muted">
              {tunnelTopology === 'full-mesh' 
                ? `Full Mesh will create ${(selectedDevices.size * (selectedDevices.size - 1)) / 2} bidirectional tunnels connecting all devices.`
                : 'Hub and Spoke will create tunnels from a central hub to all spoke devices.'
              }
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleTunnelModalClose} disabled={creatingTunnels}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreateTunnelsSubmit} disabled={creatingTunnels}>
            {creatingTunnels ? 'Creating...' : 'Create Tunnels'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default Devices;