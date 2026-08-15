import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Row, Col, Alert, Modal } from 'react-bootstrap';
import { FaArrowLeft, FaCog, FaTrash, FaPlus } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './FirewallPolicyEditor.css';

const EMPTY_RULE = {
  description: '', direction: 'outbound', inbound: 'edgeAccess', internalIP: '', internalPortStart: '',
  priority: 0, enabled: true, action: 'allow',
  classification: {
    source: { ipPort: { ip: '', ports: '' } },
    destination: { ipProtoPort: { ip: '', ports: '', protocols: [] } }
  }
};

const RuleTable = ({ title, rules, onAdd, onEdit, onDelete }) => (
  <>
    <div className="d-flex justify-content-between align-items-center mb-2">
      <h6 className="fw-bold mb-0">{title}</h6>
      <Button variant="primary" size="sm" onClick={onAdd}><FaPlus className="me-1" /> Add Rule</Button>
    </div>
    <div className="table-container-template mb-4">
      <table className="custom-table-template">
        <thead>
          <tr><th>Description</th><th>Source</th><th>Destination</th><th>Action</th><th>Priority</th><th>Enabled</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rules.length > 0 ? rules.map((rule, idx) => (
            <tr key={idx}>
              <td>{rule.description || '-'}</td>
              <td>{rule.classification?.source?.ipPort?.ip || 'Any'}</td>
              <td>{rule.classification?.destination?.ipProtoPort?.ip || 'Any'}{rule.classification?.destination?.ipProtoPort?.ports ? `:${rule.classification.destination.ipProtoPort.ports}` : ''}</td>
              <td><span className={`badge ${rule.action === 'allow' ? 'badge-success' : 'badge-danger'}`}>{rule.action}</span></td>
              <td>{rule.priority}</td>
              <td>{rule.enabled ? 'Yes' : 'No'}</td>
              <td>
                <button className="btn-icon-yellow" onClick={() => onEdit(idx)}><FaCog /></button>
                <button className="btn-icon-red" onClick={() => onDelete(idx)}><FaTrash /></button>
              </td>
            </tr>
          )) : (
            <tr><td colSpan="7" className="text-center text-muted py-4">No rules yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </>
);

const FirewallPolicyEditor = () => {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRuleIdx, setEditingRuleIdx] = useState(null);
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE);

  const fetchPolicy = useCallback(async () => {
    if (isNew) return;
    try {
      const res = await api.get(`/firewallpolicies/${id}`);
      setName(res.data.name || '');
      setDescription(res.data.description || '');
      setIsDefault(Boolean(res.data.isDefault));
      setRules(res.data.rules || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch policy');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { fetchPolicy(); }, [fetchPolicy]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { name, description, isDefault, rules };
      if (isNew) await api.post('/firewallpolicies', payload);
      else await api.put(`/firewallpolicies/${id}`, payload);
      navigate('/firewall-policies');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const openAdd = (direction) => {
    setEditingRuleIdx(null);
    setRuleForm({ ...EMPTY_RULE, direction, priority: rules.length });
    setShowRuleModal(true);
  };
  const openEdit = (idx) => {
    setEditingRuleIdx(idx);
    setRuleForm(rules[idx]);
    setShowRuleModal(true);
  };
  const handleSaveRule = () => {
    const next = [...rules];
    if (editingRuleIdx !== null) next[editingRuleIdx] = ruleForm;
    else next.push(ruleForm);
    setRules(next);
    setShowRuleModal(false);
  };
  const handleDeleteRule = (idx) => setRules(rules.filter((_, i) => i !== idx));

  const outboundRules = rules.map((r, i) => ({ ...r, _idx: i })).filter((r) => r.direction === 'outbound');
  const inboundRules = rules.map((r, i) => ({ ...r, _idx: i })).filter((r) => r.direction === 'inbound');

  const setClass = (section, field, value) => {
    if (section === 'source') {
      setRuleForm({ ...ruleForm, classification: { ...ruleForm.classification, source: { ipPort: { ...ruleForm.classification.source.ipPort, [field]: value } } } });
    } else {
      setRuleForm({ ...ruleForm, classification: { ...ruleForm.classification, destination: { ipProtoPort: { ...ruleForm.classification.destination.ipProtoPort, [field]: value } } } });
    }
  };

  if (loading) return <div className="page-container"><p className="text-muted">Loading...</p></div>;

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Security' }, { label: 'Firewall Policies', path: '/firewall-policies' }, { label: isNew ? 'add' : 'edit' }]}
        title="Firewall Policy"
        actions={
          <>
            <button className="btn-icon-action" onClick={() => navigate('/firewall-policies')} title="Back"><FaArrowLeft /></button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !name}>{saving ? 'Saving...' : 'Save Policy'}</Button>
          </>
        }
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}

      <div className="fw-policy-header-card">
        <Row>
          <Col md={5}><Form.Group><Form.Label>Policy Name *</Form.Label><Form.Control value={name} onChange={(e) => setName(e.target.value)} /></Form.Group></Col>
          <Col md={5}><Form.Group><Form.Label>Description</Form.Label><Form.Control value={description} onChange={(e) => setDescription(e.target.value)} /></Form.Group></Col>
          <Col md={2} className="d-flex align-items-end">
            <Form.Check type="switch" id="fw-policy-default" label="Set as default" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          </Col>
        </Row>
      </div>

      <RuleTable title="Outbound Rules" rules={outboundRules} onAdd={() => openAdd('outbound')} onEdit={(i) => openEdit(outboundRules[i]._idx)} onDelete={(i) => handleDeleteRule(outboundRules[i]._idx)} />
      <RuleTable title="Inbound Rules" rules={inboundRules} onAdd={() => openAdd('inbound')} onEdit={(i) => openEdit(inboundRules[i]._idx)} onDelete={(i) => handleDeleteRule(inboundRules[i]._idx)} />

      <Modal show={showRuleModal} onHide={() => setShowRuleModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingRuleIdx !== null ? 'Edit Rule' : `New ${ruleForm.direction === 'inbound' ? 'Inbound' : 'Outbound'} Rule`}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control value={ruleForm.description} onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })} /></Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Action</Form.Label>
                  <Form.Select value={ruleForm.action} onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}>
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              {ruleForm.direction === 'inbound' && (
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Inbound Type</Form.Label>
                    <Form.Select value={ruleForm.inbound} onChange={(e) => setRuleForm({ ...ruleForm, inbound: e.target.value })}>
                      <option value="edgeAccess">flexiEdge access</option>
                      <option value="portForward">Port Forward</option>
                      <option value="nat1to1">1:1 NAT</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              )}
            </Row>
            {ruleForm.direction === 'inbound' && ruleForm.inbound !== 'edgeAccess' && (
              <Row>
                <Col md={6}><Form.Group className="mb-3"><Form.Label>Internal IP</Form.Label><Form.Control value={ruleForm.internalIP} onChange={(e) => setRuleForm({ ...ruleForm, internalIP: e.target.value })} /></Form.Group></Col>
                <Col md={6}><Form.Group className="mb-3"><Form.Label>Internal Port</Form.Label><Form.Control value={ruleForm.internalPortStart} onChange={(e) => setRuleForm({ ...ruleForm, internalPortStart: e.target.value })} /></Form.Group></Col>
              </Row>
            )}

            <h6 className="fw-bold mt-3">Source</h6>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Source IP/Mask (blank = Any)</Form.Label><Form.Control value={ruleForm.classification.source.ipPort.ip} onChange={(e) => setClass('source', 'ip', e.target.value)} /></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Source Ports</Form.Label><Form.Control value={ruleForm.classification.source.ipPort.ports} onChange={(e) => setClass('source', 'ports', e.target.value)} /></Form.Group></Col>
            </Row>
            <h6 className="fw-bold">Destination</h6>
            <Row>
              <Col md={4}><Form.Group className="mb-3"><Form.Label>Destination IP/Mask</Form.Label><Form.Control value={ruleForm.classification.destination.ipProtoPort.ip} onChange={(e) => setClass('destination', 'ip', e.target.value)} /></Form.Group></Col>
              <Col md={4}><Form.Group className="mb-3"><Form.Label>Destination Ports</Form.Label><Form.Control value={ruleForm.classification.destination.ipProtoPort.ports} onChange={(e) => setClass('destination', 'ports', e.target.value)} /></Form.Group></Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Protocol</Form.Label>
                  <Form.Select value={ruleForm.classification.destination.ipProtoPort.protocols?.[0] || ''} onChange={(e) => setClass('destination', 'protocols', e.target.value ? [e.target.value] : [])}>
                    <option value="">Any</option>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="icmp">ICMP</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Priority</Form.Label><Form.Control type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })} /></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3 d-flex align-items-center"><Form.Check type="switch" id="fw-rule-enabled" checked={ruleForm.enabled} onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })} label="Enabled" /></Form.Group></Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRuleModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSaveRule}>Save Rule</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default FirewallPolicyEditor;
