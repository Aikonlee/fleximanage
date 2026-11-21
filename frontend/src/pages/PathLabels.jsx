import PermissionButton from '../components/common/PermissionButton';
import { clearSession } from '../auth/session';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';
import './PathLabels.css';

const EMPTY_FORM = { name: '', description: '', color: '#f7941d', type: 'Tunnel' };

const PathLabels = () => {
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const fetchLabels = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) { navigate('/login'); return; }
      const res = await api.get('/pathlabels');
      setLabels(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch path labels');
      if (err.response?.status === 401) {
        clearSession();
        navigate('/login');
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { fetchLabels(); }, [fetchLabels]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (label) => {
    setEditingId(label._id);
    setForm({
      name: label.name || '',
      description: label.description || '',
      color: label.color || '#f7941d',
      type: label.type || 'Tunnel',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/pathlabels/${editingId}`, form);
      } else {
        await api.post('/pathlabels', form);
      }
      setShowModal(false);
      await fetchLabels();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save path label');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (label) => {
    if (!window.confirm(`Delete path label "${label.name}"?`)) return;
    try {
      await api.delete(`/pathlabels/${label._id}`);
      await fetchLabels();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete path label');
    }
  };

  const columns = [
    {
      key: 'color',
      label: '',
      render: (row) => (
        <span
          className="path-label-swatch"
          style={{ background: row.color || '#ccc' }}
          title={row.color}
        />
      ),
    },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'description', label: 'Description' },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      render: (row) => (
        <span className={`badge ${row.type === 'DIA' ? 'badge-warning' : 'badge-info'}`}>
          {row.type === 'DIA' ? 'Direct Internet Access' : 'Tunnel'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <PermissionButton permKey="pathlabels" method={'put'} variant="link" size="sm" onClick={() => openEdit(row)} title="Edit">
            <FaEdit />
          </PermissionButton>
          <PermissionButton permKey="pathlabels" method={'delete'} variant="link" size="sm" className="text-danger" onClick={() => handleDelete(row)} title="Delete">
            <FaTrash />
          </PermissionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'Path Labels' }]}
        title="Path Labels"
      />

      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={labels}
          actions={
            <PermissionButton permKey="pathlabels" method={'post'} variant="primary" onClick={openCreate}>
              <FaPlus className="me-2" /> New Path Label
            </PermissionButton>
          }
          emptyMessage="No path labels configured yet."
        />
      )}

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{editingId ? 'Edit Path Label' : 'New Path Label'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Name</Form.Label>
              <Form.Control
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Color</Form.Label>
              <Form.Control
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                title="Choose color"
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                id="path-label-dia-switch"
                label="Direct Internet Access (reserve for internet breakout, not tunnels)"
                checked={form.type === 'DIA'}
                onChange={(e) => setForm({ ...form, type: e.target.checked ? 'DIA' : 'Tunnel' })}
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <PermissionButton permKey="pathlabels" method={editingId ? 'put' : 'post'} variant="primary" onClick={handleSave} disabled={saving || !form.name}>
            {saving ? 'Saving...' : 'Save'}
          </PermissionButton>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default PathLabels;
