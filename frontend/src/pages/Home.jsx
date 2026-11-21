import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import api, { inferBaseURL } from '../services/api';
import './Home.css';

// Absolute URL so tile requests hit the real backend directly, bypassing the
// dev-server's /api proxy (which is only correctly configured inside docker-compose).
const TILE_URL_TEMPLATE = `${inferBaseURL().replace(/\/+$/, '')}/public/tiles/{z}/{x}/{y}`;

const Home = () => {
  const [deviceStats, setDeviceStats] = useState({
    running: 0,
    notRunning: 0,
    connected: 0,
    notConnected: 0,
    approved: 0,
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
    total: '0 B',
    totalBytes: 0,
    lastUpdate: null
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const initializeMap = (devicesList = []) => {
    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    // Clean up existing map instance if any
    if (mapElement._leaflet_id) return;

    try {
      const map = L.map('map', { zoomControl: true }).setView([50.1109, 8.6821], 5);

      // Create tile layer with proper configuration
      const tileLayer = L.tileLayer(TILE_URL_TEMPLATE, {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        crossOrigin: 'anonymous'
      });

      tileLayer.addTo(map);

      // Add device markers
      if (devicesList && devicesList.length > 0) {
        devicesList.forEach((device) => {
          const coords = device.coords || [];
          if (coords.length === 2) {
            // Schema default is [40.416775, -3.703790] (Madrid), which is [lat, lng]
            const [latitude, longitude] = coords;
            const color = device.state === 'running' ? '#16a34a' : '#dc2626';

            const icon = L.divIcon({
              className: 'custom-map-marker',
              html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
              iconSize: [12, 12],
              popupAnchor: [0, -6]
            });

            L.marker([latitude, longitude], { icon })
              .bindPopup(`<strong>${device.name}</strong><br/>${device.state === 'running' ? 'Running' : 'Stopped'}`)
              .addTo(map);
          }
        });
      }
    } catch (err) {
      console.error('Map initialization error:', err);
    }
  };

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await api.get('/organizations/summary');
      const data = response.data;
      
      // Fetch devices list for map and accurate stats
      let devicesList = [];
      try {
        const devRes = await api.get('/devices');
        devicesList = devRes.data?.devices || devRes.data || [];
      } catch (e) {
        // Note: data.devices from /organizations/summary is just a count,
        // not a device array, so there's no richer fallback to use here.
        console.warn('Failed to fetch devices list', e);
        devicesList = [];
      }
      
      // Calculate Stats
      const totalDevs = devicesList.length;
      const running = devicesList.filter(d => d.state === 'running').length;
      const connected = devicesList.filter(d => d.isConnected).length;
      const approved = devicesList.filter(d => d.isApproved).length;
      
      setDeviceStats({
        running,
        notRunning: totalDevs - running,
        connected,
        notConnected: Math.max(0, totalDevs - connected),
        approved,
        notApproved: Math.max(0, totalDevs - approved),
        warning: 0 // Placeholder as logic for warning isn't specified
      });

      // Backend counts only active (not deleted) tunnels and classifies them
      const tunnels = data.tunnels || {};
      setTunnelStats({
        connected: tunnels.connected || 0,
        notConnected: tunnels.notConnected || 0,
        pending: tunnels.pending || 0,
        unknown: tunnels.unknown || 0
      });

      if (data.traffic) {
        setTrafficStats({
          total: `${(data.traffic.total || 0).toFixed(2)} ${data.traffic.unit || 'MBytes'}`,
          totalBytes: data.traffic.totalBytes || 0,
          lastUpdate: data.traffic.lastUpdate
        });
      } else {
        setTrafficStats({ total: '0 B', totalBytes: 0, lastUpdate: null });
      }

      initializeMap(devicesList);

    } catch (err) {
      console.error('Dashboard data fetch failed:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Helper component for status circle
  const StatusItem = ({ label, count, type }) => (
    <div className="status-item">
      <div className="status-label">{label}</div>
      <div className={`status-circle ${type}`}>
        {loading ? '-' : count}
      </div>
    </div>
  );

  return (
    <div className="home-page">
      {/* Breadcrumb Navigation */}
      <div className="breadcrumb-nav">
        <span>Home</span>
      </div>

      {/* Page Title */}
      <h1 className="page-title">Home</h1>

      {error && <div className="alert alert-danger">{error}</div>}

      {/* Network Status Section */}
      <div className="panel">
        <div className="panel-header">Network Status</div>
        <div className="panel-body">
          
          {/* Devices Row */}
          <div className="status-row">
            <div className="row-label">Devices</div>
            <div className="status-group-container">
              
              {/* Running / Not Running */}
              <div className="status-group">
                <StatusItem label="Running" count={deviceStats.running} type="success" />
                <div className="dotted-line"></div>
                <StatusItem label="Not Running/NA" count={deviceStats.notRunning} type="danger" />
              </div>

              {/* Connected / Not Connected */}
              <div className="status-group">
                <StatusItem label="Connected" count={deviceStats.connected} type="success" />
                <div className="dotted-line"></div>
                <StatusItem label="Not Connected" count={deviceStats.notConnected} type="danger" />
              </div>

               {/* Not Approved */}
               <div className="status-group single">
                <StatusItem label="Not Approved" count={deviceStats.notApproved} type="secondary" />
              </div>

               {/* Warning */}
               <div className="status-group single">
                <StatusItem label="Warning" count={deviceStats.warning} type="warning" />
              </div>

            </div>
          </div>

          {/* Tunnels Row */}
          <div className="status-row">
            <div className="row-label">Tunnels</div>
            <div className="status-group-container">
              
              <div className="status-group">
                <StatusItem label="Connected" count={tunnelStats.connected} type="success" />
                <div className="dotted-line"></div>
                <StatusItem label="Not Connected" count={tunnelStats.notConnected} type="danger" />
                <div className="dotted-line"></div>
                <StatusItem label="Pending" count={tunnelStats.pending} type="warning" />
                <div className="dotted-line"></div>
                <StatusItem label="Unknown" count={tunnelStats.unknown} type="secondary" />
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Traffic Section */}
      <div className="panel mt-4">
        <div className="panel-header">Traffic this month</div>
        <div className="panel-body flex-row-center">
          <span className="traffic-label">Total</span>
          <span className="traffic-value">{trafficStats.total}</span>
          <Link to="/dashboards/traffic" className="dashboard-link">Check traffic dashboard for more</Link>
        </div>
      </div>

      {/* World Map Section */}
      <div className="panel mt-4">
        <div className="panel-header">
          <span>World Map</span>
          <Link to="/dashboards/world-map" className="dashboard-link ml-4 italic">Larger map in World Map dashboard</Link>
        </div>
        <div className="panel-body p-0">
           <div id="map"></div>
        </div>
      </div>

    </div>
  );
};

export default Home;