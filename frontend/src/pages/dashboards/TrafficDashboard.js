import React, { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import api from '../../services/api';
import PageHeader from '../../components/common/PageHeader';
import './TrafficDashboard.css';

const formatTime = (unixSeconds) => {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const TrafficDashboard = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/devicestats');
      const rows = (res.data || [])
        .slice()
        .sort((a, b) => a.time - b.time)
        .map((row) => ({
          time: row.time,
          label: formatTime(row.time),
          bps: Math.round(((row.rx_bps || 0) + (row.tx_bps || 0)) / 1000) / 1000, // -> Mbps
          pps: Math.round((row.rx_pps || 0) + (row.tx_pps || 0))
        }));
      setData(rows);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch traffic statistics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Dashboards' }, { label: 'Traffic PPS/BPS' }]}
        title="Traffic PPS/BPS"
      />
      {error && <div className="alert alert-danger">{error}</div>}
      <p className="text-muted small mb-2">
        Total Bits Per Second and Packets Per Second across the organization, last 2 hours (refreshes every minute).
      </p>

      <div className="traffic-chart-card">
        {loading ? (
          <div className="traffic-chart-empty">Loading traffic statistics...</div>
        ) : data.length === 0 ? (
          <div className="traffic-chart-empty">No traffic data reported for this organization yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={data} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="bps" orientation="left" tick={{ fontSize: 12 }} label={{ value: 'Mbps', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
              <YAxis yAxisId="pps" orientation="right" tick={{ fontSize: 12 }} label={{ value: 'PPS', angle: 90, position: 'insideRight', style: { fontSize: 12 } }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="bps" type="monotone" dataKey="bps" name="Total BPS (Mbps)" stroke="var(--primary-color)" strokeWidth={2} dot={false} />
              <Line yAxisId="pps" type="monotone" dataKey="pps" name="Total PPS" stroke="var(--brand-teal)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default TrafficDashboard;
