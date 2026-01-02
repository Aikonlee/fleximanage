import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Form, OverlayTrigger, Tooltip, Modal, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { 
  FaPlay, FaStop, FaSyncAlt, FaTrashAlt, 
  FaSearch, FaTimes, FaCaretDown, 
  FaThLarge, FaList, FaFileCsv, FaCheck
} from 'react-icons/fa';
import api from '../services/api';
import './Devices.css';

const Devices = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  
  // Tunnels Modal State
  const [showTunnelModal, setShowTunnelModal] = useState(false);
  const [tunnelTopology, setTunnelTopology] = useState('full-mesh');
  const [creatingTunnels, setCreatingTunnels] = useState(false);

  const menuRef = useRef(null);

  useEffect(() => {
    fetchDevices();
    
    // Click outside listener for closing menu
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchDevices = async () => {
    try {
      setLoading(true);
      const response = await api.get('/devices?response=detailed');
      setDevices(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch (error) {
      console.error('Error fetching devices:', error);
      setError('Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  const filteredDevices = useMemo(() => {
    return devices.filter(d => 
      (d.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
      (d.hostname || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [devices, searchTerm]);

  const handleDeviceSelect = (id) => {
    const next = new Set(selectedDevices);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedDevices(next);
  };

  const handleSelectAll = () => {
    // If all filtered devices are currently selected, deselect them all
    // Otherwise, select all filtered devices
    const allFilteredIds = filteredDevices.map(d => d._id || d.id);
    const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedDevices.has(id));

    if (isAllSelected) {
      setSelectedDevices(new Set());
    } else {
      setSelectedDevices(new Set(allFilteredIds));
    }
  };

  const performAction = async (action, deviceId = null) => {
    const targets = deviceId ? [deviceId] : Array.from(selectedDevices);
    if (targets.length === 0) {
      if (!deviceId) alert('Please select at least one device.');
      return;
    }

    if (action === 'delete' && !window.confirm(`Delete ${targets.length} device(s)?`)) return;

    for (const id of targets) {
      try {
        if (action === 'delete') {
          await api.delete(`/devices/${id}`);
        } else {
          // Map friendly action names to API methods if needed
          let method = action;
          let message = `${action}-router`;
          
          if (action === 'reset') {
             // Assuming reset logic or simply restart agent/router
             message = 'reset-router';
          }

          await api.post(`/devices/${id}/apply`, {
            method: method,
            entity: 'agent',
            message: message
          });
        }
      } catch (err) {
        console.error(`Action ${action} failed for ${id}:`, err);
      }
    }
    setShowActionsMenu(false);
    // Refresh after short delay
    setTimeout(() => {
        fetchDevices();
        if (action === 'delete') setSelectedDevices(new Set());
    }, 1000);
  };

  const handleCreateTunnelsClick = () => {
    if (selectedDevices.size < 2) {
      alert('Please select at least 2 devices to create tunnels');
      return;
    }
    setShowTunnelModal(true);
    setShowActionsMenu(false);
  };

  const handleCreateTunnelsSubmit = async () => {
    setCreatingTunnels(true);
    try {
      const devicesObj = {};
      Array.from(selectedDevices).forEach(id => devicesObj[id] = true);
      
      const response = await api.post('/devices/apply', {
        method: 'tunnels',
        devices: devicesObj,
        meta: {
          tunnelType: 'site-to-site',
          pathLabels: [],
          topology: tunnelTopology === 'hub-spoke' ? 'hubAndSpoke' : 'fullMesh',
          hub: null,
          advancedOptions: { routing: 'ospf' }
        }
      });

      // Updated condition: Check for successful status explicitly if ok is not available directly on the generic response
      // api wrapper normally returns { ok: boolean, status: number, ... } but axios response object has status
      // We'll check response.ok (from our wrapper) OR fall back to status check
      if (response && (response.ok || (response.status >= 200 && response.status < 300))) {
        alert('Tunnel creation started.');
        setShowTunnelModal(false);
        setSelectedDevices(new Set());
        fetchDevices();
      } else {
        throw new Error('Failed to create tunnels');
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setCreatingTunnels(false);
    }
  };

  const isAllSelected = filteredDevices.length > 0 && filteredDevices.every(d => selectedDevices.has(d._id || d.id));

  return (
    <div className="devices-page">
      {/* Breadcrumb Navigation */}
      <div className="breadcrumb-nav">
        <span>Home</span> <span className="mx-1">»</span> <span>Inventory</span> <span className="mx-1">»</span> <span className="active">Devices</span>
      </div>

      {/* Page Title */}
      <h1 className="page-title">
        Devices
        {selectedDevices.size > 0 && <span className="selected-count">({selectedDevices.size} selected)</span>}
      </h1>

      {/* Toolbar Area */}
      <div className="toolbar-container">
        
        <div className="toolbar-left">
          {/* Custom Checkbox Wrapper matching template */}
          <div 
            className={`checkbox-wrapper ${isAllSelected ? 'checked' : ''}`} 
            onClick={handleSelectAll}
            title={isAllSelected ? "Deselect All" : "Select All"}
          >
            {isAllSelected && <FaCheck />}
          </div>

          <button className="btn-refresh-template" onClick={fetchDevices} title="Refresh">
            <FaSyncAlt />
          </button>

          {/* Actions Dropdown */}
          <div className="actions-dropdown-container" ref={menuRef}>
            <button 
              className="btn-actions-template" 
              onClick={() => setShowActionsMenu(!showActionsMenu)}
            >
              Actions <FaCaretDown className="ms-2" />
            </button>

            {/* Replicated Actions Menu */}
            <div className={`actions-menu ${showActionsMenu ? 'show' : ''}`}>
              <div className="menu-group">
                <button className="menu-item" onClick={() => performAction('start')}>Start Device</button>
                <button className="menu-item" onClick={() => performAction('stop')}>Stop Device</button>
                <button className="menu-item" onClick={() => performAction('reset')}>Reset Device</button>
                <button className="menu-item text-danger" onClick={() => performAction('delete')}>Delete Selected Device</button>
              </div>
              
              <hr className="menu-divider" />
              <div className="menu-group">
                <div className="menu-header">Create Tunnels</div>
                <button className="menu-item" onClick={handleCreateTunnelsClick}>Create Peer Connection</button>
              </div>

              <hr className="menu-divider" />
              <div className="menu-group">
                <button className="menu-item" disabled style={{opacity: 0.5, cursor: 'default'}}>Install Policy</button>
                <button className="menu-item" disabled style={{opacity: 0.5, cursor: 'default'}}>Uninstall Policy</button>
              </div>

              <hr className="menu-divider" />
              <div className="menu-group">
                <button className="menu-item" onClick={() => performAction('sync')}>Sync Device</button>
              </div>
            </div>
          </div>
        </div>

        <div className="search-wrapper-template">
          <div className="filter-tag-template">
            <strong>Device Status</strong> == running
            <button><FaTimes /></button>
          </div>
          <input 
            type="text" 
            placeholder="Add filter" 
            className="search-input-template"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <FaSearch className="text-muted mx-2" />
        </div>

        <div className="toolbar-right">
          <button className="btn-clear-filters" onClick={() => setSearchTerm('')}>
            Clear Filters
          </button>
          <div className="view-switcher-template">
            <button 
              className={viewMode === 'grid' ? 'active' : ''} 
              onClick={() => setViewMode('grid')}
            >
              <FaThLarge />
            </button>
            <button 
              className={viewMode === 'list' ? 'active' : ''} 
              onClick={() => setViewMode('list')}
              style={{ borderLeft: '1px solid #e5e7eb' }}
            >
              <FaList />
            </button>
          </div>
          <button className="btn-export-csv" title="Export CSV">
            <FaFileCsv />
          </button>
        </div>
      </div>

      {/* Content Area */}
      {loading && devices.length === 0 ? (
        <div className="text-center py-5">Loading devices...</div>
      ) : error ? (
        <div className="alert alert-danger">{error}</div>
      ) : (
        <div className={viewMode === 'grid' ? "device-grid-template" : "device-list-template"}>
          {filteredDevices.map(device => {
            const id = device._id || device.id;
            const isSelected = selectedDevices.has(id);
            const isOnline = device.isConnected;
            const isRunning = device.state === 'running';
            const isApproved = device.isApproved;
            const isSynced = device.sync?.state === 'synced';

            return (
              <div key={id} className={`device-card-template ${isSelected ? 'border-orange-400' : ''}`}>
                {/* Card Header */}
                <div className="device-card-header-template">
                  <div className="device-card-title-area">
                    <input 
                      type="checkbox" 
                      className="form-check-input" 
                      checked={isSelected}
                      onChange={() => handleDeviceSelect(id)}
                    />
                    <Link to={`/devices/${id}`} className="device-card-name-link">
                      {device.name || 'Unknown'}
                    </Link>
                  </div>
                  
                  {/* Action Icons */}
                  <div className="device-card-actions-template">
                    <OverlayTrigger overlay={<Tooltip>Start</Tooltip>}>
                      <button className="btn-icon-play" onClick={() => performAction('start', id)} disabled={!isOnline || isRunning}>
                        <FaPlay className="text-xxs" />
                      </button>
                    </OverlayTrigger>
                    <OverlayTrigger overlay={<Tooltip>Stop</Tooltip>}>
                      <button className="btn-icon-stop" onClick={() => performAction('stop', id)} disabled={!isOnline || !isRunning}>
                        <FaStop className="text-xxs" />
                      </button>
                    </OverlayTrigger>
                    <OverlayTrigger overlay={<Tooltip>Sync</Tooltip>}>
                      <button className="btn-icon-sync" onClick={() => performAction('sync', id)} disabled={!isOnline}>
                        <FaSyncAlt className="text-xxs" />
                      </button>
                    </OverlayTrigger>
                    <OverlayTrigger overlay={<Tooltip>Delete</Tooltip>}>
                      <button className="btn-icon-trash" onClick={() => performAction('delete', id)}>
                        <FaTrashAlt className="text-xxs" />
                      </button>
                    </OverlayTrigger>
                  </div>
                </div>

                {/* Status Badges */}
                <div className="device-card-badges-template">
                  {isApproved && <span className="badge-template badge-success-template">Approved</span>}
                  <span className={`badge-template ${isOnline ? 'badge-success-template' : 'badge-secondary-template'}`}>
                    {isOnline ? 'Connected' : 'Offline'}
                  </span>
                  {isSynced && <span className="badge-template badge-success-template">Synced</span>}
                </div>

                {/* Info Grid */}
                <div className="device-card-info-template">
                  <div className="info-left-template text-start">
                    <p>vRouter: <span className={`font-bold-template ${isRunning ? 'text-green-template' : ''}`}>{isRunning ? 'Running' : 'Stopped'}</span></p>
                    <p>Hostname: <span className="text-dark-template">{device.hostname || 'N/A'}</span></p>
                    <p>WAN IPs: {device.interfaces?.filter(i => i.type === 'WAN').map(i => i.IPv4 || i.PublicIP).join(', ') || 'N/A'}</p>
                    <p className="text-xxs-template">ID: {device.machineId || id}</p>
                  </div>
                  <div className="info-right-template text-end">
                    <p>PPS: RX: {device.stats?.pps?.rx || 0} TX: {device.stats?.pps?.tx || 0}</p>
                    <p>BPS: RX: {device.stats?.bps?.rx || 0} TX: {device.stats?.bps?.tx || 0}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tunnel Creation Modal */}
      <Modal show={showTunnelModal} onHide={() => setShowTunnelModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Create Tunnels</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted">
            Create a VPN tunnel network between <strong>{selectedDevices.size}</strong> selected devices.
          </p>
          <Form.Group className="mb-3">
            <Form.Label className="fw-bold small text-uppercase text-muted">Topology</Form.Label>
            <div className="d-grid gap-2">
              <div 
                className={`p-3 border rounded cursor-pointer ${tunnelTopology === 'full-mesh' ? 'border-primary bg-light' : ''}`}
                onClick={() => setTunnelTopology('full-mesh')}
                style={{cursor: 'pointer'}}
              >
                <div className="fw-bold">Full Mesh</div>
                <div className="small text-muted">Every device connects to every other device. Best for resilience.</div>
              </div>
              <div 
                className={`p-3 border rounded cursor-pointer ${tunnelTopology === 'hub-spoke' ? 'border-primary bg-light' : ''}`}
                onClick={() => setTunnelTopology('hub-spoke')}
                style={{cursor: 'pointer'}}
              >
                <div className="fw-bold">Hub and Spoke</div>
                <div className="small text-muted">One central hub device connects to all spokes. Efficient for large networks.</div>
              </div>
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="link" className="text-muted text-decoration-none" onClick={() => setShowTunnelModal(false)} disabled={creatingTunnels}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreateTunnelsSubmit} disabled={creatingTunnels} className="px-4">
            {creatingTunnels ? 'Creating...' : 'Create Tunnels'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default Devices;