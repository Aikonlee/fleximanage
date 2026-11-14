import PermissionButton from '../components/common/PermissionButton';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Row, Col, Alert, Modal } from 'react-bootstrap';
import { FaArrowLeft, FaCog, FaTrash, FaPlus, FaArrowUp, FaArrowDown } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './FirewallPolicyEditor.css';

const EMPTY_RULE = {
  description: '', direction: 'outbound', inbound: 'edgeAccess', internalIP: '', internalPortStart: '',
  priority: 0, enabled: true, action: 'allow',
  destinationType: 'custom',
  classification: {
    source: { ipPort: { ip: '', ports: '' } },
    destination: {
      ipProtoPort: { ip: '', ports: '', protocols: [] },
      trafficId: '',
      trafficTags: { category: '', serviceClass: '', importance: '' }
    }
  }
};

const describeDestination = (rule, appIdentifications) => {
  const dest = rule.classification?.destination || {};
  if (dest.trafficId) {
    const app = appIdentifications.find((a) => (a._id || a.id) === dest.trafficId);
    return `App: ${app ? app.name : dest.trafficId}`;
  }
  if (dest.trafficTags && (dest.trafficTags.category || dest.trafficTags.serviceClass)) {
    const { category, serviceClass, importance } = dest.trafficTags;
    return `Tags: ${[category, serviceClass, importance].filter(Boolean).join(' / ')}`;
  }
  const ip = dest.ipProtoPort?.ip;
  const ports = dest.ipProtoPort?.ports;
  return `${ip || 'Any'}${ports ? `:${ports}` : ''}`;
};

const RuleTable = ({ title, rules, appIdentifications, onAdd, onEdit, onDelete, onMove }) => {
  const sorted = rules.slice().sort((a, b) => a.priority - b.priority);
  return (
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
            {sorted.length > 0 ? sorted.map((rule, i) => (
              <tr key={rule._idx}>
                <td>{rule.description || '-'}</td>
                <td>{rule.classification?.source?.ipPort?.ip || 'Any'}</td>
                <td>{describeDestination(rule, appIdentifications)}</td>
                <td><span className={`badge ${rule.action === 'allow' ? 'badge-success' : 'badge-danger'}`}>{rule.action}</span></td>
                <td>{rule.priority}</td>
                <td>{rule.enabled ? 'Yes' : 'No'}</td>
                <td>
                  <button className="btn-icon-teal" onClick={() => onMove(rule._idx, 'up')} disabled={i === 0} title="Move up"><FaArrowUp /></button>
                  <button className="btn-icon-teal" onClick={() => onMove(rule._idx, 'down')} disabled={i === sorted.length - 1} title="Move down"><FaArrowDown /></button>
                  <button className="btn-icon-yellow" onClick={() => onEdit(rule._idx)}><FaCog /></button>
                  <button className="btn-icon-red" onClick={() => onDelete(rule._idx)}><FaTrash /></button>
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
};

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
  const [appIdentifications, setAppIdentifications] = useState([]);

  const fetchAppIdentifications = useCallback(async () => {
    try {
      const res = await api.get('/appidentifications');
      setAppIdentifications(res.data?.appIdentifications || []);
    } catch (err) {
      // Non-fatal - the Traffic Name destination type just won't have options
    }
  }, []);

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
  useEffect(() => { fetchAppIdentifications(); }, [fetchAppIdentifications]);

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
    const rule = rules[idx];
    const dest = rule.classification?.destination || {};
    const destinationType = dest.trafficId ? 'trafficId' : (dest.trafficTags?.category || dest.trafficTags?.serviceClass) ? 'trafficTags' : 'custom';
    setRuleForm({
      ...EMPTY_RULE,
      ...rule,
      destinationType,
      classification: {
        source: { ipPort: { ip: '', ports: '', ...rule.classification?.source?.ipPort } },
        destination: {
          ipProtoPort: { ip: '', ports: '', protocols: [], ...dest.ipProtoPort },
          trafficId: dest.trafficId || '',
          trafficTags: { category: '', serviceClass: '', importance: '', ...dest.trafficTags }
        }
      }
    });
    setShowRuleModal(true);
  };
  const handleSaveRule = () => {
    // Only send the classification shape matching the selected destination type
    let destination;
    if (ruleForm.destinationType === 'trafficId') destination = { trafficId: ruleForm.classification.destination.trafficId };
    else if (ruleForm.destinationType === 'trafficTags') destination = { trafficTags: ruleForm.classification.destination.trafficTags };
    else destination = { ipProtoPort: ruleForm.classification.destination.ipProtoPort };

    const cleanRule = {
      ...ruleForm,
      classification: { source: ruleForm.classification.source, destination }
    };
    delete cleanRule.destinationType;

    const next = [...rules];
    if (editingRuleIdx !== null) next[editingRuleIdx] = cleanRule;
    else next.push(cleanRule);
    setRules(next);
    setShowRuleModal(false);
  };
  const handleDeleteRule = (idx) => setRules(rules.filter((_, i) => i !== idx));

  const handleMoveRule = (idx, dir) => {
    const group = rules
      .map((r, i) => ({ ...r, _idx: i }))
      .filter((r) => r.direction === rules[idx].direction)
      .sort((a, b) => a.priority - b.priority);
    const pos = group.findIndex((r) => r._idx === idx);
    const swapPos = dir === 'up' ? pos - 1 : pos + 1;
    if (swapPos < 0 || swapPos >= group.length) return;
    const next = [...rules];
    const a = group[pos]._idx;
    const b = group[swapPos]._idx;
    const tmp = next[a].priority;
    next[a] = { ...next[a], priority: next[b].priority };
    next[b] = { ...next[b], priority: tmp };
    setRules(next);
  };

  const outboundRules = rules.map((r, i) => ({ ...r, _idx: i })).filter((r) => r.direction === 'outbound');
  const inboundRules = rules.map((r, i) => ({ ...r, _idx: i })).filter((r) => r.direction === 'inbound');

  const setClass = (section, field, value) => {
    if (section === 'source') {
      setRuleForm({ ...ruleForm, classification: { ...ruleForm.classification, source: { ipPort: { ...ruleForm.classification.source.ipPort, [field]: value } } } });
    } else {
      setRuleForm({ ...ruleForm, classification: { ...ruleForm.classification, destination: { ...ruleForm.classification.destination, ipProtoPort: { ...ruleForm.classification.destination.ipProtoPort, [field]: value } } } });
    }
  };
  const setDestTrafficTag = (field, value) => {
    setRuleForm({ ...ruleForm, classification: { ...ruleForm.classification, destination: { ...ruleForm.classification.destination, trafficTags: { ...ruleForm.classification.destination.trafficTags, [field]: value } } } });
  };
  const setDestTrafficId = (value) => {
    setRuleForm({ ...ruleForm, classification: { ...ruleForm.classification, destination: { ...ruleForm.classification.destination, trafficId: value } } });
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
            <PermissionButton permKey="firewallpolicies" method={isNew ? 'post' : 'put'} variant="primary" onClick={handleSave} disabled={saving || !name}>{saving ? 'Saving...' : 'Save Policy'}</PermissionButton>
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

      <RuleTable title="Outbound Rules" rules={outboundRules} appIdentifications={appIdentifications} onAdd={() => openAdd('outbound')} onEdit={openEdit} onDelete={handleDeleteRule} onMove={handleMoveRule} />
      <RuleTable title="Inbound Rules" rules={inboundRules} appIdentifications={appIdentifications} onAdd={() => openAdd('inbound')} onEdit={openEdit} onDelete={handleDeleteRule} onMove={handleMoveRule} />

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
            {ruleForm.direction === 'outbound' && (
              <Form.Group className="mb-3">
                <Form.Label>Destination Type</Form.Label>
                <Form.Select value={ruleForm.destinationType} onChange={(e) => setRuleForm({ ...ruleForm, destinationType: e.target.value })}>
                  <option value="custom">Custom (IP/Port) - leave blank for Any</option>
                  <option value="trafficTags">Traffic Tags</option>
                  <option value="trafficId">Traffic Name</option>
                </Form.Select>
              </Form.Group>
            )}
            {ruleForm.destinationType === 'trafficTags' && ruleForm.direction === 'outbound' ? (
              <Row>
                <Col md={4}><Form.Group className="mb-3"><Form.Label>Category</Form.Label><Form.Control value={ruleForm.classification.destination.trafficTags.category} onChange={(e) => setDestTrafficTag('category', e.target.value)} /></Form.Group></Col>
                <Col md={4}><Form.Group className="mb-3"><Form.Label>Service Class</Form.Label><Form.Control value={ruleForm.classification.destination.trafficTags.serviceClass} onChange={(e) => setDestTrafficTag('serviceClass', e.target.value)} /></Form.Group></Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Importance</Form.Label>
                    <Form.Select value={ruleForm.classification.destination.trafficTags.importance} onChange={(e) => setDestTrafficTag('importance', e.target.value)}>
                      <option value="">Any</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
            ) : ruleForm.destinationType === 'trafficId' && ruleForm.direction === 'outbound' ? (
              <Form.Group className="mb-3">
                <Form.Label>Traffic Name</Form.Label>
                <Form.Select value={ruleForm.classification.destination.trafficId} onChange={(e) => setDestTrafficId(e.target.value)}>
                  <option value="">Select application/traffic identification</option>
                  {appIdentifications.map((app) => <option key={app._id || app.id} value={app._id || app.id}>{app.name}</option>)}
                </Form.Select>
              </Form.Group>
            ) : (
              <Row>
                <Col md={4}><Form.Group className="mb-3"><Form.Label>Destination IP/Mask (blank = Any)</Form.Label><Form.Control value={ruleForm.classification.destination.ipProtoPort.ip} onChange={(e) => setClass('destination', 'ip', e.target.value)} /></Form.Group></Col>
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
            )}

            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Priority</Form.Label><Form.Control type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })} /></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3 d-flex align-items-center"><Form.Check type="switch" id="fw-rule-enabled" checked={ruleForm.enabled} onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })} label="Enabled" /></Form.Group></Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRuleModal(false)}>Cancel</Button>
          <PermissionButton permKey="firewallpolicies" method={isNew ? 'post' : 'put'} variant="primary" onClick={handleSaveRule}>Save Rule</PermissionButton>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default FirewallPolicyEditor;
