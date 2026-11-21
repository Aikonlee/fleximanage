import EdgeLoopbackDialog from '../components/device/EdgeLoopbackDialog';
import RoutingFilterDialog from '../components/device/RoutingFilterDialog';
import DeviceFirewallDialog from '../components/device/DeviceFirewallDialog';
import BgpNeighborDialog from '../components/device/BgpNeighborDialog';
import DhcpDialog from '../components/device/DhcpDialog';
import StaticRouteDialog from '../components/device/StaticRouteDialog';
import InterfaceDialog from '../components/device/InterfaceDialog';
import HardwareDialog from '../components/device/HardwareDialog';
import DeviceTroubleshootingPanels from '../components/device/DeviceTroubleshootingPanels';
import DeviceStatusPanels from '../components/device/DeviceStatusPanels';
import DeviceGeneral from '../components/device/DeviceGeneral';
import PermissionButton from '../components/common/PermissionButton';
import { clearSession } from '../auth/session';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge, Form, Table, Alert, Spinner, Row, Col } from 'react-bootstrap';
import {
  FaArrowLeft, FaCaretDown, FaColumns,
  FaPlay, FaStop, FaSyncAlt, FaMicrochip, FaEdit, FaTrash, FaCog
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
    interface: '', rangeStart: '', rangeEnd: '', dns: '', defaultLeaseTime: '', maxLeaseTime: '', macAssign: [], options: []
  });
  const DHCP_OPTION_CHOICES = ['routers', 'tftp-server-name', 'ntp-servers', 'interface-mtu', 'time-offset', 'domain-name'];
  const DHCP_OPTION_CODES = ['3', '66', '42', '26', '2', '15'];

  // Edge Loopback State (device.edgeLoopbacks - always-available local IP,
  // independent of LAN/WAN interface status; management-side only, see note
  // on the Link Monitors page for why: the flexiEdge agent isn't in this repo)
  const [edgeLoopbacks, setEdgeLoopbacks] = useState([]);
  const [showEdgeLoopbackModal, setShowEdgeLoopbackModal] = useState(false);
  const [edgeLoopbackForm, setEdgeLoopbackForm] = useState({ name: '', ip: '' });

  // BGP State (device.bgp - see models/devices.js)
  const [bgpConfig, setBgpConfig] = useState({
    enable: false, routerId: '', localASN: '', keepaliveInterval: '30',
    holdInterval: '90', redistributeOspf: true, custom: '', neighbors: []
  });
  const [showBgpNeighborModal, setShowBgpNeighborModal] = useState(false);
  const [editingBgpNeighborIdx, setEditingBgpNeighborIdx] = useState(null);
  const [bgpNeighborForm, setBgpNeighborForm] = useState({
    ip: '', remoteASN: '', password: '', inboundFilter: '', outboundFilter: '', sendCommunity: 'all', multiHop: 1
  });

  // Firewall & NAT State (device.firewall.rules - see models/firewallRule.js)
  const [firewallRules, setFirewallRules] = useState([]);
  const [deviceSpecificRulesEnabled, setDeviceSpecificRulesEnabled] = useState(true);
  const [showFirewallRuleModal, setShowFirewallRuleModal] = useState(false);
  const [editingFirewallRuleIdx, setEditingFirewallRuleIdx] = useState(null);
  const EMPTY_FIREWALL_RULE = {
    description: '', direction: 'inbound', inbound: 'edgeAccess', internalIP: '', internalPortStart: '',
    priority: 0, enabled: true, action: 'allow', interfaces: [],
    classification: {
      source: { ipPort: { ip: '', ports: '' }, lanNat: { interface: '', match: '', action: '' } },
      destination: { ipProtoPort: { ip: '', ports: '', protocols: [] }, lanNat: { match: '', action: '' } }
    }
  };
  const [firewallRuleForm, setFirewallRuleForm] = useState(EMPTY_FIREWALL_RULE);

  // Routing Filters State (device.routingFilters - see models/devices.js)
  const [routingFilters, setRoutingFilters] = useState([]);
  const [showRoutingFilterModal, setShowRoutingFilterModal] = useState(false);
  const [editingRoutingFilterIdx, setEditingRoutingFilterIdx] = useState(null);
  const [routingFilterForm, setRoutingFilterForm] = useState({ name: '', description: '', rules: [] });

  // Advanced Routing State (device.advancedRouting.custom - free-text FRR CLI passthrough)
  const [advancedRoutingCli, setAdvancedRoutingCli] = useState('');

  // Status tab data
  const [bgpStatus, setBgpStatus] = useState(null);
  const [routingTable, setRoutingTable] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [vrrpStatus, setVrrpStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Troubleshooting tab data
  const [deviceLogs, setDeviceLogs] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);

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
      if (error.response?.status === 401) { clearSession(); navigate('/login'); return null; }
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

      if (deviceData.bgp) {
        setBgpConfig({
          enable: Boolean(deviceData.bgp.enable),
          routerId: deviceData.bgp.routerId || '',
          localASN: deviceData.bgp.localASN || '',
          keepaliveInterval: deviceData.bgp.keepaliveInterval || '30',
          holdInterval: deviceData.bgp.holdInterval || '90',
          redistributeOspf: deviceData.bgp.redistributeOspf !== false,
          custom: deviceData.bgp.custom || '',
          neighbors: deviceData.bgp.neighbors || []
        });
      }

      setFirewallRules(deviceData.firewall?.rules || []);
      setDeviceSpecificRulesEnabled(deviceData.deviceSpecificRulesEnabled !== false);
      setRoutingFilters(deviceData.routingFilters || []);
      setAdvancedRoutingCli(deviceData.advancedRouting?.custom || '');
      setEdgeLoopbacks(deviceData.edgeLoopbacks || []);

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

  const handleSaveBGP = async () => {
    try {
      setLoading(true);
      await apiCall(`/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bgp: bgpConfig }) });
      await fetchDeviceInfo(true);
      alert('BGP configuration saved successfully');
    } catch (err) {
      alert('Failed to save BGP configuration: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBgpNeighbor = () => {
    const neighbors = [...bgpConfig.neighbors];
    if (editingBgpNeighborIdx !== null) neighbors[editingBgpNeighborIdx] = bgpNeighborForm;
    else neighbors.push(bgpNeighborForm);
    setBgpConfig({ ...bgpConfig, neighbors });
    setShowBgpNeighborModal(false);
  };

  const handleDeleteBgpNeighbor = (idx) => {
    if (!window.confirm('Remove this BGP neighbor?')) return;
    setBgpConfig({ ...bgpConfig, neighbors: bgpConfig.neighbors.filter((_, i) => i !== idx) });
  };

  const handleSaveFirewall = async () => {
    try {
      setLoading(true);
      await apiCall(`/devices/${deviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firewall: { rules: firewallRules }, deviceSpecificRulesEnabled })
      });
      await fetchDeviceInfo(true);
      alert('Firewall & NAT rules saved successfully');
    } catch (err) {
      alert('Failed to save firewall rules: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFirewallRule = () => {
    const rules = [...firewallRules];
    if (editingFirewallRuleIdx !== null) rules[editingFirewallRuleIdx] = firewallRuleForm;
    else rules.push(firewallRuleForm);
    setFirewallRules(rules);
    setShowFirewallRuleModal(false);
  };

  const handleDeleteFirewallRule = (idx) => {
    if (!window.confirm('Delete this rule?')) return;
    setFirewallRules(firewallRules.filter((_, i) => i !== idx));
  };

  const handleSaveRoutingFilters = async () => {
    try {
      setLoading(true);
      await apiCall(`/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routingFilters }) });
      await fetchDeviceInfo(true);
      alert('Routing filters saved successfully');
    } catch (err) {
      alert('Failed to save routing filters: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRoutingFilter = () => {
    const filters = [...routingFilters];
    if (editingRoutingFilterIdx !== null) filters[editingRoutingFilterIdx] = routingFilterForm;
    else filters.push(routingFilterForm);
    setRoutingFilters(filters);
    setShowRoutingFilterModal(false);
  };

  const handleDeleteRoutingFilter = (idx) => {
    if (!window.confirm('Delete this routing filter?')) return;
    setRoutingFilters(routingFilters.filter((_, i) => i !== idx));
  };

  const handleSaveAdvancedRouting = async () => {
    try {
      setLoading(true);
      await apiCall(`/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ advancedRouting: { custom: advancedRoutingCli } }) });
      await fetchDeviceInfo(true);
      alert('Advanced routing CLI saved successfully');
    } catch (err) {
      alert('Failed to save advanced routing: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEdgeLoopback = async () => {
    const next = [...edgeLoopbacks, edgeLoopbackForm];
    try {
      setLoading(true);
      await apiCall(`/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edgeLoopbacks: next }) });
      await fetchDeviceInfo(true);
      setShowEdgeLoopbackModal(false);
      setEdgeLoopbackForm({ name: '', ip: '' });
    } catch (err) {
      alert('Failed to add edge loopback: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEdgeLoopback = async (idx) => {
    if (!window.confirm('Remove this edge loopback?')) return;
    const next = edgeLoopbacks.filter((_, i) => i !== idx);
    try {
      setLoading(true);
      await apiCall(`/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edgeLoopbacks: next }) });
      await fetchDeviceInfo(true);
    } catch (err) {
      alert('Failed to remove edge loopback: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Status tab live data ---
  const fetchBgpStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await apiCall(`/devices/${deviceId}/bgp/status`);
      if (response && response.ok) setBgpStatus(response.data);
    } catch (err) {
      console.error('Failed to fetch BGP status:', err);
    } finally {
      setStatusLoading(false);
    }
  }, [deviceId, apiCall]);

  const fetchRoutingTable = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await apiCall(`/devices/${deviceId}/routes`);
      if (response && response.ok) setRoutingTable(response.data);
    } catch (err) {
      console.error('Failed to fetch routing table:', err);
    } finally {
      setStatusLoading(false);
    }
  }, [deviceId, apiCall]);

  const fetchStatistics = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await apiCall(`/devices/${deviceId}/statistics`);
      if (response && response.ok) setStatistics(response.data);
    } catch (err) {
      console.error('Failed to fetch statistics:', err);
    } finally {
      setStatusLoading(false);
    }
  }, [deviceId, apiCall]);

  const fetchVrrpStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await apiCall(`/vrrp/status?device=${deviceId}`);
      if (response && response.ok) setVrrpStatus(response.data);
    } catch (err) {
      console.error('Failed to fetch VRRP status:', err);
    } finally {
      setStatusLoading(false);
    }
  }, [deviceId, apiCall]);

  const fetchDeviceLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const response = await apiCall(`/devices/${deviceId}/logs`);
      if (response && response.ok) setDeviceLogs(response.data);
    } catch (err) {
      console.error('Failed to fetch device logs:', err);
    } finally {
      setLogsLoading(false);
    }
  }, [deviceId, apiCall]);

  useEffect(() => {
    if (activeTab !== 'status') return;
    if (currentSubTab === 'bgp-neighbors') fetchBgpStatus();
    else if (currentSubTab === 'routing-table') fetchRoutingTable();
    else if (currentSubTab === 'statistics') fetchStatistics();
    else if (currentSubTab === 'vrrp') fetchVrrpStatus();
  }, [activeTab, currentSubTab, fetchBgpStatus, fetchRoutingTable, fetchStatistics, fetchVrrpStatus]);

  useEffect(() => {
    if (activeTab === 'troubleshooting' && currentSubTab === 'logs') fetchDeviceLogs();
  }, [activeTab, currentSubTab, fetchDeviceLogs]);

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

  if (!device) return <Alert variant="danger">Device unavailable. <button type="button" className="btn btn-link" onClick={() => navigate('/devices')}>Back to devices</button></Alert>;

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
        <PermissionButton permKey="devices" method={'put'} native className="btn-template btn-orange" onClick={handleUpdateDevice}>Update Device</PermissionButton>
        <PermissionButton permKey="devices" method={'post'} native className="btn-template btn-green" onClick={() => performAction('start')} disabled={syncing || !isOnline || isRunning}><FaPlay className="small" /> Start Device</PermissionButton>
        <PermissionButton permKey="devices" method={'post'} native className="btn-template btn-gray" style={{backgroundColor: '#ef4444'}} onClick={() => performAction('stop')} disabled={syncing || !isOnline || !isRunning}><FaStop className="small" /> Stop Device</PermissionButton>
        <PermissionButton permKey="devices" method={'post'} native className="btn-template btn-gray" onClick={() => performAction('sync')} disabled={syncing || !isOnline}><FaSyncAlt className="small" /> Sync Device</PermissionButton>
        <PermissionButton permKey="devices" method={'put'} native className="btn-template btn-gray" onClick={() => setShowHardwareModal(true)}><FaMicrochip className="small" /> Hardware Configuration</PermissionButton>
      </div>

      {/* 3. Tabs Navigation */}
      <div className="tabs-nav">
        <div className={`tab-item ${activeTab === 'general' ? 'active' : ''}`} onClick={(e) => handleTabClick(e, 'general')}>General</div>

        {/* Configuration */}
        <div className={`tab-item tab-dropdown ${activeTab === 'configuration' ? 'active' : ''} ${activeDropdown === 'configuration' ? 'dropdown-open' : ''}`} onClick={(e) => handleTabClick(e, 'configuration')}>
          Configuration <FaCaretDown className="tab-caret" />
          <div className={`tab-dropdown-menu ${activeDropdown === 'configuration' ? 'show' : ''}`}>
            <button className={`dropdown-item ${currentSubTab === 'interfaces' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'interfaces')}>Interfaces</button>
            <button className={`dropdown-item ${currentSubTab === 'firewall' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'firewall')}>Firewall and NAT</button>
            <button className={`dropdown-item ${currentSubTab === 'static-routes' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'static-routes')}>Static Routes</button>
            <button className={`dropdown-item ${currentSubTab === 'dhcp' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'dhcp')}>DHCP Server</button>
            <button className={`dropdown-item ${currentSubTab === 'ospf' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'ospf')}>OSPF</button>
            <button className={`dropdown-item ${currentSubTab === 'bgp' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'bgp')}>BGP</button>
            <button className={`dropdown-item ${currentSubTab === 'routing-filters' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'routing-filters')}>Routing Filters</button>
            <button className={`dropdown-item ${currentSubTab === 'advanced-routing' ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'configuration', 'advanced-routing')}>Advanced Routing</button>
          </div>
        </div>

        {/* Status Dropdown */}
        <div className={`tab-item tab-dropdown ${activeTab === 'status' ? 'active' : ''} ${activeDropdown === 'status' ? 'dropdown-open' : ''}`} onClick={(e) => handleTabClick(e, 'status')}>
          Status <FaCaretDown className="tab-caret" />
          <div className={`tab-dropdown-menu ${activeDropdown === 'status' ? 'show' : ''}`}>
            {['apps', 'bgp-neighbors', 'policies', 'routing-table', 'statistics', 'vrrp'].map(sub => (
              <button key={sub} className={`dropdown-item ${currentSubTab === sub ? 'active' : ''}`} onClick={(e) => handleSubTabClick(e, 'status', sub)}>{sub.replace('-', ' ').toUpperCase()}</button>
            ))}
          </div>
        </div>

        {/* Troubleshooting Dropdown */}
        <div className={`tab-item tab-dropdown ${activeTab === 'troubleshooting' ? 'active' : ''} ${activeDropdown === 'troubleshooting' ? 'dropdown-open' : ''}`} onClick={(e) => handleTabClick(e, 'troubleshooting')}>
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
        <DeviceGeneral activeTab={activeTab} description={description} device={device} deviceName={deviceName} isApproved={isApproved} setDescription={setDescription} setDeviceName={setDeviceName} setIsApproved={setIsApproved} />

        {activeTab === 'configuration' && currentSubTab === 'interfaces' && (
          <>
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
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-action" onClick={() => setEditingInterface(iface)}>
                          <FaCog />
                        </PermissionButton>
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

          <div className="d-flex justify-content-between align-items-center mt-4 mb-2">
            <h6 className="fw-bold mb-0">Edge Loopback</h6>
            <PermissionButton permKey="devices" method={'put'} variant="primary" size="sm" onClick={() => { setEdgeLoopbackForm({ name: '', ip: '' }); setShowEdgeLoopbackModal(true); }}>Add Edge Loopback</PermissionButton>
          </div>
          <p className="text-muted small">An always-available local IP for this device, independent of LAN/WAN interface status, routable via OSPF.</p>
          <div className="table-container-template">
            <table className="custom-table-template">
              <thead><tr><th>Name</th><th>IP Address</th><th>Actions</th></tr></thead>
              <tbody>
                {edgeLoopbacks.length > 0 ? edgeLoopbacks.map((lb, idx) => (
                  <tr key={idx}>
                    <td className="fw-bold">{lb.name}</td>
                    <td>{lb.ip}</td>
                    <td><PermissionButton permKey="devices" method={'put'} native className="btn-icon-red" onClick={() => handleDeleteEdgeLoopback(idx)}><FaTrash /></PermissionButton></td>
                  </tr>
                )) : (
                  <tr><td colSpan="3" className="text-center text-muted py-4">No edge loopback configured.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          </>
        )}

        {activeTab === 'configuration' && currentSubTab === 'static-routes' && (
          <div className="p-4 bg-white border border-gray-300 rounded shadow-sm">
            <div className="d-flex justify-content-between align-items-center mb-3"><h5 className="mb-0 fw-bold">Static Routing Table</h5><PermissionButton permKey="devices" method={'post'} variant="primary" size="sm" onClick={() => { setEditingRoute(null); setRouteForm({ destination: '', gateway: '', ifname: '', metric: '', redistributeViaOSPF: false, redistributeViaBGP: false, onLink: false, conditions: [] }); setShowRouteModal(true); }}>Add Route</PermissionButton></div>
            <Table hover responsive className="custom-table-template">
              <thead><tr><th>Route</th><th>Redistribution</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {staticRoutes.map((route, i) => (
                  <tr key={route._id || i}><td><strong>Dest:</strong> <code>{route.destination}</code><br/><strong>GW:</strong> <code>{route.gateway}</code></td><td>{route.redistributeViaOSPF && <Badge bg="info" className="me-1">OSPF</Badge>} {route.redistributeViaBGP && <Badge bg="info">BGP</Badge>}</td><td><Badge bg={route.status === 'complete' ? 'success' : 'warning'}>{route.status || 'pending'}</Badge></td><td><PermissionButton permKey="devices" method={'patch'} variant="outline-primary" size="sm" className="me-1" onClick={() => { setEditingRoute(route); setRouteForm(route); setShowRouteModal(true); }}><FaEdit/></PermissionButton><PermissionButton permKey="devices" method={'delete'} variant="outline-danger" size="sm" onClick={() => handleDeleteRoute(route._id)}><FaTrash/></PermissionButton></td></tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {activeTab === 'configuration' && currentSubTab === 'dhcp' && (
          <div className="p-4 bg-white border border-gray-300 rounded shadow-sm">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="mb-0 fw-bold">DHCP Server Configuration</h5>
              <PermissionButton permKey="devices" method={'put'} variant="primary" size="sm" onClick={() => {
                setEditingDhcp(null);
                setDhcpForm({ interface: '', rangeStart: '', rangeEnd: '', dns: '8.8.8.8, 8.8.4.4', defaultLeaseTime: '', maxLeaseTime: '', macAssign: [], options: [] });
                setShowDhcpModal(true);
              }}>Add DHCP Server</PermissionButton>
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
                      <td className="fw-bold text-primary">{device?.interfaces?.find(i => i.devId === dhcp.interface)?.name || dhcp.interface}</td>
                      <td>{dhcp.rangeStart} - {dhcp.rangeEnd}</td>
                      <td>{dhcp.dns?.join(', ')}</td>
                      <td><Badge bg={dhcp.status === 'installed' ? 'success' : 'warning'}>{dhcp.status || 'pending'}</Badge></td>
                      <td>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-action" onClick={() => {
                          setEditingDhcp(dhcp);
                          setDhcpForm({
                            interface: dhcp.interface,
                            rangeStart: dhcp.rangeStart,
                            rangeEnd: dhcp.rangeEnd,
                            dns: dhcp.dns?.join(', ') || '',
                            defaultLeaseTime: dhcp.defaultLeaseTime,
                            maxLeaseTime: dhcp.maxLeaseTime,
                            macAssign: dhcp.macAssign || [],
                            options: dhcp.options || []
                          });
                          setShowDhcpModal(true);
                        }} title="Edit">
                          <FaEdit size={12} />
                        </PermissionButton>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-action text-danger" onClick={() => handleDeleteDHCP(dhcp.interface)} title="Delete">
                          <FaTrash size={12} />
                        </PermissionButton>
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
               <PermissionButton permKey="devices" method={'put'} native className="btn-template btn-save-gray" onClick={handleSaveOSPF}>Save</PermissionButton>
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
                      <label htmlFor="toggle-bgp" className={`toggle-label ${ospfConfig.redistributeBgp ? 'checked' : ''}`}></label>
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
                      <td>{iface.ospf?.keyId || ''}</td>
                      <td>{iface.ospf?.key || ''}</td>
                      <td>{iface.ospf?.cost || ''}</td>
                      <td>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-yellow" onClick={() => setEditingInterface(iface)}>
                          <FaCog />
                        </PermissionButton>
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

        {activeTab === 'configuration' && currentSubTab === 'bgp' && (
          <div className="bgp-container">
            <h5 className="section-header">BGP Configuration</h5>
            <div className="mb-4">
              <PermissionButton permKey="devices" method={'put'} native className="btn-template btn-save-gray" onClick={handleSaveBGP}>Save</PermissionButton>
            </div>
            <div className="global-settings-card">
              <Row>
                <Col md={6}>
                  <div className="settings-field">
                    <label>Enable BGP</label>
                    <div className="toggle-wrapper">
                      <input type="checkbox" id="toggle-bgp-enable" className="toggle-checkbox" checked={bgpConfig.enable} onChange={(e) => setBgpConfig({ ...bgpConfig, enable: e.target.checked })} />
                      <label htmlFor="toggle-bgp-enable" className={`toggle-label ${bgpConfig.enable ? 'checked' : ''}`}></label>
                    </div>
                  </div>
                  <div className="settings-field mt-3">
                    <label>Router ID</label>
                    <input type="text" className="input-template" placeholder="e.g. 192.168.1.1" value={bgpConfig.routerId} onChange={(e) => setBgpConfig({ ...bgpConfig, routerId: e.target.value })} />
                  </div>
                  <div className="settings-field mt-3">
                    <label>Local ASN (64512-65535)</label>
                    <input type="text" className="input-template" value={bgpConfig.localASN} onChange={(e) => setBgpConfig({ ...bgpConfig, localASN: e.target.value })} />
                  </div>
                  <div className="settings-field mt-3">
                    <label>Redistribute OSPF Routes</label>
                    <div className="toggle-wrapper">
                      <input type="checkbox" id="toggle-bgp-redist" className="toggle-checkbox" checked={bgpConfig.redistributeOspf} onChange={(e) => setBgpConfig({ ...bgpConfig, redistributeOspf: e.target.checked })} />
                      <label htmlFor="toggle-bgp-redist" className={`toggle-label ${bgpConfig.redistributeOspf ? 'checked' : ''}`}></label>
                    </div>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="settings-field">
                    <label>Keepalive Interval (seconds)</label>
                    <input type="number" className="input-template" value={bgpConfig.keepaliveInterval} onChange={(e) => setBgpConfig({ ...bgpConfig, keepaliveInterval: e.target.value })} />
                  </div>
                  <div className="settings-field mt-3">
                    <label>Hold Interval (seconds)</label>
                    <input type="number" className="input-template" value={bgpConfig.holdInterval} onChange={(e) => setBgpConfig({ ...bgpConfig, holdInterval: e.target.value })} />
                  </div>
                  <div className="settings-field mt-3">
                    <label>Custom CLI (advanced)</label>
                    <Form.Control as="textarea" rows={3} value={bgpConfig.custom} onChange={(e) => setBgpConfig({ ...bgpConfig, custom: e.target.value })} />
                  </div>
                </Col>
              </Row>
            </div>

            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="section-header mb-0">Neighbors</h5>
              <PermissionButton permKey="devices" method={'put'} variant="primary" size="sm" onClick={() => { setEditingBgpNeighborIdx(null); setBgpNeighborForm({ ip: '', remoteASN: '', password: '', inboundFilter: '', outboundFilter: '', sendCommunity: 'all', multiHop: 1 }); setShowBgpNeighborModal(true); }}>Add Neighbor</PermissionButton>
            </div>
            <div className="table-container-template">
              <table className="custom-table-template">
                <thead>
                  <tr><th>Remote IP</th><th>Remote ASN</th><th>Inbound Filter</th><th>Outbound Filter</th><th>Multi-hop</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {bgpConfig.neighbors.length > 0 ? bgpConfig.neighbors.map((n, idx) => (
                    <tr key={idx}>
                      <td>{n.ip}</td>
                      <td>{n.remoteASN}</td>
                      <td>{n.inboundFilter || '-'}</td>
                      <td>{n.outboundFilter || '-'}</td>
                      <td>{n.multiHop}</td>
                      <td>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-yellow" onClick={() => { setEditingBgpNeighborIdx(idx); setBgpNeighborForm(n); setShowBgpNeighborModal(true); }}><FaCog /></PermissionButton>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-red" onClick={() => handleDeleteBgpNeighbor(idx)}><FaTrash /></PermissionButton>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="6" className="text-center text-muted py-4">No BGP neighbors configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'configuration' && currentSubTab === 'firewall' && (
          <div className="firewall-container">
            <h5 className="section-header">Firewall & NAT</h5>
            <div className="mb-4 d-flex align-items-center gap-3">
              <PermissionButton permKey="devices" method={'put'} native className="btn-template btn-save-gray" onClick={handleSaveFirewall}>Save</PermissionButton>
              <div className="settings-field d-flex align-items-center gap-2 mb-0">
                <div className="toggle-wrapper">
                  <input type="checkbox" id="toggle-device-fw" className="toggle-checkbox" checked={deviceSpecificRulesEnabled} onChange={(e) => setDeviceSpecificRulesEnabled(e.target.checked)} />
                  <label htmlFor="toggle-device-fw" className={`toggle-label ${deviceSpecificRulesEnabled ? 'checked' : ''}`}></label>
                </div>
                <label className="mb-0">Enable device-specific rules</label>
              </div>
            </div>

            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Firewall Rules (Inbound / Outbound)</h6>
              <PermissionButton permKey="devices" method={'put'} variant="primary" size="sm" onClick={() => { setEditingFirewallRuleIdx(null); setFirewallRuleForm(EMPTY_FIREWALL_RULE); setShowFirewallRuleModal(true); }}>New Rule</PermissionButton>
            </div>
            <div className="table-container-template mb-4">
              <table className="custom-table-template">
                <thead>
                  <tr><th>Description</th><th>Direction</th><th>Source</th><th>Destination</th><th>Action</th><th>Priority</th><th>Enabled</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {firewallRules.filter(r => r.direction !== 'lanNat').length > 0 ? firewallRules.map((rule, idx) => rule.direction !== 'lanNat' && (
                    <tr key={idx}>
                      <td>{rule.description || '-'}</td>
                      <td>{rule.direction === 'inbound' ? rule.inbound : rule.direction}</td>
                      <td>{rule.classification?.source?.ipPort?.ip || 'Any'}</td>
                      <td>{rule.classification?.destination?.ipProtoPort?.ip || 'Any'}{rule.classification?.destination?.ipProtoPort?.ports ? `:${rule.classification.destination.ipProtoPort.ports}` : ''}</td>
                      <td><span className={`badge ${rule.action === 'allow' ? 'badge-success' : 'badge-danger'}`}>{rule.action}</span></td>
                      <td>{rule.priority}</td>
                      <td>{rule.enabled ? 'Yes' : 'No'}</td>
                      <td>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-yellow" onClick={() => { setEditingFirewallRuleIdx(idx); setFirewallRuleForm(rule); setShowFirewallRuleModal(true); }}><FaCog /></PermissionButton>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-red" onClick={() => handleDeleteFirewallRule(idx)}><FaTrash /></PermissionButton>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="8" className="text-center text-muted py-4">No firewall rules configured. Default policy: outbound allowed, inbound denied.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">LAN NAT Rules</h6>
              <PermissionButton permKey="devices" method={'put'} variant="primary" size="sm" onClick={() => { setEditingFirewallRuleIdx(null); setFirewallRuleForm({ ...EMPTY_FIREWALL_RULE, direction: 'lanNat' }); setShowFirewallRuleModal(true); }}>New LAN NAT Rule</PermissionButton>
            </div>
            <div className="table-container-template">
              <table className="custom-table-template">
                <thead>
                  <tr><th>Description</th><th>Source Match → Action</th><th>Destination Match → Action</th><th>Priority</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {firewallRules.filter(r => r.direction === 'lanNat').length > 0 ? firewallRules.map((rule, idx) => rule.direction === 'lanNat' && (
                    <tr key={idx}>
                      <td>{rule.description || '-'}</td>
                      <td>{rule.classification?.source?.lanNat?.match ? `${rule.classification.source.lanNat.match} → ${rule.classification.source.lanNat.action}` : '-'}</td>
                      <td>{rule.classification?.destination?.lanNat?.match ? `${rule.classification.destination.lanNat.match} → ${rule.classification.destination.lanNat.action}` : '-'}</td>
                      <td>{rule.priority}</td>
                      <td>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-yellow" onClick={() => { setEditingFirewallRuleIdx(idx); setFirewallRuleForm(rule); setShowFirewallRuleModal(true); }}><FaCog /></PermissionButton>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-red" onClick={() => handleDeleteFirewallRule(idx)}><FaTrash /></PermissionButton>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5" className="text-center text-muted py-4">No LAN NAT rules configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'configuration' && currentSubTab === 'routing-filters' && (
          <div className="routing-filters-container">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="section-header mb-0">Routing Filters</h5>
              <PermissionButton permKey="devices" method={'put'} variant="primary" size="sm" onClick={() => { setEditingRoutingFilterIdx(null); setRoutingFilterForm({ name: '', description: '', rules: [] }); setShowRoutingFilterModal(true); }}>New Filter</PermissionButton>
            </div>
            <p className="text-muted small">Referenced by BGP neighbors via Inbound/Outbound Filter (matched by name).</p>
            <div className="mb-3">
              <PermissionButton permKey="devices" method={'put'} native className="btn-template btn-save-gray" onClick={handleSaveRoutingFilters}>Save</PermissionButton>
            </div>
            <div className="table-container-template">
              <table className="custom-table-template">
                <thead><tr><th>Name</th><th>Description</th><th>Rules</th><th>Actions</th></tr></thead>
                <tbody>
                  {routingFilters.length > 0 ? routingFilters.map((filter, idx) => (
                    <tr key={idx}>
                      <td className="fw-bold">{filter.name}</td>
                      <td>{filter.description}</td>
                      <td>{(filter.rules || []).length} rule(s)</td>
                      <td>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-yellow" onClick={() => { setEditingRoutingFilterIdx(idx); setRoutingFilterForm(filter); setShowRoutingFilterModal(true); }}><FaCog /></PermissionButton>
                        <PermissionButton permKey="devices" method={'put'} native className="btn-icon-red" onClick={() => handleDeleteRoutingFilter(idx)}><FaTrash /></PermissionButton>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="4" className="text-center text-muted py-4">No routing filters configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'configuration' && currentSubTab === 'advanced-routing' && (
          <div className="advanced-routing-container">
            <h5 className="section-header">Advanced Routing</h5>
            <p className="text-muted small">Raw FRR CLI commands applied on top of the generated routing configuration. For advanced users only.</p>
            <div className="global-settings-card">
              <Form.Control as="textarea" rows={10} className="font-monospace" value={advancedRoutingCli} onChange={(e) => setAdvancedRoutingCli(e.target.value)} placeholder="e.g. router bgp 65000&#10; neighbor 10.0.0.1 route-map MYMAP in" />
            </div>
            <PermissionButton permKey="devices" method={'put'} native className="btn-template btn-save-gray" onClick={handleSaveAdvancedRouting}>Save</PermissionButton>
          </div>
        )}

        <DeviceStatusPanels activeTab={activeTab} bgpStatus={bgpStatus} currentSubTab={currentSubTab} device={device} routingTable={routingTable} statistics={statistics} statusLoading={statusLoading} vrrpStatus={vrrpStatus} />











        <DeviceTroubleshootingPanels activeTab={activeTab} currentSubTab={currentSubTab} device={device} deviceLogs={deviceLogs} fetchDeviceLogs={fetchDeviceLogs} logsLoading={logsLoading} performAction={performAction} syncing={syncing} />








      </div>

      {/* Modals */}
      <HardwareDialog applyingConfig={applyingConfig} cpuOptimization={cpuOptimization} currentVRouterCores={currentVRouterCores} handleApplyHardwareConfig={handleApplyHardwareConfig} hwCpuCores={hwCpuCores} powerSaving={powerSaving} setPowerSaving={setPowerSaving} setShowHardwareModal={setShowHardwareModal} setVRouterCores={setVRouterCores} showHardwareModal={showHardwareModal} vRouterCores={vRouterCores} />

      {editingInterface && (
        <InterfaceDialog editingInterface={editingInterface} handleInterfaceEdit={handleInterfaceEdit} interfaceChanges={interfaceChanges} setEditingInterface={setEditingInterface} />
      )}

      {/* Update Device Modal removed */}

      <StaticRouteDialog device={device} editingRoute={editingRoute} handleSaveRoute={handleSaveRoute} routeForm={routeForm} setRouteForm={setRouteForm} setShowRouteModal={setShowRouteModal} showRouteModal={showRouteModal} />

      <DhcpDialog DHCP_OPTION_CHOICES={DHCP_OPTION_CHOICES} DHCP_OPTION_CODES={DHCP_OPTION_CODES} device={device} dhcpForm={dhcpForm} editingDhcp={editingDhcp} handleSaveDHCP={handleSaveDHCP} setDhcpForm={setDhcpForm} setShowDhcpModal={setShowDhcpModal} showDhcpModal={showDhcpModal} />

      <BgpNeighborDialog bgpNeighborForm={bgpNeighborForm} editingBgpNeighborIdx={editingBgpNeighborIdx} handleSaveBgpNeighbor={handleSaveBgpNeighbor} routingFilters={routingFilters} setBgpNeighborForm={setBgpNeighborForm} setShowBgpNeighborModal={setShowBgpNeighborModal} showBgpNeighborModal={showBgpNeighborModal} />

      <DeviceFirewallDialog device={device} editingFirewallRuleIdx={editingFirewallRuleIdx} firewallRuleForm={firewallRuleForm} handleSaveFirewallRule={handleSaveFirewallRule} setFirewallRuleForm={setFirewallRuleForm} setShowFirewallRuleModal={setShowFirewallRuleModal} showFirewallRuleModal={showFirewallRuleModal} />

      <RoutingFilterDialog editingRoutingFilterIdx={editingRoutingFilterIdx} handleSaveRoutingFilter={handleSaveRoutingFilter} routingFilterForm={routingFilterForm} setRoutingFilterForm={setRoutingFilterForm} setShowRoutingFilterModal={setShowRoutingFilterModal} showRoutingFilterModal={showRoutingFilterModal} />

      <EdgeLoopbackDialog edgeLoopbackForm={edgeLoopbackForm} handleAddEdgeLoopback={handleAddEdgeLoopback} setEdgeLoopbackForm={setEdgeLoopbackForm} setShowEdgeLoopbackModal={setShowEdgeLoopbackModal} showEdgeLoopbackModal={showEdgeLoopbackModal} />
    </div>
  );
};

export default DeviceInfo;
