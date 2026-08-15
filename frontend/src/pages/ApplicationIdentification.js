import React, { useCallback, useEffect, useState } from 'react';
import { Button, Alert, Modal, Form, Row, Col } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash, FaUndo } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import '../styles/unified-table.css';

const EMPTY_CUSTOM = {
  name: '', description: '', category: '', serviceClass: '', importance: 'medium',
  rules: [{ ip: '', ports: '', protocol: '' }]
};
const EMPTY_OVERRIDE = { category: '', serviceClass: '', importance: 'medium' };

const isCustom = (item) => Array.isArray(item.rules);

const ApplicationIdentification = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showCustomModal, setShowCustomModal] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState(null);
  const [customForm, setCustomForm] = useState(EMPTY_CUSTOM);

  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [editingImportedId, setEditingImportedId] = useState(null);
  const [overrideForm, setOverrideForm] = useState(EMPTY_OVERRIDE);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get('/appidentifications');
      setItems(res.data?.appIdentifications || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch application identifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openNewCustom = () => {
    setEditingCustomId(null);
    setCustomForm(EMPTY_CUSTOM);
    setShowCustomModal(true);
  };
  const openEditCustom = (item) => {
    setEditingCustomId(item._id || item.id);
    setCustomForm({
      name: item.name || '', description: item.description || '',
      category: item.category || '', serviceClass: item.serviceClass || '', importance: item.importance || 'medium',
      rules: item.rules?.length ? item.rules : [{ ip: '', ports: '', protocol: '' }]
    });
    setShowCustomModal(true);
  };
  const handleSaveCustom = async () => {
    try {
      const payload = { ...customForm, rules: customForm.rules.filter((r) => r.ip || r.ports) };
      if (editingCustomId) await api.put(`/appidentifications/custom/${editingCustomId}`, payload);
      else await api.post('/appidentifications', payload);
      setShowCustomModal(false);
      await fetchAll();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save application identification');
    }
  };
  const handleDeleteCustom = async (item) => {
    if (!window.confirm(`Delete custom identification "${item.name}"?`)) return;
    try {
      await api.delete(`/appidentifications/${item._id || item.id}`);
      await fetchAll();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete');
    }
  };
  const addRule = () => setCustomForm({ ...customForm, rules: [...customForm.rules, { ip: '', ports: '', protocol: '' }] });
  const updateRule = (idx, field, value) => {
    const rules = [...customForm.rules];
    rules[idx] = { ...rules[idx], [field]: value };
    setCustomForm({ ...customForm, rules });
  };
  const removeRule = (idx) => setCustomForm({ ...customForm, rules: customForm.rules.filter((_, i) => i !== idx) });

  const openOverride = (item) => {
    setEditingImportedId(item.id);
    setOverrideForm({ category: item.category || '', serviceClass: item.serviceClass || '', importance: item.importance || 'medium' });
    setShowOverrideModal(true);
  };
  const handleSaveOverride = async () => {
    try {
      await api.put(`/appidentifications/imported/${editingImportedId}`, overrideForm);
      setShowOverrideModal(false);
      await fetchAll();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save override');
    }
  };
  const handleResetImported = async (item) => {
    if (!window.confirm(`Reset "${item.name}" to its original classification?`)) return;
    try {
      await api.put(`/appidentifications/imported/${item.id}/reset`);
      await fetchAll();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reset');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'category', label: 'Category' },
    { key: 'serviceClass', label: 'Service Class' },
    { key: 'importance', label: 'Importance' },
    { key: 'type', label: 'Type', render: (row) => (isCustom(row) ? 'Custom' : row.modified ? 'Imported (modified)' : 'Imported') },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => isCustom(row) ? (
        <div className="action-buttons">
          <Button variant="link" size="sm" onClick={() => openEditCustom(row)} title="Edit"><FaEdit /></Button>
          <Button variant="link" size="sm" className="text-danger" onClick={() => handleDeleteCustom(row)} title="Delete"><FaTrash /></Button>
        </div>
      ) : (
        <div className="action-buttons">
          <Button variant="link" size="sm" onClick={() => openOverride(row)} title="Edit classification"><FaEdit /></Button>
          {row.modified && <Button variant="link" size="sm" onClick={() => handleResetImported(row)} title="Reset to original"><FaUndo /></Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'Application Identification' }]}
        title="Traffic & Application Identification"
      />
      <p className="text-muted small mb-2">
        Identifications referenced by name/tag in Firewall, QoS, and Path Selection Policy rules.
        "Imported" entries come from flexiWAN's shared traffic-identification database; classification can be overridden per organization.
      </p>
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(row) => row._id || row.id}
          actions={<Button variant="primary" onClick={openNewCustom}><FaPlus className="me-2" /> New Custom Identification</Button>}
          emptyMessage="No application identifications found."
          defaultPageSize={25}
        />
      )}

      <Modal show={showCustomModal} onHide={() => setShowCustomModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingCustomId ? 'Edit Custom Identification' : 'New Custom Identification'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Name</Form.Label><Form.Control value={customForm.name} onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })} /></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control value={customForm.description} onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })} /></Form.Group></Col>
            </Row>
            <Row>
              <Col md={4}><Form.Group className="mb-3"><Form.Label>Category</Form.Label><Form.Control value={customForm.category} onChange={(e) => setCustomForm({ ...customForm, category: e.target.value })} /></Form.Group></Col>
              <Col md={4}><Form.Group className="mb-3"><Form.Label>Service Class</Form.Label><Form.Control value={customForm.serviceClass} onChange={(e) => setCustomForm({ ...customForm, serviceClass: e.target.value })} /></Form.Group></Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Importance</Form.Label>
                  <Form.Select value={customForm.importance} onChange={(e) => setCustomForm({ ...customForm, importance: e.target.value })}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <div className="d-flex justify-content-between align-items-center mb-2">
              <Form.Label className="mb-0">Rules (matched by IP and/or Port)</Form.Label>
              <Button size="sm" variant="outline-primary" onClick={addRule}>Add Rule</Button>
            </div>
            {customForm.rules.map((rule, idx) => (
              <Row key={idx} className="align-items-center mb-2">
                <Col md={5}><Form.Control placeholder="IP/Mask" value={rule.ip} onChange={(e) => updateRule(idx, 'ip', e.target.value)} /></Col>
                <Col md={3}><Form.Control placeholder="Ports" value={rule.ports} onChange={(e) => updateRule(idx, 'ports', e.target.value)} /></Col>
                <Col md={3}>
                  <Form.Select value={rule.protocol} onChange={(e) => updateRule(idx, 'protocol', e.target.value)}>
                    <option value="">Any</option>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </Form.Select>
                </Col>
                <Col md={1}><button className="btn-icon-red" onClick={() => removeRule(idx)}><FaTrash /></button></Col>
              </Row>
            ))}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowCustomModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSaveCustom} disabled={!customForm.name}>Save</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showOverrideModal} onHide={() => setShowOverrideModal(false)} centered>
        <Modal.Header closeButton><Modal.Title>Edit Classification</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>Category</Form.Label><Form.Control value={overrideForm.category} onChange={(e) => setOverrideForm({ ...overrideForm, category: e.target.value })} /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>Service Class</Form.Label><Form.Control value={overrideForm.serviceClass} onChange={(e) => setOverrideForm({ ...overrideForm, serviceClass: e.target.value })} /></Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Importance</Form.Label>
              <Form.Select value={overrideForm.importance} onChange={(e) => setOverrideForm({ ...overrideForm, importance: e.target.value })}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowOverrideModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSaveOverride}>Save</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default ApplicationIdentification;
