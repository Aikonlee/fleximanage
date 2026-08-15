import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import PageHeader from '../../components/common/PageHeader';
import './NetworkConnectivity.css';

const WIDTH = 1200;
const HEIGHT = 640;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const RADIUS = Math.min(WIDTH, HEIGHT) / 2 - 90;

// A tunnel is considered "not yet fully connected" (rendered dashed) whenever
// either side hasn't installed its config, or the live tunnel status isn't up.
const isTunnelDashed = (tunnel) => {
  if (tunnel.deviceAconf === false || tunnel.deviceBconf === false) return true;
  if (tunnel.status && tunnel.status !== 'up') return true;
  const liveA = tunnel.tunnelStatusA;
  const liveB = tunnel.tunnelStatusB;
  if (liveA && liveA.status && liveA.status !== 'up') return true;
  if (liveB && liveB.status && liveB.status !== 'up') return true;
  return false;
};

const NetworkConnectivity = () => {
  const [devices, setDevices] = useState([]);
  const [tunnels, setTunnels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [dragState, setDragState] = useState(null);
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    try {
      const [devicesRes, tunnelsRes] = await Promise.all([
        api.get('/devices?response=detailed'),
        api.get('/tunnels')
      ]);
      setDevices(devicesRes.data?.devices || devicesRes.data || []);
      setTunnels(tunnelsRes.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch network data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const nodes = useMemo(() => {
    const n = devices.length;
    return devices.map((device, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(n, 1) - Math.PI / 2;
      return {
        id: device._id,
        name: device.name || device.hostname || 'Unnamed',
        running: device.state === 'running',
        connected: device.isConnected,
        x: CENTER.x + RADIUS * Math.cos(angle),
        y: CENTER.y + RADIUS * Math.sin(angle)
      };
    });
  }, [devices]);

  const nodeById = useMemo(() => {
    const map = {};
    nodes.forEach((n) => { map[n.id] = n; });
    return map;
  }, [nodes]);

  const edges = useMemo(() => tunnels.map((tunnel) => {
    const aId = tunnel.deviceA?._id || tunnel.deviceA;
    const bId = tunnel.deviceB?._id || tunnel.deviceB;
    const a = nodeById[aId];
    const b = nodeById[bId];
    if (!a || !b) return null;
    return {
      id: tunnel._id || tunnel.num,
      a, b,
      dashed: isTunnelDashed(tunnel),
      num: tunnel.num,
      pathlabel: tunnel.pathlabel?.name
    };
  }).filter(Boolean), [tunnels, nodeById]);

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setTransform((t) => ({ ...t, scale: Math.min(3, Math.max(0.4, t.scale + delta)) }));
  };

  const handleMouseDown = (e) => {
    setDragState({ startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y });
  };
  const handleMouseMove = (e) => {
    if (!dragState) return;
    setTransform((t) => ({
      ...t,
      x: dragState.origX + (e.clientX - dragState.startX),
      y: dragState.origY + (e.clientY - dragState.startY)
    }));
  };
  const handleMouseUp = () => setDragState(null);

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Dashboards' }, { label: 'Network Connectivity' }]}
        title="Network Connectivity"
        actions={
          <div className="network-legend">
            <span><span className="legend-swatch solid" /> Connected</span>
            <span><span className="legend-swatch dashed" /> Not connected / pending</span>
          </div>
        }
      />
      {error && <div className="alert alert-danger">{error}</div>}
      <p className="text-muted small mb-2">Scroll to zoom, drag to pan. Click a device to open its details.</p>

      <div className="network-graph-card">
        {loading && <div className="network-graph-loading">Loading network...</div>}
        {!loading && nodes.length === 0 && (
          <div className="network-graph-empty">No devices yet. Add a device to see the network graph.</div>
        )}
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="network-graph-svg"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
            {edges.map((edge) => (
              <line
                key={edge.id}
                x1={edge.a.x} y1={edge.a.y} x2={edge.b.x} y2={edge.b.y}
                className={`network-edge ${edge.dashed ? 'dashed' : 'solid'} ${hoveredEdge === edge.id ? 'hovered' : ''}`}
                onMouseEnter={() => setHoveredEdge(edge.id)}
                onMouseLeave={() => setHoveredEdge(null)}
              />
            ))}
            {nodes.map((node) => (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="network-node"
                onClick={() => navigate(`/devices/${node.id}`)}
              >
                <circle r="22" className={node.connected ? 'node-connected' : 'node-disconnected'} />
                <text y="4" textAnchor="middle" className="network-node-icon">{node.running ? '●' : '○'}</text>
                <text y="40" textAnchor="middle" className="network-node-label">{node.name}</text>
              </g>
            ))}
          </g>
        </svg>
        {hoveredEdge && (() => {
          const edge = edges.find((e) => e.id === hoveredEdge);
          if (!edge) return null;
          return (
            <div className="network-edge-tooltip">
              <strong>{edge.a.name} ↔ {edge.b.name}</strong>
              {edge.pathlabel && <div>Path Label: {edge.pathlabel}</div>}
              <div>{edge.dashed ? 'Not fully connected' : 'Connected'}</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default NetworkConnectivity;
