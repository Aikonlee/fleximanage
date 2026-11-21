import PermissionButton from '../components/common/PermissionButton';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const IpsecPeering = () => {
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const fetchPeers = useCallback(async () => {
    try {
      const res = await api.get('/peers');
      setPeers(res.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch IPsec peers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPeers(); }, [fetchPeers]);

  const handleDelete = async (peer) => {
    if (!window.confirm(`Delete peer "${peer.name}"? Connected tunnels must be removed first.`)) return;
    try {
      await api.delete(`/peers/${peer._id}`);
      await fetchPeers();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete peer');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'remoteIP', label: 'Remote IP' },
    { key: 'idType', label: 'ID Type' },
    { key: 'ips', label: 'Monitor IPs', render: (row) => (row.ips || []).join(', ') || '-' },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <PermissionButton permKey="peers" method={'put'} variant="link" size="sm" onClick={() => navigate(`/ipsec-peering/${row._id}`)} title="Edit">
            <FaEdit />
          </PermissionButton>
          <PermissionButton permKey="peers" method={'delete'} variant="link" size="sm" className="text-danger" onClick={() => handleDelete(row)} title="Delete">
            <FaTrash />
          </PermissionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'IPsec Peering' }]}
        title="IPsec Peering"
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={peers}
          actions={
            <PermissionButton permKey="peers" method={'post'} variant="primary" onClick={() => navigate('/ipsec-peering/new')}>
              <FaPlus className="me-2" /> New Peer
            </PermissionButton>
          }
          emptyMessage="No IPsec peers configured yet. Peer connections appear in the Tunnels inventory once created."
        />
      )}
    </div>
  );
};

export default IpsecPeering;
