import PermissionButton from '../components/common/PermissionButton';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const PathSelectionPolicy = () => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await api.get('/mlpolicies');
      setPolicies(res.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch path selection policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  const handleDelete = async (policy) => {
    if (!window.confirm(`Delete policy "${policy.name}"?`)) return;
    try {
      await api.delete(`/mlpolicies/${policy._id}`);
      await fetchPolicies();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete policy');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'description', label: 'Description' },
    { key: 'rules', label: 'Rules', render: (row) => (row.rules || []).length },
    {
      key: 'installCount',
      label: 'Installed',
      render: (row) => row.installCount
        ? `${row.installCount.installed || 0} installed, ${row.installCount.pending || 0} pending`
        : '-',
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <PermissionButton permKey="mlpolicies" method={'put'} variant="link" size="sm" onClick={() => navigate(`/path-selection-policy/${row._id}`)} title="Edit">
            <FaEdit />
          </PermissionButton>
          <PermissionButton permKey="mlpolicies" method={'delete'} variant="link" size="sm" className="text-danger" onClick={() => handleDelete(row)} title="Delete">
            <FaTrash />
          </PermissionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'Path Selection Policy' }]}
        title="Path Selection Policy"
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={policies}
          actions={
            <PermissionButton permKey="mlpolicies" method={'post'} variant="primary" onClick={() => navigate('/path-selection-policy/new')}>
              <FaPlus className="me-2" /> New Policy
            </PermissionButton>
          }
          emptyMessage="No path selection policies configured yet."
        />
      )}
    </div>
  );
};

export default PathSelectionPolicy;
