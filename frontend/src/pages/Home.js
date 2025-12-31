import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Table } from 'react-bootstrap';
import api from '../services/api';
import './Home.css';

const Home = () => {
  const [deviceStats, setDeviceStats] = useState({
    total: 0,           // Total devices in organization
    running: 0,         // From backend: deviceStatus.state === 'running'
    notRunning: 0,      // Calculated: total - running
    connected: 0,       // From backend: isConnected === true
    notConnected: 0,    // Calculated: total - connected
    approved: 0,        // From backend: isApproved === true
    notApproved: 0,     // Calculated: total - approved
    warning: 0          // Placeholder: not implemented yet
  });

  const [tunnelStats, setTunnelStats] = useState({
    total: 0,           // Total tunnels in organization
    connected: 0,       // From backend: isActive === true (active tunnels)
    notConnected: 0,    // Calculated: total - active
    pending: 0,         // Placeholder: not implemented yet
    unknown: 0          // Placeholder: not implemented yet
  });

  const [trafficStats, setTrafficStats] = useState({
    total: 0,           // Formatted traffic value
    unit: 'MBytes',     // Unit: Bytes, KBytes, MBytes, GBytes
    totalBytes: 0,      // Raw bytes count (rx_bytes + tx_bytes from all interfaces)
    lastUpdate: null    // Last update timestamp
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await api.get('/organizations/summary');
      const data = response.data;
      
      console.log('HOME: API response status:', response.status);
      console.log('HOME: API response data:', data);
      console.log('HOME: Full response object:', response);
      
      // Update device statistics
      // Backend queries from /backend/routes/organizations.js (Lines 312-326):
      // - total: countDocuments({ org })
      // - running: countDocuments({ deviceStatus.state: 'running' })
      // - connected: countDocuments({ isConnected: true })
      // - approved: countDocuments({ isApproved: true })
      const deviceTotal = data.devices?.total || 0;
      const deviceRunning = data.devices?.running || 0;
      const deviceConnected = data.devices?.connected || 0;
      const deviceApproved = data.devices?.approved || 0;
      
      console.log('HOME: Parsed device stats - total:', deviceTotal, 'running:', deviceRunning, 'connected:', deviceConnected, 'approved:', deviceApproved);
      
      setDeviceStats({
        total: deviceTotal,
        running: deviceRunning,
        notRunning: Math.max(0, deviceTotal - deviceRunning),        // Calculated
        connected: deviceConnected,
        notConnected: Math.max(0, deviceTotal - deviceConnected),    // Calculated
        approved: deviceApproved,
        notApproved: Math.max(0, deviceTotal - deviceApproved),      // Calculated
        warning: 0  // Not implemented: could show devices with issues in the future
      });

      // Update tunnel statistics
      // Backend queries from /backend/routes/organizations.js (Lines 328-334):
      // - total: countDocuments({ org })
      // - active: countDocuments({ isActive: true })
      const tunnelTotal = data.tunnels?.total || 0;
      const tunnelActive = data.tunnels?.active || 0;
      
      setTunnelStats({
        total: tunnelTotal,
        connected: tunnelActive,                                      // Active tunnels
        notConnected: Math.max(0, tunnelTotal - tunnelActive),       // Calculated
        pending: 0,   // Not implemented: could track tunnels being established
        unknown: 0    // Not implemented: could track tunnels with indeterminate status
      });

      // Update traffic statistics
      // Backend aggregates from deviceStats collection (Lines 336-398):
      // - Aggregates latest stats for each device
      // - Sums rx_bytes + tx_bytes from all interfaces
      // - Converts to human-readable units (Bytes/KB/MB/GB)
      if (data.traffic) {
        setTrafficStats({
          total: data.traffic.total || 0,
          unit: data.traffic.unit || 'MBytes',
          totalBytes: data.traffic.totalBytes || 0,
          lastUpdate: data.traffic.lastUpdate
        });
      } else {
        // Handle case where traffic data is not available
        setTrafficStats({
          total: 0,
          unit: 'MBytes',
          totalBytes: 0,
          lastUpdate: null
        });
      }

    } catch (error) {
      console.error('HOME: Error fetching dashboard data:', error);
      console.error('HOME: Error response:', error.response?.data);
      console.error('HOME: Error status:', error.response?.status);
      console.error('HOME: Full error:', error);
      setError(error.response?.data?.message || error.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // Format last update time
  const formatLastUpdate = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch (e) {
      return 'N/A';
    }
  };

  return (
    <div className="home-page">
      <div className="page-header">
        <h2>Home</h2>
        <p className="text-muted">Dashboard Overview</p>
      </div>

      {/* Error Alert */}
      {error && (
        <Card className="mb-4 border-danger">
          <Card.Body className="text-danger">
            <strong>Error:</strong> {error}
            <button 
              className="btn btn-sm btn-outline-danger ms-3" 
              onClick={fetchDashboardData}
            >
              Retry
            </button>
          </Card.Body>
        </Card>
      )}

      {/* Network Status Section */}
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Network Status</h5>
          <button 
            className="btn btn-sm btn-outline-secondary" 
            onClick={fetchDashboardData}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </Card.Header>
        <Card.Body>
          {/* Devices Status Table */}
          <div className="mb-4">
            <h6 className="mb-3">Devices Statistics</h6>
            {loading ? (
              <div className="text-center py-3">
                <div className="spinner-border spinner-border-sm me-2" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                Loading device statistics...
              </div>
            ) : (
              <Table responsive className="network-status-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Total</th>
                    <th>Running</th>
                    <th>Not Running/NA</th>
                    <th>Connected</th>
                    <th>Not Connected</th>
                    <th>Approved</th>
                    <th>Not Approved</th>
                    <th>Warning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Devices</strong></td>
                    <td className="status-total">{deviceStats.total}</td>
                    <td className="status-running">{deviceStats.running}</td>
                    <td className="status-not-running">{deviceStats.notRunning}</td>
                    <td className="status-connected">{deviceStats.connected}</td>
                    <td className="status-not-connected">{deviceStats.notConnected}</td>
                    <td className="status-approved">{deviceStats.approved}</td>
                    <td className="status-not-approved">{deviceStats.notApproved}</td>
                    <td className="status-warning">{deviceStats.warning || '-'}</td>
                  </tr>
                </tbody>
              </Table>
            )}
            <small className="text-muted d-block mt-2">
              * Running: devices with vRouter running | Connected: devices online | Approved: devices authorized by admin
            </small>
          </div>

          {/* Tunnels Status Table */}
          <div className="mb-4">
            <h6 className="mb-3">Tunnels Statistics</h6>
            {loading ? (
              <div className="text-center py-3">
                <div className="spinner-border spinner-border-sm me-2" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                Loading tunnel statistics...
              </div>
            ) : (
              <Table responsive className="network-status-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Total</th>
                    <th>Connected</th>
                    <th>Not Connected</th>
                    <th>Pending</th>
                    <th>Unknown</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Tunnels</strong></td>
                    <td className="status-total">{tunnelStats.total}</td>
                    <td className="status-connected">{tunnelStats.connected}</td>
                    <td className="status-not-connected">{tunnelStats.notConnected}</td>
                    <td className="status-pending">{tunnelStats.pending || '-'}</td>
                    <td className="status-unknown">{tunnelStats.unknown || '-'}</td>
                  </tr>
                </tbody>
              </Table>
            )}
            <small className="text-muted d-block mt-2">
              * Connected: active tunnels with isActive=true | Pending/Unknown: not yet implemented
            </small>
          </div>
        </Card.Body>
      </Card>

      {/* Traffic and World Map Section */}
      <Row>
        <Col md={6}>
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">Traffic Statistics</h5>
            </Card.Header>
            <Card.Body>
              {loading ? (
                <div className="text-center py-4">
                  <div className="spinner-border spinner-border-sm me-2" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  Loading traffic data...
                </div>
              ) : (
                <div className="traffic-stats">
                  <div className="traffic-total mb-3">
                    <span className="traffic-label d-block text-muted mb-1">Total Traffic</span>
                    <span className="traffic-value h3 mb-0">
                      {trafficStats.total.toFixed(2)} {trafficStats.unit}
                    </span>
                  </div>
                  <div className="traffic-details">
                    <small className="text-muted d-block mb-2">
                      <strong>Raw bytes:</strong> {trafficStats.totalBytes.toLocaleString()} bytes
                    </small>
                    <small className="text-muted d-block mb-3">
                      <strong>Last updated:</strong> {formatLastUpdate(trafficStats.lastUpdate)}
                    </small>
                    <small className="text-muted d-block fst-italic">
                      * Traffic aggregated from all device interfaces (rx_bytes + tx_bytes)
                    </small>
                  </div>
                  <a href="/traffic-dashboard" className="traffic-link btn btn-sm btn-outline-primary mt-3">
                    View Traffic Dashboard
                  </a>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
        
        <Col md={6}>
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">World Map</h5>
            </Card.Header>
            <Card.Body>
              <div className="world-map-container">
                <div className="map-placeholder">
                  <div className="map-controls">
                    <button className="map-control zoom-in">+</button>
                    <button className="map-control zoom-out">−</button>
                  </div>
                  <div className="map-content">
                    <p>Interactive World Map</p>
                    <small>Leaflet | © OpenStreetMap contributors</small>
                  </div>
                </div>
                <a href="/world-map-dashboard" className="map-link">
                  Larger map in World Map dashboard
                </a>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Home;