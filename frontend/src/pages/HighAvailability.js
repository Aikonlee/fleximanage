import React, { useCallback, useEffect, useState } from 'react';
import { Button, Alert, Badge } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const HighAvailability = () => {
  const [groups, setGroups] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const fetchGroups = useCallback(async () => {
    try {
      const res = await api.get('/vrrp');
      setGroups(res.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch VRRP groups');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get('/vrrp/status');
      const map = {};
      (res.data || []).forEach((g) => { map[g._id] = g; });
      setStatusMap(map);
    } catch (err) {
      // Non-fatal: live VRRP state may be unavailable until devices report it
    }
  }, []);

  useEffect(() => { fetchGroups(); fetchStatus(); }, [fetchGroups, fetchStatus]);

  const handleDelete = async (group) => {
    if (!window.confirm(`Delete VRRP group "${group.name}"?`)) return;
    try {
      await api.delete(`/vrrp/${group._id}`);
      await fetchGroups();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete group');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'virtualRouterId', label: 'VRID' },
    { key: 'virtualIp', label: 'Virtual IP' },
    { key: 'devices', label: 'Devices', render: (row) => (row.devices || []).map((d) => d.name).join(', ') || '-' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        const status = statusMap[row._id];
        if (!status || !(status.devices || []).length) return <span className="text-muted">-</span>;
        return (
          <div className="d-flex flex-wrap gap-1">
            {status.devices.map((d) => (
              <Badge
                key={d._id}
                bg={d.status?.state === 'Master' ? 'success' : d.status?.state === 'Backup' ? 'secondary' : 'warning'}
                text={d.status?.state === 'Master' || d.status?.state === 'Backup' ? undefined : 'dark'}
              >
                {d.name}: {d.status?.state || 'Unknown'}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <Button variant="link" size="sm" onClick={() => navigate(`/high-availability/${row._id}`)} title="Edit">
            <FaEdit />
          </Button>
          <Button variant="link" size="sm" className="text-danger" onClick={() => handleDelete(row)} title="Delete">
            <FaTrash />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Security' }, { label: 'High Availability' }]}
        title="High Availability"
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={groups}
          actions={
            <Button variant="primary" onClick={() => navigate('/high-availability/new')}>
              <FaPlus className="me-2" /> New VRRP Group
            </Button>
          }
          emptyMessage="No VRRP groups configured yet."
        />
      )}
    </div>
  );
};

export default HighAvailability;
