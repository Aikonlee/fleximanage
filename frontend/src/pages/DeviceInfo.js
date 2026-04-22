import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge, Modal, Form, Table, Button, Alert, Spinner, Row, Col } from 'react-bootstrap';
import { 
  FaArrowLeft, FaCaretDown, FaColumns, 
  FaPlay, FaStop, FaSyncAlt, FaMicrochip, FaEdit, FaCheck, FaSave, FaTrash, FaInfoCircle, FaCog
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
  
  // OSPF State
  const [ospfConfig, setOspfConfig] = useState({
    routerId: '',
    redistributeDefault: false,
    redistributeConnected: false,
    redistributeStatic: false,
    redistributeBgp: false
  });

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

  // DHCP State
  const [dhcpServers, setDhcpServers] = useState([]);
  const [showDhcpModal, setShowDhcpModal] = useState(false);
  const [editingDhcp, setEditingDhcp] = useState(null);
  const [dhcpForm, setDhcpForm] = useState({
    interface: '', rangeStart: '', rangeEnd: '', dns: '', defaultLeaseTime: '', maxLeaseTime: ''
  });

  // Dropdown visibility state
  const [activeDropdown, setActiveDropdown] = useState(null);

  // Map State
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (activeTab === 'general' && mapContainerRef.current && !mapInstanceRef.current && device) {
      const L = window.L;
      if (L) {
        const lat = device.location?.lat || 51.505;
        const lon = device.location?.lon || -0.09;
        const zoom = device.location?.lat ? 13 : 13; // Default zoom

        const map = L.map(mapContainerRef.current).setView([lat, lon], zoom);

        // Create tile layer with proper configuration
        const tileLayer = L.tileLayer('/api/public/tiles/{z}/{x}/{y}', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
          crossOrigin: 'anonymous'
        });

        tileLayer.addTo(map);

        L.marker([lat, lon]).addTo(map)
            .bindPopup(device.name || 'Device')
            .openPopup();

        mapInstanceRef.current = map;
      }
    } else if (activeTab !== 'general' && mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
    }
  }, [activeTab, device]);

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

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
      
      // Initialize OSPF config
      if (deviceData.ospf) {
        setOspfConfig({
          routerId: deviceData.ospf.routerId || '',
          redistributeDefault: Boolean(deviceData.ospf.redistributeDefault),
          redistributeConnected: Boolean(deviceData.ospf.redistributeConnected),
          redistributeStatic: Boolean(deviceData.ospf.redistributeStatic),
          redistributeBgp: Boolean(deviceData.ospf.redistributeBgp),
          helloInterval: deviceData.ospf.helloInterval || '10',
          deadInterval: deviceData.ospf.deadInterval || '40'
        });
      }
      
      setHwCpuCores(deviceData?.cpuInfo?.hwCores || '4');
      setCurrentVRouterCores(deviceData?.cpuInfo?.vppCores || '1');
      setVRouterCores(deviceData?.cpuInfo?.configuredVppCores || deviceData?.cpuInfo?.vppCores || '1');
      setPowerSaving(Boolean(deviceData?.cpuInfo?.powerSaving));
      
      setDhcpServers(deviceData.dhcp || []);

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
        updateData.interfaces = device.interfaces.map(iface => {
          // Clone changes to avoid mutating state
          const changes = { ...(interfaceChanges[iface._id] || {}) };
          
          // Handle CIDR parsing for IPv4 input
          if (changes.IPv4 && changes.IPv4.includes('/')) {
            const [ip, mask] = changes.IPv4.split('/');
            changes.IPv4 = ip.trim();
            // Only update mask if provided and not empty
            if (mask && mask.trim()) {
              changes.IPv4Mask = mask.trim();
            }
          } else if (changes.IPv4) {
             changes.IPv4 = changes.IPv4.trim();
          }

          const mergedInterface = { ...iface, ...changes };
          if (changes.ospf && iface.ospf) {
             mergedInterface.ospf = { ...iface.ospf, ...changes.ospf };
          } else if (changes.ospf) {
             mergedInterface.ospf = changes.ospf;
          }
          return mergedInterface;
        });
      }
      await apiCall(`/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updateData) });
      await fetchDeviceInfo(true);
      setInterfaceChanges({});
      alert('Device updated successfully');
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || 'Unknown error';
      alert('Update failed: ' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOSPF = async () => {
    try {
      setLoading(true);
      const updateData = { ospf: ospfConfig };
      await apiCall(`/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updateData) });
      await fetchDeviceInfo(true);
      alert('OSPF configuration saved successfully');
    } catch (err) {
      alert('Failed to save OSPF configuration: ' + err.message);
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

  const handleSaveDHCP = async () => {
    try {
      // dns should be an array of strings
      const dnsArray = dhcpForm.dns.split(',').map(s => s.trim()).filter(s => s);
      const payload = {
        ...dhcpForm,
        dns: dnsArray
      };
      
      await apiCall(`/devices/${deviceId}/dhcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      setShowDhcpModal(false);
      await fetchDeviceInfo(true);
      alert('DHCP server saved successfully');
    } catch (error) {
      alert('Failed to save DHCP server: ' + error.message);
    }
  };

  const handleDeleteDHCP = async (ifaceName) => {
    if (!window.confirm('Delete DHCP server for ' + ifaceName + '?')) return;
    try {
      // Filter out the deleted DHCP config from the current list
      const newDhcpList = dhcpServers.filter(d => d.interface !== ifaceName);
      // Update device with the new list
      await apiCall(`/devices/${deviceId}`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ dhcp: newDhcpList }) 
      });
      await fetchDeviceInfo(true);
    } catch (error) {
      alert('Failed to delete DHCP server: ' + error.message);
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

  // Helper to get interfaces enabled for OSPF
  const getOspfInterfaces = () => {
    if (!device || !device.interfaces) return [];
    return device.interfaces.filter(iface => iface.routing === 'OSPF' || (iface.type === 'LAN' && iface.isAssigned));
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
            <button className={`dropdown-item ${currentSubTab === 'dhcp' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'dhcp')}>DHCP Server</button>
            <button className={`dropdown-item ${currentSubTab === 'ospf' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'ospf')}>OSPF</button>
            <button className={`dropdown-item ${currentSubTab === 'bgp' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'bgp')}>BGP</button>
            <button className={`dropdown-item ${currentSubTab === 'routing-filters' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'routing-filters')}>Routing Filters</button>
            <button className={`dropdown-item ${currentSubTab === 'advanced-routing' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'advanced-routing')}>Advanced Routing</button>
          </div>
        </div>

        {/* Status Dropdown */}
        <div className={`tab-item tab-dropdown ${activeTab === 'status' ? 'active' : ''}`} onClick={(e) => handleTabClick(e, 'status')}>
          Status <FaCaretDown className="tab-caret" />
          <div className={`tab-dropdown-menu ${activeDropdown === 'status' ? 'show' : ''}`}>
            {['apps', 'bgp-neighbors', 'policies', 'routing-table', 'statistics', 'vrrp'].map(sub => (
              <button key={sub} className={`dropdown-item ${currentSubTab === sub ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'status', sub)}>{sub.replace('-', ' ').toUpperCase()}</button>
            ))}
          </div>
        </div>

        {/* Troubleshooting Dropdown */}
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
                    onClick={() => setIsApproved(!isApproved)}
                  ></label>
                </div>
              </div>
            </div>
            <div className="grid-row"><label className="grid-label">Host Name</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.hostname || ''} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">S/N</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.serial || 'N/A'} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">Machine ID</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.machineId || ''} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">Device Version</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.versions?.agent || device.versions?.device || ''} readOnly /></div></div>
            <div className="grid-row" style={{marginTop: '2rem'}}><div className="col-span-12" style={{gridColumn: 'span 12'}}><div id="device-map" ref={mapContainerRef} className="map-container-template"></div></div></div>
          </div>
        )}

        {activeTab === 'configuration' && currentSubTab === 'interfaces' && (
          <div className="table-container-template">
            <table className="custom-table-template">
              <thead>
                <tr>
                  <th className="text-center" style={{width: '40px'}}><FaColumns /></th>
                  <th>Name <span className="sort-icon">▲</span></th>
                  <th>Type <span className="sort-icon">▼</span></th>
                  <th>Assigned <span className="sort-icon">▼</span></th>
                  <th>IPv4 <span className="sort-icon">▼</span></th>
                  <th>GW <span className="sort-icon">▼</span></th>
                  <th>Metric <span className="sort-icon">▼</span></th>
                  <th>Public IP <span className="sort-icon">▼</span></th>
                  <th>Path Labels <span className="sort-icon">▼</span></th>
                  <th>Routing <span className="sort-icon">▼</span></th>
                </tr>
              </thead>
              <tbody>
                {device.interfaces?.map((iface, idx) => {
                  const isIfaceAssigned = (interfaceChanges[iface._id]?.isAssigned !== undefined) ? interfaceChanges[iface._id].isAssigned : iface.isAssigned;
                  const isUp = iface.linkStatus === 'up' || (iface.IPv4 && iface.IPv4.length > 0); // Simple heuristic for green status
                  
                  return (
                    <tr key={iface._id || idx}>
                      <td className="text-center">
                        <button className="btn-icon-action" onClick={() => setEditingInterface(iface)}>
                          <FaCog />
                        </button>
                      </td>
                      <td className="fw-bold text-dark">
                        <span className={`status-dot ${isUp ? 'bg-success' : 'bg-secondary'}`}></span>
                        {iface.name}
                        {iface.deviceType === 'lte' && <span className="text-muted small ms-1">(LTE)</span>}
                        {iface.deviceType === 'wifi' && <span className="text-muted small ms-1">(WiFi)</span>}
                      </td>
                      <td>{iface.type}</td>
                      <td>
                        <div className="form-check form-switch d-flex justify-content-center">
                          <input 
                            className="form-check-input" 
                            type="checkbox" 
                            checked={isIfaceAssigned} 
                            onChange={(e) => handleInterfaceEdit(iface, 'isAssigned', e.target.checked)} 
                            style={{ cursor: 'pointer' }}
                          />
                        </div>
                      </td>
                      <td>
                        <input 
                          type="text" 
                          className="form-control form-control-sm"
                          value={interfaceChanges[iface._id]?.IPv4 !== undefined ? interfaceChanges[iface._id].IPv4 : (iface.IPv4 ? `${iface.IPv4}/${iface.IPv4Mask || '24'}` : '')}
                          onChange={(e) => handleInterfaceEdit(iface, 'IPv4', e.target.value)}
                          placeholder="IP/Mask"
                          style={{ minWidth: '130px' }}
                        />
                      </td>
                      <td>
                        <input 
                          type="text" 
                          className="form-control form-control-sm"
                          value={(interfaceChanges[iface._id]?.gateway !== undefined ? interfaceChanges[iface._id].gateway : iface.gateway) || ''}
                          onChange={(e) => handleInterfaceEdit(iface, 'gateway', e.target.value)}
                          placeholder="Gateway"
                          style={{ minWidth: '120px' }}
                        />
                      </td>
                      <td>{iface.metric || ''}</td>
                      <td>
                        {iface.PublicIP}
                        {iface.NatType && <div className="text-muted small" style={{fontSize: '0.7rem'}}>{iface.NatType}</div>}
                      </td>
                      <td>{iface.pathLabels || ''}</td>
                      <td>{iface.routing || 'None'}</td>
                    </tr>
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

        {activeTab === 'configuration' && currentSubTab === 'dhcp' && (
          <div className="p-4 bg-white border border-gray-300 rounded shadow-sm">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="mb-0 fw-bold">DHCP Server Configuration</h5>
              <Button variant="primary" size="sm" onClick={() => { 
                setEditingDhcp(null); 
                setDhcpForm({ interface: '', rangeStart: '', rangeEnd: '', dns: '8.8.8.8, 8.8.4.4', defaultLeaseTime: '', maxLeaseTime: '' }); 
                setShowDhcpModal(true); 
              }}>Add DHCP Server</Button>
            </div>
            <div className="table-container-template">
              <table className="custom-table-template">
                <thead>
                  <tr>
                    <th>Interface</th>
                    <th>Range</th>
                    <th>DNS</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dhcpServers.length > 0 ? dhcpServers.map((dhcp, i) => (
                    <tr key={i}>
                      <td className="fw-bold text-primary">{dhcp.interface}</td>
                      <td>{dhcp.rangeStart} - {dhcp.rangeEnd}</td>
                      <td>{dhcp.dns?.join(', ')}</td>
                      <td><Badge bg={dhcp.status === 'installed' ? 'success' : 'warning'}>{dhcp.status || 'pending'}</Badge></td>
                      <td>
                        <button className="btn-icon-action" onClick={() => { 
                          setEditingDhcp(dhcp); 
                          setDhcpForm({ 
                            interface: dhcp.interface, 
                            rangeStart: dhcp.rangeStart, 
                            rangeEnd: dhcp.rangeEnd, 
                            dns: dhcp.dns?.join(', ') || '',
                            defaultLeaseTime: dhcp.defaultLeaseTime,
                            maxLeaseTime: dhcp.maxLeaseTime
                          }); 
                          setShowDhcpModal(true); 
                        }} title="Edit">
                          <FaEdit size={12} />
                        </button>
                        <button className="btn-icon-action text-danger" onClick={() => handleDeleteDHCP(dhcp.interface)} title="Delete">
                          <FaTrash size={12} />
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5" className="text-center text-muted py-4">No DHCP servers configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'configuration' && currentSubTab === 'ospf' && (
          <div className="ospf-container">
            <h5 className="section-header">OSPF Configuration</h5>
            
            <div className="mb-4">
               <button className="btn-template btn-save-gray" onClick={handleSaveOSPF}>Save</button>
            </div>

            <div className="global-settings-card">
              <Row>
                <Col md={6}>
                  <div className="settings-field">
                    <label>Router ID</label>
                    <input 
                      type="text" 
                      className="input-template" 
                      value={ospfConfig.routerId} 
                      onChange={(e) => setOspfConfig({...ospfConfig, routerId: e.target.value})} 
                    />
                  </div>
                  <div className="settings-field mt-3">
                    <label>Redistribute BGP Routes</label>
                    <div className="toggle-wrapper">
                      <input type="checkbox" id="toggle-bgp" className="toggle-checkbox" checked={ospfConfig.redistributeBgp} onChange={(e) => setOspfConfig({...ospfConfig, redistributeBgp: e.target.checked})} />
                      <label htmlFor="toggle-bgp" className={`toggle-label ${ospfConfig.redistributeBgp ? 'checked' : ''}`} onClick={() => setOspfConfig({...ospfConfig, redistributeBgp: !ospfConfig.redistributeBgp})}></label>
                    </div>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="settings-field">
                    <label>Hello Interval (seconds)</label>
                    <input 
                      type="number" 
                      className="input-template" 
                      value={ospfConfig.helloInterval} 
                      onChange={(e) => setOspfConfig({...ospfConfig, helloInterval: e.target.value})} 
                    />
                  </div>
                  <div className="settings-field mt-3">
                    <label>Dead Interval (seconds)</label>
                    <input 
                      type="number" 
                      className="input-template" 
                      value={ospfConfig.deadInterval} 
                      onChange={(e) => setOspfConfig({...ospfConfig, deadInterval: e.target.value})} 
                    />
                  </div>
                  <div className="text-end mt-3">
                    <button className="btn-outline-gray">CLI Commands</button>
                  </div>
                </Col>
              </Row>
            </div>

            <h5 className="section-header mt-4">Networks</h5>
            <div className="table-container-template">
              <table className="custom-table-template">
                <thead>
                  <tr>
                    <th>Interface</th>
                    <th>Network</th>
                    <th>Area</th>
                    <th>Authentication key ID</th>
                    <th>Authentication key</th>
                    <th>Cost</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {getOspfInterfaces().length > 0 ? getOspfInterfaces().map((iface, idx) => (
                    <tr key={iface._id || idx}>
                      <td>{iface.name}</td>
                      <td>{iface.IPv4 ? `${iface.IPv4}/${iface.IPv4Mask || '24'}` : '-'}</td>
                      <td>{iface.ospf?.area || '0'}</td>
                      <td>{iface.ospf?.authKeyId || ''}</td>
                      <td>{iface.ospf?.authKey || ''}</td>
                      <td>{iface.ospf?.cost || ''}</td>
                      <td>
                        <button className="btn-icon-yellow" onClick={() => setEditingInterface(iface)}>
                          <FaCog />
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="7" className="text-center text-muted py-4">No interfaces configured for OSPF. Enable OSPF on an interface in the "Interfaces" tab first.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(activeTab === 'status' || activeTab === 'troubleshooting' || (activeTab === 'configuration' && !['interfaces', 'static-routes', 'ospf'].includes(currentSubTab))) && (
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
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>IPv4 Address / Mask</Form.Label>
                    <Form.Control 
                      type="text" 
                      value={(interfaceChanges[editingInterface._id]?.IPv4 !== undefined ? interfaceChanges[editingInterface._id].IPv4 : (editingInterface.IPv4 ? `${editingInterface.IPv4}/${editingInterface.IPv4Mask || '24'}` : '')) || ''} 
                      onChange={(e) => handleInterfaceEdit(editingInterface, 'IPv4', e.target.value)} 
                      placeholder="e.g. 192.168.1.1/24"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Gateway</Form.Label>
                    <Form.Control 
                      type="text" 
                      value={(interfaceChanges[editingInterface._id]?.gateway !== undefined ? interfaceChanges[editingInterface._id].gateway : editingInterface.gateway) || ''} 
                      onChange={(e) => handleInterfaceEdit(editingInterface, 'gateway', e.target.value)} 
                      placeholder="e.g. 192.168.1.254"
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>IPv4 Mask (Optional override)</Form.Label>
                    <Form.Control 
                      type="text" 
                      value={(interfaceChanges[editingInterface._id]?.IPv4Mask !== undefined ? interfaceChanges[editingInterface._id].IPv4Mask : editingInterface.IPv4Mask) || ''} 
                      onChange={(e) => handleInterfaceEdit(editingInterface, 'IPv4Mask', e.target.value)} 
                      placeholder="e.g. 24"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                   <Form.Group className="mb-3"><Form.Label>Metric</Form.Label><Form.Control type="text" value={(interfaceChanges[editingInterface._id]?.metric !== undefined ? interfaceChanges[editingInterface._id].metric : editingInterface.metric) || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'metric', e.target.value)} /></Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3"><Form.Label>Routing Protocol</Form.Label><Form.Select value={interfaceChanges[editingInterface._id]?.routing || editingInterface.routing || 'NONE'} onChange={(e) => handleInterfaceEdit(editingInterface, 'routing', e.target.value)}><option value="NONE">None</option><option value="OSPF">OSPF</option><option value="BGP">BGP</option></Form.Select></Form.Group>
              <Form.Group className="mb-3"><Form.Label>Bandwidth (Upload)</Form.Label><Form.Control type="number" value={interfaceChanges[editingInterface._id]?.bandwidthMbps?.tx || editingInterface.bandwidthMbps?.tx || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'bandwidthMbps', { ...editingInterface.bandwidthMbps, tx: e.target.value })} /></Form.Group>
              
              {/* OSPF Settings - displayed if routing is OSPF */}
              {(interfaceChanges[editingInterface._id]?.routing === 'OSPF' || (editingInterface.routing === 'OSPF' && !interfaceChanges[editingInterface._id]?.routing)) && (
                <>
                  <hr className="my-4" />
                  <h6 className="mb-3 fw-bold">OSPF Settings</h6>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Area</Form.Label>
                        <Form.Control type="text" value={interfaceChanges[editingInterface._id]?.ospf?.area || editingInterface.ospf?.area || '0.0.0.0'} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, area: e.target.value })} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Cost</Form.Label>
                        <Form.Control type="number" value={interfaceChanges[editingInterface._id]?.ospf?.cost || editingInterface.ospf?.cost || '10'} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, cost: e.target.value })} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Hello Interval</Form.Label>
                        <Form.Control type="number" value={interfaceChanges[editingInterface._id]?.ospf?.helloInterval || editingInterface.ospf?.helloInterval || '10'} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, helloInterval: e.target.value })} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Dead Interval</Form.Label>
                        <Form.Control type="number" value={interfaceChanges[editingInterface._id]?.ospf?.deadInterval || editingInterface.ospf?.deadInterval || '40'} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, deadInterval: e.target.value })} />
                      </Form.Group>
                    </Col>
                  </Row>
                </>
              )}
            </Form>
          </Modal.Body>
          <Modal.Footer><Button variant="secondary" onClick={() => setEditingInterface(null)}>Cancel</Button><Button variant="primary" onClick={() => setEditingInterface(null)}>Save Locally</Button></Modal.Footer>
        </Modal>
      )}

      {/* Update Device Modal removed */}

      <Modal show={showRouteModal} onHide={() => setShowRouteModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingRoute ? 'Edit Route' : 'Add Route'}</Modal.Title></Modal.Header>
        <Modal.Body><Form><Row><Col md={6}><Form.Group className="mb-3"><Form.Label>Destination Network</Form.Label><Form.Control value={routeForm.destination} onChange={e => setRouteForm({...routeForm, destination: e.target.value})} placeholder="192.168.10.0/24" /></Form.Group></Col><Col md={6}><Form.Group className="mb-3"><Form.Label>Gateway</Form.Label><Form.Control value={routeForm.gateway} onChange={e => setRouteForm({...routeForm, gateway: e.target.value})} placeholder="192.168.1.1" /></Form.Group></Col></Row><Form.Check label="Redistribute OSPF" checked={routeForm.redistributeViaOSPF} onChange={e => setRouteForm({...routeForm, redistributeViaOSPF: e.target.checked})} /><Form.Check label="Redistribute BGP" checked={routeForm.redistributeViaBGP} onChange={e => setRouteForm({...routeForm, redistributeViaBGP: e.target.checked})} /></Form></Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowRouteModal(false)}>Cancel</Button><Button variant="primary" onClick={handleSaveRoute}><FaSave className="me-2"/>Save Route</Button></Modal.Footer>
      </Modal>

      <Modal show={showDhcpModal} onHide={() => setShowDhcpModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingDhcp ? 'Edit DHCP Server' : 'Add DHCP Server'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Interface</Form.Label>
              <Form.Select 
                value={dhcpForm.interface} 
                onChange={e => setDhcpForm({...dhcpForm, interface: e.target.value})}
                disabled={!!editingDhcp} // Disable interface selection when editing
              >
                <option value="">Select Interface</option>
                {device?.interfaces?.filter(i => i.type === 'LAN').map(i => (
                  <option key={i._id} value={i.name}>{i.name} ({i.IPv4})</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Range Start</Form.Label>
                  <Form.Control value={dhcpForm.rangeStart} onChange={e => setDhcpForm({...dhcpForm, rangeStart: e.target.value})} placeholder="192.168.1.100" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Range End</Form.Label>
                  <Form.Control value={dhcpForm.rangeEnd} onChange={e => setDhcpForm({...dhcpForm, rangeEnd: e.target.value})} placeholder="192.168.1.200" />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-3">
              <Form.Label>DNS Servers (comma separated)</Form.Label>
              <Form.Control value={dhcpForm.dns} onChange={e => setDhcpForm({...dhcpForm, dns: e.target.value})} placeholder="8.8.8.8, 8.8.4.4" />
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Default Lease Time (seconds)</Form.Label>
                  <Form.Control type="number" value={dhcpForm.defaultLeaseTime} onChange={e => setDhcpForm({...dhcpForm, defaultLeaseTime: e.target.value})} placeholder="600" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Max Lease Time (seconds)</Form.Label>
                  <Form.Control type="number" value={dhcpForm.maxLeaseTime} onChange={e => setDhcpForm({...dhcpForm, maxLeaseTime: e.target.value})} placeholder="7200" />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDhcpModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSaveDHCP}><FaSave className="me-2"/>Save DHCP Server</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default DeviceInfo;