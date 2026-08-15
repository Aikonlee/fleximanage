import React, { useCallback, useEffect, useState } from 'react';
import { Button, Alert } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const FirewallPolicies = () => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await api.get('/firewallpolicies');
      setPolicies(res.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch firewall policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  const handleDelete = async (policy) => {
    if (!window.confirm(`Delete firewall policy "${policy.name}"?`)) return;
    try {
      await api.delete(`/firewallpolicies/${policy._id}`);
      await fetchPolicies();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete policy');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'description', label: 'Description' },
    { key: 'rules', label: 'Rules', render: (row) => (row.rules || []).length },
    { key: 'isDefault', label: 'Default', render: (row) => (row.isDefault ? 'Yes' : 'No') },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <Button variant="link" size="sm" onClick={() => navigate(`/firewall-policies/${row._id}`)} title="Edit">
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
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Security' }, { label: 'Firewall Policies' }]}
        title="Firewall Policies"
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={policies}
          actions={
            <Button variant="primary" onClick={() => navigate('/firewall-policies/new')}>
              <FaPlus className="me-2" /> New Firewall Policy
            </Button>
          }
          emptyMessage="No firewall policies configured yet."
        />
      )}
    </div>
  );
};

export default FirewallPolicies;
