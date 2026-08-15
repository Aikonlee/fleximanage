import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const EMPTY_FORM = { name: '', type: 'icmp', servers: '', urls: '', timeout: 2000, threshold: 60, attempts: 3 };

const LinkMonitors = () => {
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchMonitors = useCallback(async () => {
    try {
      const res = await api.get('/linkmonitors');
      setMonitors(res.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch link monitors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMonitors(); }, [fetchMonitors]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };
  const openEdit = (monitor) => {
    setEditingId(monitor._id);
    setForm({
      name: monitor.name || '',
      type: monitor.type || 'icmp',
      servers: (monitor.servers || []).join(', '),
      urls: (monitor.urls || []).join(', '),
      timeout: monitor.timeout ?? 2000,
      threshold: monitor.threshold ?? 60,
      attempts: monitor.attempts ?? 3,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        type: form.type,
        servers: form.servers.split(',').map((s) => s.trim()).filter(Boolean),
        urls: form.urls.split(',').map((s) => s.trim()).filter(Boolean),
        timeout: Number(form.timeout),
        threshold: Number(form.threshold),
        attempts: Number(form.attempts),
      };
      if (editingId) await api.put(`/linkmonitors/${editingId}`, payload);
      else await api.post('/linkmonitors', payload);
      setShowModal(false);
      await fetchMonitors();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save link monitor');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (monitor) => {
    if (!window.confirm(`Delete link monitor "${monitor.name}"?`)) return;
    try {
      await api.delete(`/linkmonitors/${monitor._id}`);
      await fetchMonitors();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete link monitor');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'type', label: 'Type', render: (row) => row.type.toUpperCase() },
    { key: 'targets', label: 'Targets', render: (row) => (row.type === 'icmp' ? (row.servers || []).join(', ') : (row.urls || []).join(', ')) || '-' },
    { key: 'threshold', label: 'Threshold %' },
    { key: 'timeout', label: 'Timeout (ms)' },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <Button variant="link" size="sm" onClick={() => openEdit(row)} title="Edit"><FaEdit /></Button>
          <Button variant="link" size="sm" className="text-danger" onClick={() => handleDelete(row)} title="Delete"><FaTrash /></Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'Link Monitors' }]}
        title="Link Monitors"
      />
      <p className="text-muted small mb-2">
        Management-side definition only — referenced by name from a WAN interface's "Monitor Internet" setting.
        Actual probing runs on the flexiEdge device agent, which is a separate repo not present in this codebase,
        so this will take effect once a corresponding flexiEdge release implements the job handler.
      </p>
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={monitors}
          actions={<Button variant="primary" onClick={openCreate}><FaPlus className="me-2" /> New Link Monitor</Button>}
          emptyMessage="No link monitors configured yet."
        />
      )}

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton><Modal.Title>{editingId ? 'Edit Link Monitor' : 'New Link Monitor'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>Name</Form.Label><Form.Control value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Type</Form.Label>
              <Form.Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="icmp">ICMP</option>
                <option value="http">HTTP</option>
              </Form.Select>
            </Form.Group>
            {form.type === 'icmp' ? (
              <Form.Group className="mb-3"><Form.Label>Server IPs (comma separated)</Form.Label><Form.Control value={form.servers} onChange={(e) => setForm({ ...form, servers: e.target.value })} placeholder="8.8.8.8, 1.1.1.1" /></Form.Group>
            ) : (
              <Form.Group className="mb-3"><Form.Label>URLs (comma separated)</Form.Label><Form.Control value={form.urls} onChange={(e) => setForm({ ...form, urls: e.target.value })} placeholder="https://example.com" /></Form.Group>
            )}
            <Form.Group className="mb-3"><Form.Label>Timeout (ms)</Form.Label><Form.Control type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: e.target.value })} /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>Threshold (acceptable success rate %)</Form.Label><Form.Control type="number" min={0} max={100} value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>Attempts</Form.Label><Form.Control type="number" min={1} value={form.attempts} onChange={(e) => setForm({ ...form, attempts: e.target.value })} /></Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !form.name}>{saving ? 'Saving...' : 'Save'}</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default LinkMonitors;
