import React, { useCallback, useEffect, useState } from 'react';
import { Button, Alert } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const QoS = () => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await api.get('/qosPolicies');
      setPolicies(res.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch QoS policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  const handleDelete = async (policy) => {
    if (!window.confirm(`Delete QoS policy "${policy.name}"?`)) return;
    try {
      await api.delete(`/qosPolicies/${policy._id}`);
      await fetchPolicies();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete policy');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'description', label: 'Description' },
    { key: 'advanced', label: 'Advanced (DSCP)', render: (row) => (row.advanced ? 'Yes' : 'No') },
    { key: 'realtime', label: 'Real-time BW %', render: (row) => row.outbound?.realtime?.bandwidthLimitPercent ?? '-' },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <Button variant="link" size="sm" onClick={() => navigate(`/qos/${row._id}`)} title="Edit">
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
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'Quality of Service' }]}
        title="Quality of Service"
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={policies}
          actions={
            <Button variant="primary" onClick={() => navigate('/qos/new')}>
              <FaPlus className="me-2" /> New QoS Policy
            </Button>
          }
          emptyMessage="No QoS policies configured yet."
        />
      )}
    </div>
  );
};

export default QoS;
