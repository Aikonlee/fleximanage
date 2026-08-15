import React, { useCallback, useEffect, useState } from 'react';
import { Button, ButtonGroup } from 'react-bootstrap';
import { FaCheck, FaCheckDouble, FaTrash, FaTrashAlt } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const SEVERITY_VARIANT = { critical: 'danger', warning: 'warning', info: 'info' };

const formatTime = (isoTime) => {
  if (!isoTime) return '-';
  const d = new Date(isoTime);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
};

const Notifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusTab, setStatusTab] = useState('active'); // active | resolved | all

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const filters = statusTab === 'all' ? undefined
        : [{ key: 'resolved', op: '==', val: statusTab === 'resolved' }];
      const res = await api.get('/notifications', {
        params: {
          limit: 200,
          sortField: 'time',
          sortOrder: 'desc',
          ...(filters && { filters: JSON.stringify(filters) })
        }
      });
      setNotifications(res.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  }, [statusTab]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const toggleRead = async (n) => {
    const nextStatus = n.status === 'read' ? 'unread' : 'read';
    setNotifications((list) => list.map((x) => (x._id === n._id ? { ...x, status: nextStatus } : x)));
    try {
      await api.put(`/notifications/${n._id}`, { status: nextStatus });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update notification');
      fetchNotifications();
    }
  };

  const resolveOne = async (n) => {
    setNotifications((list) => list.map((x) => (x._id === n._id ? { ...x, resolved: true } : x)));
    try {
      await api.put(`/notifications/${n._id}`, { resolve: true });
      if (statusTab === 'active') await fetchNotifications();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to resolve notification');
      fetchNotifications();
    }
  };

  const deleteOne = async (n) => {
    if (!window.confirm(`Delete this notification: "${n.title}"?`)) return;
    try {
      await api.delete('/notifications', { data: { filters: [{ key: '_id', op: '==', val: n._id }] } });
      await fetchNotifications();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete notification');
    }
  };

  const markAllRead = async () => {
    try {
      await api.put('/notifications', { status: 'read' });
      await fetchNotifications();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to mark all as read');
    }
  };

  const deleteAll = async () => {
    if (!window.confirm('Delete ALL notifications currently shown? This cannot be undone.')) return;
    try {
      const filters = statusTab === 'all' ? [] : [{ key: 'resolved', op: '==', val: statusTab === 'resolved' }];
      await api.delete('/notifications', { data: { filters } });
      await fetchNotifications();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete notifications');
    }
  };

  const columns = [
    {
      key: 'time', label: 'Time', sortable: true, sortValue: (row) => new Date(row.time).getTime(),
      render: (row) => formatTime(row.time)
    },
    {
      key: 'title', label: 'Notification',
      render: (row) => (
        <div>
          <div className={row.status === 'unread' ? 'fw-bold' : ''}>{row.title}</div>
          {row.details && <div className="text-muted small">{row.details}</div>}
        </div>
      )
    },
    {
      key: 'target', label: 'Target',
      render: (row) => row.targets?.deviceId?.name
        || (row.targets?.interfaceId?.name ? `Interface: ${row.targets.interfaceId.name}` : '-')
    },
    {
      key: 'severity', label: 'Severity',
      render: (row) => row.severity
        ? <span className={`badge bg-${SEVERITY_VARIANT[row.severity] || 'secondary'}`}>{row.severity}</span>
        : '-'
    },
    {
      key: 'status', label: 'Status',
      render: (row) => (
        <>
          <span className={`badge ${row.status === 'unread' ? 'bg-primary' : 'bg-secondary'} me-1`}>
            {row.status === 'unread' ? 'Unread' : 'Read'}
          </span>
          {row.resolved && <span className="badge bg-success">Resolved</span>}
        </>
      )
    },
    {
      key: 'actions', label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <Button
            variant="link" size="sm" onClick={() => toggleRead(row)}
            title={row.status === 'unread' ? 'Mark as read' : 'Mark as unread'}
          >
            <FaCheck />
          </Button>
          {!row.resolved && (
            <Button variant="link" size="sm" onClick={() => resolveOne(row)} title="Resolve">
              <FaCheckDouble />
            </Button>
          )}
          <Button variant="link" size="sm" className="text-danger" onClick={() => deleteOne(row)} title="Delete">
            <FaTrash />
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Troubleshoot' }, { label: 'Notifications' }]}
        title="Notifications"
        actions={(
          <div className="d-flex gap-2">
            <Button variant="outline-primary" onClick={markAllRead}>
              <FaCheckDouble className="me-2" />Mark all as read
            </Button>
            <Button variant="outline-danger" onClick={deleteAll}>
              <FaTrashAlt className="me-2" />Delete all
            </Button>
          </div>
        )}
      />

      <ButtonGroup className="mb-3">
        <Button variant={statusTab === 'active' ? 'primary' : 'outline-primary'} onClick={() => setStatusTab('active')}>Active</Button>
        <Button variant={statusTab === 'resolved' ? 'primary' : 'outline-primary'} onClick={() => setStatusTab('resolved')}>Resolved</Button>
        <Button variant={statusTab === 'all' ? 'primary' : 'outline-primary'} onClick={() => setStatusTab('all')}>All</Button>
      </ButtonGroup>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={notifications}
          emptyMessage="No notifications."
          filterPlaceholder="Filter notifications"
        />
      )}
    </div>
  );
};

export default Notifications;
