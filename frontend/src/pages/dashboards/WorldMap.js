import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import api, { inferBaseURL } from '../../services/api';
import PageHeader from '../../components/common/PageHeader';
import './WorldMap.css';

// Absolute URL so tile requests hit the real backend directly, bypassing the
// dev-server's /api proxy (which is only correctly configured inside docker-compose).
const TILE_URL_TEMPLATE = `${inferBaseURL().replace(/\/+$/, '')}/public/tiles/{z}/{x}/{y}`;

const WorldMapDashboard = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});

  const fetchDevices = useCallback(async () => {
    try {
      const res = await api.get('/devices?response=detailed');
      setDevices(res.data?.devices || res.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const handleMarkerDragEnd = async (device, marker) => {
    const { lat, lng } = marker.getLatLng();
    try {
      await api.put(`/devices/${device._id}`, { coords: [lat, lng] });
    } catch (err) {
      // Revert the marker visually if the save failed
      const original = device.coords || [40.416775, -3.70379];
      marker.setLatLng(original);
      alert('Failed to save new site location: ' + (err.response?.data?.error || err.message));
    }
  };

  // Initialize the map once on mount
  useEffect(() => {
    if (mapInstanceRef.current || !mapContainerRef.current) return undefined;
    const map = L.map(mapContainerRef.current, { zoomControl: true }).setView([30, 15], 3);
    L.tileLayer(TILE_URL_TEMPLATE, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      crossOrigin: 'anonymous'
    }).addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Sync device markers whenever the device list changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentIds = new Set(devices.map((d) => d._id));

    // Remove markers for devices no longer present
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
      }
    });

    devices.forEach((device) => {
      const coords = device.coords && device.coords.length === 2 ? device.coords : [40.416775, -3.70379];
      const color = device.state === 'running' ? '#2ecc71' : '#e0473f';
      const icon = L.divIcon({
        className: 'world-map-marker',
        html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>`,
        iconSize: [16, 16],
        popupAnchor: [0, -8]
      });

      if (markersRef.current[device._id]) {
        markersRef.current[device._id].setLatLng(coords);
        markersRef.current[device._id].setIcon(icon);
      } else {
        const marker = L.marker(coords, { icon, draggable: true })
          .bindPopup(`<strong>${device.name || 'Unnamed device'}</strong><br/>${device.state === 'running' ? 'Running' : 'Stopped'} · ${device.isConnected ? 'Connected' : 'Not connected'}`)
          .addTo(map);
        marker.on('dragend', () => handleMarkerDragEnd(device, marker));
        markersRef.current[device._id] = marker;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  return (
    <div className="page-container world-map-page">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Dashboards' }, { label: 'World Map' }]}
        title="World Map"
      />
      {error && <div className="alert alert-danger">{error}</div>}
      <p className="text-muted small mb-2">
        Approximate site locations based on saved coordinates. Drag a marker to reposition a site.
      </p>
      <div className="world-map-card">
        <div ref={mapContainerRef} id="world-map" />
        {loading && <div className="world-map-loading">Loading devices...</div>}
      </div>
    </div>
  );
};

export default WorldMapDashboard;
