import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Table } from 'react-bootstrap';
import api from '../services/api';
import './Home.css';

const Home = () => {
  const [deviceStats, setDeviceStats] = useState({
    running: 0,
    notRunning: 0,
    connected: 0,
    notConnected: 0,
    notApproved: 0,
    warning: 0
  });

  const [tunnelStats, setTunnelStats] = useState({
    connected: 0,
    notConnected: 0,
    pending: 0,
    unknown: 0
  });

  const [trafficStats, setTrafficStats] = useState({
    total: 0,
    unit: 'MBytes',
    totalBytes: 0,
    lastUpdate: null
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await api.get('/organizations/summary');
      const data = response.data;
      
      // Update device stats based on API response
      setDeviceStats({
        running: data.devices?.running || 0,
        notRunning: Math.max(0, (data.devices?.total || 0) - (data.devices?.running || 0)),
        connected: data.devices?.connected || 0,
        notConnected: Math.max(0, (data.devices?.total || 0) - (data.devices?.connected || 0)),
        notApproved: Math.max(0, (data.devices?.total || 0) - (data.devices?.approved || 0)),
        warning: 0
      });

      // Update tunnel stats
      setTunnelStats({
        connected: data.tunnels?.active || 0,
        notConnected: Math.max(0, (data.tunnels?.total || 0) - (data.tunnels?.active || 0)),
        pending: 0,
        unknown: 0
      });

      // Update traffic stats with real data from backend
      if (data.traffic) {
        setTrafficStats({
          total: data.traffic.total || 0,
          unit: data.traffic.unit || 'MBytes',
          totalBytes: data.traffic.totalBytes || 0,
          lastUpdate: data.traffic.lastUpdate
        });
      }

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-page">
      <div className="page-header">
        <h2>Home</h2>
        <p className="text-muted">Home</p>
      </div>

      {/* Network Status Section */}
      <Card className="mb-4">
        <Card.Header>
          <h5 className="mb-0">Network Status</h5>
        </Card.Header>
        <Card.Body>
          {/* Devices Status Table */}
          <div className="mb-4">
            <Table responsive className="network-status-table">
              <thead>
                <tr>
                  <th>Devices</th>
                  <th>Running</th>
                  <th>Not Running/NA</th>
                  <th>Connected</th>
                  <th>Not Connected</th>
                  <th>Not Approved</th>
                  <th>Warning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Devices</td>
                  <td className="status-running">{deviceStats.running}</td>
                  <td className="status-not-running">{deviceStats.notRunning}</td>
                  <td className="status-connected">{deviceStats.connected}</td>
                  <td className="status-not-connected">{deviceStats.notConnected}</td>
                  <td className="status-not-approved">{deviceStats.notApproved}</td>
                  <td className="status-warning">{deviceStats.warning}</td>
                </tr>
              </tbody>
            </Table>
          </div>

          {/* Tunnels Status Table */}
          <div className="mb-4">
            <Table responsive className="network-status-table">
              <thead>
                <tr>
                  <th>Tunnels</th>
                  <th>Connected</th>
                  <th>Not Connected</th>
                  <th>Pending</th>
                  <th>Unknown</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Tunnels</td>
                  <td className="status-connected">{tunnelStats.connected}</td>
                  <td className="status-not-connected">{tunnelStats.notConnected}</td>
                  <td className="status-pending">{tunnelStats.pending}</td>
                  <td className="status-unknown">{tunnelStats.unknown}</td>
                </tr>
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>

      {/* Traffic and World Map Section */}
      <Row>
        <Col md={6}>
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">Traffic this month</h5>
            </Card.Header>
            <Card.Body>
              <div className="traffic-stats">
                <div className="traffic-total">
                  <span className="traffic-label">Total</span>
                  <span className="traffic-value">{trafficStats.total} {trafficStats.unit}</span>
                </div>
                <a href="/traffic-dashboard" className="traffic-link">
                  Check traffic dashboard for more
                </a>
              </div>
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