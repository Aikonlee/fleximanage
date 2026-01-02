import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge, Modal, Form, Table, Button, Alert, Spinner, Row, Col } from 'react-bootstrap';
import { 
  FaArrowLeft, FaCaretDown, FaColumns, 
  FaPlay, FaStop, FaSyncAlt, FaMicrochip, FaEdit, FaCheck, FaSave, FaTrash, FaInfoCircle
} from 'react-icons/fa';
import api from '../services/api';
import './DeviceInfo.css';

const DeviceInfo = () => {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Tab State
  const [activeTab, setActiveTab] = useState('general'); 
  const [currentSubTab, setCurrentSubTab] = useState(''); 

  // Editable fields state
  const [deviceName, setDeviceName] = useState('');
  const [description, setDescription] = useState('');
  const [isApproved, setIsApproved] = useState(false);
  
  // Functional State
  const [interfaceChanges, setInterfaceChanges] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [editingInterface, setEditingInterface] = useState(null);
  
  // Hardware configuration state
  const [showHardwareModal, setShowHardwareModal] = useState(false);
  const [hwCpuCores, setHwCpuCores] = useState('');
  const [currentVRouterCores, setCurrentVRouterCores] = useState('');
  const [vRouterCores, setVRouterCores] = useState('');
  const [powerSaving, setPowerSaving] = useState(false);
  const [applyingConfig, setApplyingConfig] = useState(false);
  const [cpuOptimization, setCpuOptimization] = useState(null);

  // Static Routes state
  const [staticRoutes, setStaticRoutes] = useState([]);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [editingRoute, setEditingRoute] = useState(null);
  const [routeForm, setRouteForm] = useState({
    destination: '', gateway: '', ifname: '', metric: '', redistributeViaOSPF: false, redistributeViaBGP: false, onLink: false, conditions: []
  });

  // Dropdown visibility state
  const [activeDropdown, setActiveDropdown] = useState(null);

  // --- API Logic ---

  const apiCall = useCallback(async (url, options = {}) => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return null; }
    try {
      const response = await api({
        url: url,
        method: options.method || 'GET',
        headers: { 'Authorization': `Bearer ${token}`, ...options.headers },
        data: options.body ? JSON.parse(options.body) : undefined
      });
      return { ok: response.status >= 200 && response.status < 300, data: response.data, status: response.status };
    } catch (error) {
      if (error.response?.status === 401) { localStorage.removeItem('token'); navigate('/login'); return null; }
      throw error;
    }
  }, [navigate]);

  const fetchDeviceInfo = useCallback(async (forceRefresh = false) => {
    try {
      const url = `/devices/${deviceId}${forceRefresh ? '?refresh=' + Date.now() : ''}`;
      const response = await apiCall(url);
      if (!response || !response.ok) throw new Error('Failed to fetch device');
      const data = response.data;
      const deviceData = Array.isArray(data) ? data[0] : data;
      setDevice(deviceData);
      setDeviceName(deviceData?.name || '');
      setDescription(deviceData?.description || '');
      setIsApproved(Boolean(deviceData?.isApproved));
      
      setHwCpuCores(deviceData?.cpuInfo?.hwCores || '4');
      setCurrentVRouterCores(deviceData?.cpuInfo?.vppCores || '1');
      setVRouterCores(deviceData?.cpuInfo?.configuredVppCores || deviceData?.cpuInfo?.vppCores || '1');
      setPowerSaving(Boolean(deviceData?.cpuInfo?.powerSaving));

      setLoading(false);
    } catch (err) {
      console.error(err.message);
      setLoading(false);
    }
  }, [deviceId, apiCall]);

  const fetchCpuOptimization = useCallback(async () => {
    if (!deviceId) return;
    try {
      const response = await apiCall(`/devices/${deviceId}/cpu-optimization`);
      if (response && response.ok) setCpuOptimization(response.data);
    } catch (error) {
      console.error('Error fetching CPU optimization:', error);
    }
  }, [deviceId, apiCall]);

  const fetchStaticRoutes = useCallback(async () => {
    try {
      const response = await apiCall(`/devices/${deviceId}/staticroutes`);
      if (response && response.ok) {
        const transformedData = (response.data || []).map(route => ({
          ...route,
          _id: route._id || route.id
        }));
        setStaticRoutes(transformedData);
      }
    } catch (error) {
      console.error('Error fetching static routes:', error);
    }
  }, [deviceId, apiCall]);

  useEffect(() => { 
    fetchDeviceInfo(); 
    fetchStaticRoutes();
  }, [fetchDeviceInfo, fetchStaticRoutes]);

  useEffect(() => {
    if (showHardwareModal) fetchCpuOptimization();
  }, [showHardwareModal, fetchCpuOptimization]);

  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleUpdateDevice = async () => {
    try {
      setLoading(true);
      const updateData = { name: deviceName, description, isApproved };
      if (Object.keys(interfaceChanges).length > 0 && device?.interfaces) {
        updateData.interfaces = device.interfaces.map(iface => ({ ...iface, ...interfaceChanges[iface._id] }));
      }
      await apiCall(`/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updateData) });
      await fetchDeviceInfo(true);
      setInterfaceChanges({});
      alert('Device updated successfully');
    } catch (err) {
      alert('Update failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const performAction = async (action) => {
    try {
      setSyncing(true);
      const response = await apiCall(`/devices/${deviceId}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: action, entity: 'agent', message: `${action}-router` }) });
      if (response && response.ok) {
        alert(`${action.toUpperCase()} command sent successfully`);
        setTimeout(() => fetchDeviceInfo(true), 2000);
      }
    } catch (err) {
      alert(`Action ${action} failed: ` + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleApplyHardwareConfig = async () => {
    try {
      setApplyingConfig(true);
      const configData = { vRouterCores: parseInt(vRouterCores), powerSaving: powerSaving };
      const response = await apiCall(`/devices/${deviceId}/hardware`, { method: 'PUT', body: JSON.stringify(configData) });
      if (response && response.ok) {
        await fetchDeviceInfo(true);
        setShowHardwareModal(false);
        alert('Hardware configuration applied successfully');
      }
    } catch (error) {
      alert('Failed to apply hardware configuration: ' + error.message);
    } finally {
      setApplyingConfig(false);
    }
  };

  const handleSaveRoute = async () => {
    try {
      const payload = { staticRouteRequest: routeForm };
      if (editingRoute) await api.patch(`/devices/${deviceId}/staticroutes/${editingRoute._id}`, payload);
      else await api.post(`/devices/${deviceId}/staticroutes`, payload);
      setShowRouteModal(false);
      fetchStaticRoutes();
      alert('Route saved successfully');
    } catch (error) {
      alert('Failed to save route: ' + error.message);
    }
  };

  const handleDeleteRoute = async (routeId) => {
    if (!window.confirm('Delete this route?')) return;
    try {
      const response = await apiCall(`/devices/${deviceId}/staticroutes/${routeId}`, { method: 'DELETE' });
      if (response && response.ok) fetchStaticRoutes();
    } catch (error) {
      alert('Failed to delete route: ' + error.message);
    }
  };

  const handleInterfaceEdit = (iface, field, value) => {
    setInterfaceChanges(prev => ({ ...prev, [iface._id]: { ...prev[iface._id], [field]: value } }));
  };

  const handleTabClick = (e, tab) => {
    e.stopPropagation();
    if (['configuration', 'status', 'troubleshooting'].includes(tab)) {
      setActiveDropdown(activeDropdown === tab ? null : tab);
    } else {
      setActiveTab(tab);
      setCurrentSubTab('');
      setActiveDropdown(null);
    }
  };

  const handleSubTabClick = (e, parentTab, subTab) => {
    e.stopPropagation();
    setActiveTab(parentTab);
    setCurrentSubTab(subTab);
    setActiveDropdown(null);
  };

  if (loading && !device) {
    return <div className="loading-container"><Spinner animation="border" variant="primary" /></div>;
  }

  const isOnline = device?.isConnected;
  const isRunning = device?.state === 'running';

  return (
    <div className="device-info-page">
      <div className="bg-decoration"></div>

      {/* 1. Breadcrumb */}
      <div className="breadcrumb-nav">
        <span>Home</span> <span className="mx-1">»</span> <span>Inventory</span> <span className="mx-1">»</span> <span>Devices</span> <span className="mx-1">»</span> <span className="active">Device Info</span>
      </div>

      {/* 2. Header Area */}
      <div className="header-container">
        <div className="title-row">
          <button className="btn-back-circle" onClick={() => navigate('/devices')}><FaArrowLeft /></button>
          <h1 className="page-title">{device.machineId || 'Unknown Machine ID'} *</h1>
        </div>
        <div className="status-badges">
          <span className={`status-badge ${device.isApproved ? 'success' : ''}`}>{device.isApproved ? 'Approved' : 'Not Approved'}</span>
          <span className={`status-badge ${device.isConnected ? 'success' : ''}`}>{device.isConnected ? 'Connected' : 'Not Connected'}</span>
        </div>
      </div>

      <div className="action-buttons-bar">
        <button className="btn-template btn-orange" onClick={handleUpdateDevice}>Update Device</button>
        <button className="btn-template btn-green" onClick={() => performAction('start')} disabled={syncing || !isOnline || isRunning}><FaPlay className="small" /> Start Device</button>
        <button className="btn-template btn-gray" style={{backgroundColor: '#ef4444'}} onClick={() => performAction('stop')} disabled={syncing || !isOnline || !isRunning}><FaStop className="small" /> Stop Device</button>
        <button className="btn-template btn-gray" onClick={() => performAction('sync')} disabled={syncing || !isOnline}><FaSyncAlt className="small" /> Sync Device</button>
        <button className="btn-template btn-gray" onClick={() => setShowHardwareModal(true)}><FaMicrochip className="small" /> Hardware Configuration</button>
      </div>

      {/* 3. Tabs Navigation */}
      <div className="tabs-nav">
        <div className={`tab-item ${activeTab === 'general' ? 'active' : ''}`} onClick={(e) => handleTabClick(e, 'general')}>General</div>
        
        {/* Configuration */}
        <div className={`tab-item tab-dropdown ${activeTab === 'configuration' ? 'active' : ''}`} onClick={(e) => handleTabClick(e, 'configuration')}>
          Configuration <FaCaretDown className="tab-caret" />
          <div className={`tab-dropdown-menu ${activeDropdown === 'configuration' ? 'show' : ''}`}>
            <button className={`dropdown-item ${currentSubTab === 'interfaces' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'interfaces')}>Interfaces</button>
            <button className={`dropdown-item ${currentSubTab === 'firewall' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'firewall')}>Firewall & NAT</button>
            <button className={`dropdown-item ${currentSubTab === 'static-routes' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'static-routes')}>Static Routes</button>
            <button className={`dropdown-item ${currentSubTab === 'ospf' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'ospf')}>OSPF</button>
            <button className={`dropdown-item ${currentSubTab === 'bgp' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'bgp')}>BGP</button>
            <button className={`dropdown-item ${currentSubTab === 'routing-filters' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'routing-filters')}>Routing Filters</button>
            <button className={`dropdown-item ${currentSubTab === 'advanced-routing' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'advanced-routing')}>Advanced Routing</button>
          </div>
        </div>

        {/* Status */}
        <div className={`tab-item tab-dropdown ${activeTab === 'status' ? 'active' : ''}`} onClick={(e) => handleTabClick(e, 'status')}>
          Status <FaCaretDown className="tab-caret" />
          <div className={`tab-dropdown-menu ${activeDropdown === 'status' ? 'show' : ''}`}>
            {['apps', 'bgp-neighbors', 'dhcp', 'policies', 'routing-table', 'statistics', 'vrrp'].map(sub => (
              <button key={sub} className={`dropdown-item ${currentSubTab === sub ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'status', sub)}>{sub.replace('-', ' ').toUpperCase()}</button>
            ))}
          </div>
        </div>

        {/* Troubleshooting */}
        <div className={`tab-item tab-dropdown ${activeTab === 'troubleshooting' ? 'active' : ''}`} onClick={(e) => handleTabClick(e, 'troubleshooting')}>
          Troubleshooting <FaCaretDown className="tab-caret" />
          <div className={`tab-dropdown-menu ${activeDropdown === 'troubleshooting' ? 'show' : ''}`}>
            {['command', 'edge-setting', 'logs', 'packet-traces', 'recovery-info'].map(sub => (
              <button key={sub} className={`dropdown-item ${currentSubTab === sub ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'troubleshooting', sub)}>{sub.replace('-', ' ').toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Content Area */}
      <div className="content-area-template">
        {activeTab === 'general' && (
          <div>
            <div className="grid-row"><label className="grid-label">Device Name</label><div className="grid-content"><input type="text" className="input-template input-valid" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} /><FaCheck className="valid-icon" /></div></div>
            <div className="grid-row"><label className="grid-label">Description</label><div className="grid-content"><input type="text" className="input-template input-valid" value={description} onChange={(e) => setDescription(e.target.value)} /><FaCheck className="valid-icon" /></div></div>
            <div className="grid-row">
              <label className="grid-label">Approved</label>
              <div className="grid-content">
                <div className="toggle-wrapper">
                  <input 
                    type="checkbox" 
                    id="approved-toggle" 
                    className="toggle-checkbox"
                    checked={isApproved} 
                    onChange={(e) => setIsApproved(e.target.checked)} 
                  />
                  <label 
                    htmlFor="approved-toggle" 
                    className={`toggle-label ${isApproved ? 'checked' : ''}`}
                  ></label>
                </div>
              </div>
            </div>
            <div className="grid-row"><label className="grid-label">Host Name</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.hostname || ''} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">S/N</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.serial || 'N/A'} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">Machine ID</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.machineId || ''} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">Device Version</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.versions?.agent || device.versions?.device || ''} readOnly /></div></div>
            <div className="grid-row" style={{marginTop: '2rem'}}><div className="col-span-12" style={{gridColumn: 'span 12'}}><div className="map-container-template"><span className="text-muted small">Map Placeholder (Leaflet Integration Required)</span></div></div></div>
          </div>
        )}

        {activeTab === 'configuration' && currentSubTab === 'interfaces' && (
          <div className="table-container-template">
            <table className="custom-table-template">
              <thead><tr><th className="text-center" style={{width: '40px'}}><FaColumns /></th><th>Name</th><th>Type</th><th>Assigned</th><th>IPv4</th><th>GW</th><th>DNS</th><th>Actions</th></tr></thead>
              <tbody>
                {device.interfaces?.map((iface, idx) => {
                  const isIfaceAssigned = (interfaceChanges[iface._id]?.isAssigned !== undefined) ? interfaceChanges[iface._id].isAssigned : iface.isAssigned;
                  return (
                    <tr key={iface._id || idx}><td className="text-center"><input type="checkbox" className="form-check-input" /></td><td className="fw-bold text-primary">{iface.name}</td><td><Badge bg={iface.type === 'WAN' ? 'primary' : 'secondary'}>{iface.type}</Badge></td><td><Badge bg={isIfaceAssigned ? 'success' : 'secondary'} style={{cursor: 'pointer'}} onClick={() => handleInterfaceEdit(iface, 'isAssigned', !isIfaceAssigned)}>{isIfaceAssigned ? 'Yes' : 'No'}</Badge></td><td>{isIfaceAssigned ? (iface.IPv4 || '-') : '-'}</td><td>{isIfaceAssigned ? (iface.gateway || '-') : '-'}</td><td>{iface.dnsServers?.join(', ') || '-'}</td><td><button className="btn-icon-action" onClick={() => setEditingInterface(iface)}><FaEdit size={12} /></button></td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'configuration' && currentSubTab === 'static-routes' && (
          <div className="p-4 bg-white border border-gray-300 rounded shadow-sm">
            <div className="d-flex justify-content-between align-items-center mb-3"><h5 className="mb-0 fw-bold">Static Routing Table</h5><Button variant="primary" size="sm" onClick={() => { setEditingRoute(null); setRouteForm({ destination: '', gateway: '', ifname: '', metric: '', redistributeViaOSPF: false, redistributeViaBGP: false, onLink: false, conditions: [] }); setShowRouteModal(true); }}>Add Route</Button></div>
            <Table hover responsive className="custom-table-template">
              <thead><tr><th>Route</th><th>Redistribution</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {staticRoutes.map((route, i) => (
                  <tr key={route._id || i}><td><strong>Dest:</strong> <code>{route.destination}</code><br/><strong>GW:</strong> <code>{route.gateway}</code></td><td>{route.redistributeViaOSPF && <Badge bg="info" className="me-1">OSPF</Badge>} {route.redistributeViaBGP && <Badge bg="info">BGP</Badge>}</td><td><Badge bg={route.status === 'complete' ? 'success' : 'warning'}>{route.status || 'pending'}</Badge></td><td><Button variant="outline-primary" size="sm" className="me-1" onClick={() => { setEditingRoute(route); setRouteForm(route); setShowRouteModal(true); }}><FaEdit/></Button><Button variant="outline-danger" size="sm" onClick={() => handleDeleteRoute(route._id)}><FaTrash/></Button></td></tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {(activeTab === 'status' || activeTab === 'troubleshooting' || (activeTab === 'configuration' && !['interfaces', 'static-routes'].includes(currentSubTab))) && (
          <div className="p-5 bg-white border border-gray-300 rounded shadow-sm text-center text-muted">
            <p className="mb-0">Content for <strong>{currentSubTab || activeTab}</strong></p>
          </div>
        )}
      </div>

      {/* Modals */}
      <Modal show={showHardwareModal} onHide={() => setShowHardwareModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title><FaMicrochip className="me-2" /> Hardware Configuration</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>HW CPU cores:</Form.Label><Form.Control type="text" value={hwCpuCores} readOnly className="input-readonly" /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>Current vRouter cores:</Form.Label><Form.Control type="text" value={currentVRouterCores} readOnly className="input-readonly" /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>vRouter cores:</Form.Label><Form.Control type="number" value={vRouterCores} onChange={(e) => setVRouterCores(e.target.value)} min="1" max={hwCpuCores} /></Form.Group>
            {cpuOptimization && <Alert variant={cpuOptimization.optimization?.status === 'optimal' ? 'success' : 'warning'}><h6 className="fw-bold"><FaInfoCircle className="me-2"/> CPU Analysis</h6><p className="small mb-0">{cpuOptimization.optimization?.message}</p></Alert>}
            <Form.Check type="switch" label="Power Saving" checked={powerSaving} onChange={(e) => setPowerSaving(e.target.checked)} />
          </Form>
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowHardwareModal(false)}>Cancel</Button><Button variant="primary" onClick={handleApplyHardwareConfig} disabled={applyingConfig}>{applyingConfig ? 'Applying...' : 'Apply Configuration'}</Button></Modal.Footer>
      </Modal>

      {editingInterface && (
        <Modal show={true} onHide={() => setEditingInterface(null)} centered size="lg">
          <Modal.Header closeButton><Modal.Title>Edit {editingInterface.name}</Modal.Title></Modal.Header>
          <Modal.Body>
            <Form>
              <Form.Group className="mb-3"><Form.Label>Routing Protocol</Form.Label><Form.Select value={interfaceChanges[editingInterface._id]?.routing || editingInterface.routing || 'NONE'} onChange={(e) => handleInterfaceEdit(editingInterface, 'routing', e.target.value)}><option value="NONE">None</option><option value="OSPF">OSPF</option><option value="BGP">BGP</option></Form.Select></Form.Group>
              <Form.Group className="mb-3"><Form.Label>Bandwidth (Upload)</Form.Label><Form.Control type="number" value={interfaceChanges[editingInterface._id]?.bandwidthMbps?.tx || editingInterface.bandwidthMbps?.tx || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'bandwidthMbps', { ...editingInterface.bandwidthMbps, tx: e.target.value })} /></Form.Group>
            </Form>
          </Modal.Body>
          <Modal.Footer><Button variant="secondary" onClick={() => setEditingInterface(null)}>Cancel</Button><Button variant="primary" onClick={() => setEditingInterface(null)}>Save Locally</Button></Modal.Footer>
        </Modal>
      )}

      <Modal show={showRouteModal} onHide={() => setShowRouteModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingRoute ? 'Edit Route' : 'Add Route'}</Modal.Title></Modal.Header>
        <Modal.Body><Form><Row><Col md={6}><Form.Group className="mb-3"><Form.Label>Destination Network</Form.Label><Form.Control value={routeForm.destination} onChange={e => setRouteForm({...routeForm, destination: e.target.value})} placeholder="192.168.10.0/24" /></Form.Group></Col><Col md={6}><Form.Group className="mb-3"><Form.Label>Gateway</Form.Label><Form.Control value={routeForm.gateway} onChange={e => setRouteForm({...routeForm, gateway: e.target.value})} placeholder="192.168.1.1" /></Form.Group></Col></Row><Form.Check label="Redistribute OSPF" checked={routeForm.redistributeViaOSPF} onChange={e => setRouteForm({...routeForm, redistributeViaOSPF: e.target.checked})} /><Form.Check label="Redistribute BGP" checked={routeForm.redistributeViaBGP} onChange={e => setRouteForm({...routeForm, redistributeViaBGP: e.target.checked})} /></Form></Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowRouteModal(false)}>Cancel</Button><Button variant="primary" onClick={handleSaveRoute}><FaSave className="me-2"/>Save Route</Button></Modal.Footer>
      </Modal>
    </div>
  );
};

export default DeviceInfo;