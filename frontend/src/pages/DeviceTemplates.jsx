import PermissionButton from '../components/common/PermissionButton';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash, FaEye } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const EMPTY_FORM = { name: '', description: '', configText: '{}' };
const UNSAFE_KEY_PATTERN = /(?:__proto__|constructor|prototype)/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findUnsafeKey(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const bad = findUnsafeKey(item);
      if (bad) return bad;
    }
    return null;
  }
  if (!isPlainObject(value)) return null;
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || UNSAFE_KEY_PATTERN.test(key)) {
      return key;
    }
    const nested = findUnsafeKey(value[key]);
    if (nested) return nested;
  }
  return null;
}

function validateTemplateForm({ name, configText, requireName }) {
  if (requireName && !name.trim()) {
    return { error: 'Template name is required.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(configText);
  } catch (_err) {
    return { error: 'Config must be valid JSON.' };
  }
  if (!isPlainObject(parsed)) {
    return { error: 'Config must be a plain JSON object.' };
  }
  const unsafeKey = findUnsafeKey(parsed);
  if (unsafeKey) {
    return { error: `Config contains an unsafe key: "${unsafeKey}".` };
  }
  return { config: parsed };
}

const DeviceTemplates = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [viewingTemplate, setViewingTemplate] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const latestFetchIdRef = useRef(0);

  const fetchTemplates = useCallback(async () => {
    const requestId = ++latestFetchIdRef.current;
    try {
      const res = await api.get('/devicetemplates');
      if (requestId !== latestFetchIdRef.current) return;
      setTemplates(res.data || []);
      setError(null);
    } catch (err) {
      if (requestId !== latestFetchIdRef.current) return;
      setError(err.response?.data?.error || err.message || 'Failed to fetch device templates');
    } finally {
      if (requestId === latestFetchIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const openCreate = () => {
    setEditingTemplate(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowModal(true);
  };

  const openNewVersion = (template) => {
    setEditingTemplate(template);
    setForm({
      name: template.name || '',
      description: template.description || '',
      configText: JSON.stringify(template.config ?? {}, null, 2),
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    const validation = validateTemplateForm({
      name: form.name,
      configText: form.configText,
      requireName: !editingTemplate,
    });
    if (validation.error) {
      setFormError(validation.error);
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      if (editingTemplate) {
        await api.put(`/devicetemplates/${editingTemplate._id}`, {
          config: validation.config,
          description: form.description,
        });
      } else {
        await api.post('/devicetemplates', {
          name: form.name.trim(),
          description: form.description,
          config: validation.config,
        });
      }
      setShowModal(false);
      await fetchTemplates();
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to save device template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template) => {
    if (!window.confirm(`Delete device template "${template.name}"?`)) return;
    try {
      await api.delete(`/devicetemplates/${template._id}`);
      await fetchTemplates();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete device template');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'description', label: 'Description', render: (row) => row.description || '-' },
    { key: 'version', label: 'Version', render: (row) => (row.version != null ? `v${row.version}` : '-') },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div className="action-buttons">
          <Button
            variant="link"
            size="sm"
            onClick={() => setViewingTemplate(row)}
            title="View Config"
            aria-label={`View config for ${row.name}`}
          >
            <FaEye />
          </Button>
          <PermissionButton
            permKey="devicetemplates"
            method={'put'}
            variant="link"
            size="sm"
            onClick={() => openNewVersion(row)}
            title="New Version"
            aria-label={`New version of ${row.name}`}
          >
            <FaEdit />
          </PermissionButton>
          <PermissionButton
            permKey="devicetemplates"
            method={'delete'}
            variant="link"
            size="sm"
            className="text-danger"
            onClick={() => handleDelete(row)}
            title="Delete"
            aria-label={`Delete ${row.name}`}
          >
            <FaTrash />
          </PermissionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'Device Templates' }]}
        title="Device Templates"
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={templates}
          actions={
            <PermissionButton permKey="devicetemplates" method={'post'} variant="primary" onClick={openCreate}>
              <FaPlus className="me-2" /> Create Template
            </PermissionButton>
          }
          emptyMessage="No device templates configured yet."
        />
      )}

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {editingTemplate ? `New Version — ${editingTemplate.name}` : 'Create Template'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError && (
            <Alert variant="danger" onClose={() => setFormError(null)} dismissible>
              {formError}
            </Alert>
          )}
          <Form>
            <Form.Group className="mb-3" controlId="device-template-name">
              <Form.Label>Name</Form.Label>
              <Form.Control
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={Boolean(editingTemplate)}
                placeholder="Branch WAN Default"
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="device-template-description">
              <Form.Label>Description</Form.Label>
              <Form.Control
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="device-template-config">
              <Form.Label>Config (JSON)</Form.Label>
              <Form.Control
                as="textarea"
                rows={8}
                value={form.configText}
                onChange={(e) => setForm({ ...form, configText: e.target.value })}
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <PermissionButton
            permKey="devicetemplates"
            method={editingTemplate ? 'put' : 'post'}
            variant="primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : (editingTemplate ? 'Create Version' : 'Save')}
          </PermissionButton>
        </Modal.Footer>
      </Modal>

      <Modal show={Boolean(viewingTemplate)} onHide={() => setViewingTemplate(null)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {viewingTemplate ? `${viewingTemplate.name} (v${viewingTemplate.version ?? 1})` : 'Template Config'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {viewingTemplate?.description && (
            <p className="text-muted mb-3">{viewingTemplate.description}</p>
          )}
          <pre
            className="bg-light p-3 rounded mb-0"
            style={{ maxHeight: '60vh', overflow: 'auto' }}
            data-testid="template-config-viewer"
          >
            {viewingTemplate ? JSON.stringify(viewingTemplate.config ?? {}, null, 2) : ''}
          </pre>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setViewingTemplate(null)}>Close</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default DeviceTemplates;
