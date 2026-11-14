import PermissionButton from '../components/common/PermissionButton';
import { clearSession } from '../auth/session';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge, Modal, Form, Table, Button, Alert, Spinner, Row, Col } from 'react-bootstrap';
import { 
  FaArrowLeft, FaCaretDown, FaColumns, 
  FaPlay, FaStop, FaSyncAlt, FaMicrochip, FaEdit, FaCheck, FaSave, FaTrash, FaInfoCircle, FaCog
} from 'react-icons/fa';
import L from 'leaflet';
import api, { inferBaseURL } from '../services/api';
import StatusBadge from '../components/common/StatusBadge';
import './DeviceInfo.css';

// Absolute URL so tile requests hit the real backend directly, bypassing the
// dev-server's /api proxy (which is only correctly configured inside docker-compose).
const TILE_URL_TEMPLATE = `${inferBaseURL().replace(/\/+$/, '')}/public/tiles/{z}/{x}/{y}`;

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

  // Map State
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (activeTab !== 'general' || !device) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      return undefined;
    }

    if (mapInstanceRef.current || !mapContainerRef.current) return undefined;
    const coords = Array.isArray(device.coords) && device.coords.length === 2 ? device.coords : null;
    const lat = coords ? coords[0] : (device.location?.lat ?? 40.416775);
    const lon = coords ? coords[1] : (device.location?.lon ?? -3.70379);
    const zoom = 13;

    const map = L.map(mapContainerRef.current).setView([lat, lon], zoom);

    const tileLayer = L.tileLayer(TILE_URL_TEMPLATE, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      crossOrigin: 'anonymous'
    });

    tileLayer.addTo(map);

    const icon = L.divIcon({
      className: 'custom-map-marker',
      html: '<div style="background-color: #f7941d; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
      iconSize: [14, 14],
      popupAnchor: [0, -7]
    });

    L.marker([lat, lon], { icon }).addTo(map)
      .bindPopup(device.name || 'Device')
      .openPopup();

    mapInstanceRef.current = map;
    return undefined;
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
            <div className="grid-row" style={{marginTop: '2rem'}}><div className="col-span-12" style={{gridColumn: 'span 12'}}><div id="device-map" ref={mapContainerRef} className="map-container-template"></div></div></div>
          </div>
        )}

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

        {activeTab === 'status' && currentSubTab === 'apps' && (
          <div className="table-container-template">
            <table className="custom-table-template">
              <thead><tr><th>Identifier</th><th>Status</th></tr></thead>
              <tbody>
                {(device.applications || []).length > 0 ? device.applications.map((app, idx) => (
                  <tr key={idx}><td>{app.identifier}</td><td><StatusBadge status={app.status || 'pending'} /></td></tr>
                )) : (
                  <tr><td colSpan="2" className="text-center text-muted py-4">No applications installed on this device.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'status' && currentSubTab === 'bgp-neighbors' && (
          <div>
            {statusLoading ? <Spinner animation="border" size="sm" /> : (
              bgpStatus?.status?.neighbors?.length > 0 ? (
                <div className="table-container-template">
                  <table className="custom-table-template">
                    <thead><tr><th>#</th><th>Neighbor</th></tr></thead>
                    <tbody>
                      {bgpStatus.status.neighbors.map((n, idx) => <tr key={idx}><td>{idx + 1}</td><td>{n}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ) : <div className="global-settings-card text-muted">No live BGP neighbor data available{bgpStatus?.deviceStatus ? ` (device status: ${bgpStatus.deviceStatus})` : ''}.</div>
            )}
          </div>
        )}

        {activeTab === 'status' && currentSubTab === 'policies' && (
          <div className="status-kv-grid">
            {['multilink', 'firewall', 'qos'].map((key) => (
              <div className="status-kv-item" key={key}>
                <span className="status-kv-label">{key === 'multilink' ? 'Path Selection Policy' : key === 'firewall' ? 'Firewall Policy' : 'QoS Policy'}</span>
                <span className="status-kv-value"><StatusBadge status={device.policies?.[key]?.status || 'none'} /></span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'status' && currentSubTab === 'routing-table' && (
          <div>
            {statusLoading ? <Spinner animation="border" size="sm" /> : (
              <div className="table-container-template">
                <table className="custom-table-template">
                  <thead><tr><th>Destination</th><th>Gateway</th><th>Interface</th><th>Protocol</th></tr></thead>
                  <tbody>
                    {(routingTable?.osRoutes || []).length > 0 ? routingTable.osRoutes.map((r, idx) => (
                      <tr key={idx}><td>{r.destination || r.route}</td><td>{r.gateway || r.via}</td><td>{r.iface || r.dev}</td><td>{r.protocol || '-'}</td></tr>
                    )) : (
                      <tr><td colSpan="4" className="text-center text-muted py-4">No routing table data available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'status' && currentSubTab === 'statistics' && (
          <div>
            {statusLoading ? <Spinner animation="border" size="sm" /> : (
              statistics ? (
                <div className="status-kv-grid">
                  {Object.entries(statistics).filter(([, v]) => typeof v !== 'object').map(([k, v]) => (
                    <div className="status-kv-item" key={k}>
                      <span className="status-kv-label">{k}</span>
                      <span className="status-kv-value">{String(v)}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="global-settings-card text-muted">No statistics available.</div>
            )}
          </div>
        )}

        {activeTab === 'status' && currentSubTab === 'vrrp' && (
          <div>
            {statusLoading ? <Spinner animation="border" size="sm" /> : (
              Array.isArray(vrrpStatus) && vrrpStatus.length > 0 ? (
                <div className="table-container-template">
                  <table className="custom-table-template">
                    <thead><tr><th>Group</th><th>VRID</th><th>State</th><th>Priority</th></tr></thead>
                    <tbody>
                      {vrrpStatus.map((v, idx) => (
                        <tr key={idx}><td>{v.name}</td><td>{v.virtualRouterId}</td><td><StatusBadge status={v.state} /></td><td>{v.priority}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="global-settings-card text-muted">No VRRP groups configured for this device.</div>
            )}
          </div>
        )}

        {activeTab === 'troubleshooting' && currentSubTab === 'command' && (
          <div className="global-settings-card">
            <h6 className="fw-bold mb-3">Device Commands</h6>
            <div className="d-flex gap-2 flex-wrap">
              <PermissionButton permKey="devices" method={'post'} native className="btn-template btn-gray" onClick={() => performAction('sync')} disabled={syncing}>Sync Device</PermissionButton>
              <PermissionButton permKey="devices" method={'post'} native className="btn-template btn-gray" onClick={() => performAction('reset')} disabled={syncing}>Reset Device</PermissionButton>
            </div>
            <p className="text-muted small mt-3 mb-0">Commands are queued as device jobs and applied over the device's websocket connection.</p>
          </div>
        )}

        {activeTab === 'troubleshooting' && currentSubTab === 'edge-setting' && (
          <div className="global-settings-card">
            <h6 className="fw-bold mb-3">flexiEdge Local UI</h6>
            <p className="text-muted">Access the device's local troubleshooting UI directly, if reachable on its management IP.</p>
          </div>
        )}

        {activeTab === 'troubleshooting' && currentSubTab === 'logs' && (
          <div className="global-settings-card">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Device Logs</h6>
              <button className="btn-template btn-save-gray" onClick={fetchDeviceLogs} disabled={logsLoading}>{logsLoading ? 'Loading...' : 'Refresh'}</button>
            </div>
            <pre className="device-logs-view">
              {Array.isArray(deviceLogs?.logs) ? deviceLogs.logs.join('\n') : (deviceLogs ? JSON.stringify(deviceLogs, null, 2) : 'No logs loaded yet.')}
            </pre>
          </div>
        )}

        {activeTab === 'troubleshooting' && currentSubTab === 'packet-traces' && (
          <div className="global-settings-card text-muted">
            Packet trace capture is not implemented in this build yet.
          </div>
        )}

        {activeTab === 'troubleshooting' && currentSubTab === 'recovery-info' && (
          <div className="status-kv-grid">
            <div className="status-kv-item"><span className="status-kv-label">Sync State</span><span className="status-kv-value">{device.sync?.state || 'unknown'}</span></div>
            <div className="status-kv-item"><span className="status-kv-label">Last Sync Hash</span><span className="status-kv-value">{device.sync?.hash || '-'}</span></div>
            <div className="status-kv-item"><span className="status-kv-label">Sync Trials</span><span className="status-kv-value">{device.sync?.trials ?? '-'}</span></div>
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
        <Modal.Footer><Button variant="secondary" onClick={() => setShowHardwareModal(false)}>Cancel</Button><PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleApplyHardwareConfig} disabled={applyingConfig}>{applyingConfig ? 'Applying...' : 'Apply Configuration'}</PermissionButton></Modal.Footer>
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
                        <Form.Label>Authentication Key ID</Form.Label>
                        <Form.Control type="text" value={interfaceChanges[editingInterface._id]?.ospf?.keyId || editingInterface.ospf?.keyId || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, keyId: e.target.value })} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Authentication Key</Form.Label>
                        <Form.Control type="password" maxLength={16} value={interfaceChanges[editingInterface._id]?.ospf?.key || editingInterface.ospf?.key || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, key: e.target.value })} />
                      </Form.Group>
                    </Col>
                  </Row>
                </>
              )}
            </Form>
          </Modal.Body>
          <Modal.Footer><PermissionButton permKey="devices" method={'put'} variant="secondary" onClick={() => setEditingInterface(null)}>Cancel</PermissionButton><PermissionButton permKey="devices" method={'put'} variant="primary" onClick={() => setEditingInterface(null)}>Save Locally</PermissionButton></Modal.Footer>
        </Modal>
      )}

      {/* Update Device Modal removed */}

      <Modal show={showRouteModal} onHide={() => setShowRouteModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingRoute ? 'Edit Route' : 'Add Route'}</Modal.Title></Modal.Header>
        <Modal.Body><Form><Row><Col md={6}><Form.Group className="mb-3"><Form.Label>Destination Network</Form.Label><Form.Control value={routeForm.destination} onChange={e => setRouteForm({...routeForm, destination: e.target.value})} placeholder="192.168.10.0/24" /></Form.Group></Col><Col md={6}><Form.Group className="mb-3"><Form.Label>Gateway</Form.Label><Form.Control value={routeForm.gateway} onChange={e => setRouteForm({...routeForm, gateway: e.target.value})} placeholder="192.168.1.1" /></Form.Group></Col></Row><Row><Col md={6}><Form.Group className="mb-3"><Form.Label>Interface (optional)</Form.Label><Form.Select value={routeForm.ifname} onChange={e => setRouteForm({...routeForm, ifname: e.target.value})}><option value="">Auto (derive from gateway subnet)</option>{(device?.interfaces || []).map(i => <option key={i._id} value={i.devId || i.name}>{i.name}</option>)}</Form.Select><Form.Text className="text-muted">The outgoing interface. Optional if the gateway is within a subnet of one of the router interfaces.</Form.Text></Form.Group></Col><Col md={6}><Form.Group className="mb-3"><Form.Label>Metric (optional)</Form.Label><Form.Control value={routeForm.metric} onChange={e => setRouteForm({...routeForm, metric: e.target.value})} /></Form.Group></Col></Row><Form.Check label="Redistribute OSPF" checked={routeForm.redistributeViaOSPF} onChange={e => setRouteForm({...routeForm, redistributeViaOSPF: e.target.checked})} /><Form.Check label="Redistribute BGP" checked={routeForm.redistributeViaBGP} onChange={e => setRouteForm({...routeForm, redistributeViaBGP: e.target.checked})} /></Form></Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowRouteModal(false)}>Cancel</Button><PermissionButton permKey="devices" method={editingRoute ? 'patch' : 'post'} variant="primary" onClick={handleSaveRoute}><FaSave className="me-2"/>Save Route</PermissionButton></Modal.Footer>
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
                  <option key={i._id} value={i.devId || ''} disabled={!i.devId}>{i.name} ({i.IPv4}){!i.devId ? ' (bus address not yet reported by device)' : ''}</option>
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

            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="fw-bold mb-0">Static IP Assignments</h6>
              <Button size="sm" variant="outline-primary" onClick={() => setDhcpForm({ ...dhcpForm, macAssign: [...dhcpForm.macAssign, { host: '', mac: '', ipv4: '' }] })}>Add Assignment</Button>
            </div>
            {dhcpForm.macAssign.map((assign, aidx) => (
              <Row key={aidx} className="align-items-center mb-2">
                <Col md={4}><Form.Control placeholder="Host name" value={assign.host} onChange={e => { const macAssign = [...dhcpForm.macAssign]; macAssign[aidx] = { ...assign, host: e.target.value }; setDhcpForm({ ...dhcpForm, macAssign }); }} /></Col>
                <Col md={4}><Form.Control placeholder="MAC address" value={assign.mac} onChange={e => { const macAssign = [...dhcpForm.macAssign]; macAssign[aidx] = { ...assign, mac: e.target.value }; setDhcpForm({ ...dhcpForm, macAssign }); }} /></Col>
                <Col md={3}><Form.Control placeholder="IPv4 address" value={assign.ipv4} onChange={e => { const macAssign = [...dhcpForm.macAssign]; macAssign[aidx] = { ...assign, ipv4: e.target.value }; setDhcpForm({ ...dhcpForm, macAssign }); }} /></Col>
                <Col md={1}><button type="button" className="btn-icon-red" onClick={() => setDhcpForm({ ...dhcpForm, macAssign: dhcpForm.macAssign.filter((_, i) => i !== aidx) })}><FaTrash /></button></Col>
              </Row>
            ))}

            <div className="d-flex justify-content-between align-items-center mb-2 mt-3">
              <h6 className="fw-bold mb-0">DHCP Options</h6>
              <Button size="sm" variant="outline-primary" onClick={() => setDhcpForm({ ...dhcpForm, options: [...dhcpForm.options, { option: DHCP_OPTION_CHOICES[0], code: DHCP_OPTION_CODES[0], value: '' }] })}>Add Option</Button>
            </div>
            {dhcpForm.options.map((opt, oidx) => (
              <Row key={oidx} className="align-items-center mb-2">
                <Col md={4}>
                  <Form.Select value={opt.option} onChange={e => { const options = [...dhcpForm.options]; options[oidx] = { ...opt, option: e.target.value }; setDhcpForm({ ...dhcpForm, options }); }}>
                    {DHCP_OPTION_CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Select value={opt.code} onChange={e => { const options = [...dhcpForm.options]; options[oidx] = { ...opt, code: e.target.value }; setDhcpForm({ ...dhcpForm, options }); }}>
                    {DHCP_OPTION_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                  </Form.Select>
                </Col>
                <Col md={4}><Form.Control placeholder="Value" value={opt.value} onChange={e => { const options = [...dhcpForm.options]; options[oidx] = { ...opt, value: e.target.value }; setDhcpForm({ ...dhcpForm, options }); }} /></Col>
                <Col md={1}><button type="button" className="btn-icon-red" onClick={() => setDhcpForm({ ...dhcpForm, options: dhcpForm.options.filter((_, i) => i !== oidx) })}><FaTrash /></button></Col>
              </Row>
            ))}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDhcpModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'post'} variant="primary" onClick={handleSaveDHCP}><FaSave className="me-2"/>Save DHCP Server</PermissionButton>
        </Modal.Footer>
      </Modal>

      <Modal show={showBgpNeighborModal} onHide={() => setShowBgpNeighborModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingBgpNeighborIdx !== null ? 'Edit BGP Neighbor' : 'Add BGP Neighbor'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Remote IP</Form.Label><Form.Control value={bgpNeighborForm.ip} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, ip: e.target.value })} placeholder="10.0.0.1" /></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Remote ASN</Form.Label><Form.Control value={bgpNeighborForm.remoteASN} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, remoteASN: e.target.value })} /></Form.Group></Col>
            </Row>
            <Form.Group className="mb-3"><Form.Label>MD5 Key (optional)</Form.Label><Form.Control type="password" value={bgpNeighborForm.password} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, password: e.target.value })} /></Form.Group>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Inbound Filter (by name)</Form.Label><Form.Select value={bgpNeighborForm.inboundFilter} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, inboundFilter: e.target.value })}><option value="">None</option>{routingFilters.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}</Form.Select></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Outbound Filter (by name)</Form.Label><Form.Select value={bgpNeighborForm.outboundFilter} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, outboundFilter: e.target.value })}><option value="">None</option>{routingFilters.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}</Form.Select></Form.Group></Col>
            </Row>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Send Community</Form.Label>
                  <Form.Select value={bgpNeighborForm.sendCommunity} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, sendCommunity: e.target.value })}>
                    {['all', 'both', 'extended', 'large', 'standard', ''].map(v => <option key={v} value={v}>{v || '(none)'}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Multi-hop (1-255)</Form.Label><Form.Control type="number" min={1} max={255} value={bgpNeighborForm.multiHop} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, multiHop: e.target.value })} /></Form.Group></Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowBgpNeighborModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleSaveBgpNeighbor} disabled={!bgpNeighborForm.ip || !bgpNeighborForm.remoteASN}>Save Neighbor</PermissionButton>
        </Modal.Footer>
      </Modal>

      <Modal show={showFirewallRuleModal} onHide={() => setShowFirewallRuleModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingFirewallRuleIdx !== null ? 'Edit Rule' : 'New Rule'}{firewallRuleForm.direction === 'lanNat' ? ' (LAN NAT)' : ''}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control value={firewallRuleForm.description} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, description: e.target.value })} /></Form.Group>

            {firewallRuleForm.direction !== 'lanNat' && (
              <>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Direction</Form.Label>
                      <Form.Select value={firewallRuleForm.direction} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, direction: e.target.value })}>
                        <option value="outbound">Outbound</option>
                        <option value="inbound">Inbound</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Action</Form.Label>
                      <Form.Select value={firewallRuleForm.action} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, action: e.target.value })}>
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                </Row>
                {firewallRuleForm.direction === 'inbound' && (
                  <Row>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Inbound Type</Form.Label>
                        <Form.Select value={firewallRuleForm.inbound} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, inbound: e.target.value })}>
                          <option value="edgeAccess">flexiEdge access</option>
                          <option value="portForward">Port Forward</option>
                          <option value="nat1to1">1:1 NAT</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    {firewallRuleForm.inbound !== 'edgeAccess' && (
                      <>
                        <Col md={4}><Form.Group className="mb-3"><Form.Label>Internal IP</Form.Label><Form.Control value={firewallRuleForm.internalIP} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, internalIP: e.target.value })} /></Form.Group></Col>
                        <Col md={4}><Form.Group className="mb-3"><Form.Label>Internal Port</Form.Label><Form.Control value={firewallRuleForm.internalPortStart} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, internalPortStart: e.target.value })} /></Form.Group></Col>
                      </>
                    )}
                  </Row>
                )}
                <h6 className="fw-bold mt-3">Source</h6>
                <Row>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Source IP/Mask (blank = Any)</Form.Label><Form.Control value={firewallRuleForm.classification.source.ipPort.ip} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, ipPort: { ...firewallRuleForm.classification.source.ipPort, ip: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Source Ports</Form.Label><Form.Control value={firewallRuleForm.classification.source.ipPort.ports} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, ipPort: { ...firewallRuleForm.classification.source.ipPort, ports: e.target.value } } } })} /></Form.Group></Col>
                </Row>
                <h6 className="fw-bold">Destination</h6>
                <Row>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>Destination IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.destination.ipProtoPort.ip} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, ipProtoPort: { ...firewallRuleForm.classification.destination.ipProtoPort, ip: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>Destination Ports</Form.Label><Form.Control value={firewallRuleForm.classification.destination.ipProtoPort.ports} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, ipProtoPort: { ...firewallRuleForm.classification.destination.ipProtoPort, ports: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Protocol</Form.Label>
                      <Form.Select value={firewallRuleForm.classification.destination.ipProtoPort.protocols?.[0] || ''} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, ipProtoPort: { ...firewallRuleForm.classification.destination.ipProtoPort, protocols: e.target.value ? [e.target.value] : [] } } } })}>
                        <option value="">Any</option>
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                        <option value="icmp">ICMP</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                </Row>
                <Row>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Priority</Form.Label><Form.Control type="number" value={firewallRuleForm.priority} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, priority: Number(e.target.value) })} /></Form.Group></Col>
                  <Col md={6}>
                    <Form.Group className="mb-3 d-flex align-items-center gap-2">
                      <Form.Check type="switch" id="fw-rule-enabled" checked={firewallRuleForm.enabled} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, enabled: e.target.checked })} label="Enabled" />
                    </Form.Group>
                  </Col>
                </Row>
              </>
            )}

            {firewallRuleForm.direction === 'lanNat' && (
              <>
                <h6 className="fw-bold mt-2">Source</h6>
                <Row>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>LAN Interface</Form.Label><Form.Select value={firewallRuleForm.classification.source.lanNat.interface} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, lanNat: { ...firewallRuleForm.classification.source.lanNat, interface: e.target.value } } } })}><option value="">Select interface</option>{(device.interfaces || []).filter(i => i.type === 'LAN').map(i => <option key={i._id} value={i.devId || ''} disabled={!i.devId}>{i.name}{!i.devId ? ' (bus address not yet reported by device)' : ''}</option>)}</Form.Select></Form.Group></Col>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>Match IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.source.lanNat.match} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, lanNat: { ...firewallRuleForm.classification.source.lanNat, match: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>Action IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.source.lanNat.action} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, lanNat: { ...firewallRuleForm.classification.source.lanNat, action: e.target.value } } } })} /></Form.Group></Col>
                </Row>
                <h6 className="fw-bold">Destination</h6>
                <Row>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Match IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.destination.lanNat.match} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, lanNat: { ...firewallRuleForm.classification.destination.lanNat, match: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Action IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.destination.lanNat.action} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, lanNat: { ...firewallRuleForm.classification.destination.lanNat, action: e.target.value } } } })} /></Form.Group></Col>
                </Row>
                <Form.Group className="mb-3"><Form.Label>Priority</Form.Label><Form.Control type="number" value={firewallRuleForm.priority} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, priority: Number(e.target.value) })} /></Form.Group>
              </>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowFirewallRuleModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleSaveFirewallRule}>Save Rule</PermissionButton>
        </Modal.Footer>
      </Modal>

      <Modal show={showRoutingFilterModal} onHide={() => setShowRoutingFilterModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingRoutingFilterIdx !== null ? 'Edit Routing Filter' : 'New Routing Filter'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Name (no spaces)</Form.Label><Form.Control value={routingFilterForm.name} onChange={e => setRoutingFilterForm({ ...routingFilterForm, name: e.target.value.replace(/\s/g, '') })} /></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control value={routingFilterForm.description} onChange={e => setRoutingFilterForm({ ...routingFilterForm, description: e.target.value })} /></Form.Group></Col>
            </Row>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="fw-bold mb-0">Rules</h6>
              <Button size="sm" variant="outline-primary" onClick={() => setRoutingFilterForm({ ...routingFilterForm, rules: [...routingFilterForm.rules, { route: '', action: 'allow', nextHop: '', priority: routingFilterForm.rules.length }] })}>Add Rule</Button>
            </div>
            {routingFilterForm.rules.map((rule, ridx) => (
              <Row key={ridx} className="align-items-center mb-2">
                <Col md={4}><Form.Control placeholder="Route (IP/mask)" value={rule.route} onChange={e => { const rules = [...routingFilterForm.rules]; rules[ridx] = { ...rule, route: e.target.value }; setRoutingFilterForm({ ...routingFilterForm, rules }); }} /></Col>
                <Col md={3}>
                  <Form.Select value={rule.action} onChange={e => { const rules = [...routingFilterForm.rules]; rules[ridx] = { ...rule, action: e.target.value }; setRoutingFilterForm({ ...routingFilterForm, rules }); }}>
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </Form.Select>
                </Col>
                <Col md={3}><Form.Control placeholder="Next hop" value={rule.nextHop} onChange={e => { const rules = [...routingFilterForm.rules]; rules[ridx] = { ...rule, nextHop: e.target.value }; setRoutingFilterForm({ ...routingFilterForm, rules }); }} /></Col>
                <Col md={1}><Form.Control type="number" placeholder="Pri" value={rule.priority} onChange={e => { const rules = [...routingFilterForm.rules]; rules[ridx] = { ...rule, priority: Number(e.target.value) }; setRoutingFilterForm({ ...routingFilterForm, rules }); }} /></Col>
                <Col md={1}><button className="btn-icon-red" onClick={() => setRoutingFilterForm({ ...routingFilterForm, rules: routingFilterForm.rules.filter((_, i) => i !== ridx) })}><FaTrash /></button></Col>
              </Row>
            ))}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRoutingFilterModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleSaveRoutingFilter} disabled={!routingFilterForm.name}>Save Filter</PermissionButton>
        </Modal.Footer>
      </Modal>

      <Modal show={showEdgeLoopbackModal} onHide={() => setShowEdgeLoopbackModal(false)} centered>
        <Modal.Header closeButton><Modal.Title>Add Edge Loopback</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>Name</Form.Label><Form.Control value={edgeLoopbackForm.name} onChange={(e) => setEdgeLoopbackForm({ ...edgeLoopbackForm, name: e.target.value })} /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>IP Address</Form.Label><Form.Control value={edgeLoopbackForm.ip} onChange={(e) => setEdgeLoopbackForm({ ...edgeLoopbackForm, ip: e.target.value })} placeholder="e.g. 10.100.0.1" /></Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEdgeLoopbackModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleAddEdgeLoopback} disabled={!edgeLoopbackForm.name || !edgeLoopbackForm.ip}>Add</PermissionButton>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default DeviceInfo;
