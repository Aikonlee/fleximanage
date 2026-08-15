import React, { useCallback, useEffect, useState } from 'react';
import { Button, Alert } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const HighAvailability = () => {
  const [groups, setGroups] = useState([]);
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

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

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
