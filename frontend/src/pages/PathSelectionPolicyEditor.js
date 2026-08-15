import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Row, Col, Alert, Modal } from 'react-bootstrap';
import { FaArrowLeft, FaCog, FaTrash, FaArrowUp, FaArrowDown } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './PathSelectionPolicyEditor.css';

const EMPTY_RULE = {
  name: '',
  priority: 0,
  enabled: true,
  classificationType: 'prefix', // prefix | application | category
  prefix: { ip: '', ports: '', protocol: '' },
  application: { appId: '' },
  category: { category: '', serviceClass: '', importance: '' },
  action: {
    order: 'priority',
    fallback: 'drop',
    links: [{ pathlabels: [], order: 'priority' }]
  }
};

const toRuleForm = (rule) => {
  const classification = rule.classification || {};
  const type = classification.prefix ? 'prefix' : classification.application?.appId ? 'application' : 'category';
  return {
    ...EMPTY_RULE,
    name: rule.name || '',
    priority: rule.priority ?? 0,
    enabled: rule.enabled !== false,
    classificationType: type,
    prefix: classification.prefix || EMPTY_RULE.prefix,
    application: type === 'application' ? classification.application : EMPTY_RULE.application,
    category: type === 'category' ? classification.application : EMPTY_RULE.category,
    action: rule.action || EMPTY_RULE.action,
    _id: rule._id
  };
};

const toRuleRequest = (form) => {
  let classification;
  if (form.classificationType === 'prefix') classification = { prefix: form.prefix };
  else if (form.classificationType === 'application') classification = { application: form.application };
  else classification = { application: form.category };
  return {
    name: form.name,
    priority: Number(form.priority) || 0,
    enabled: form.enabled,
    classification,
    action: form.action
  };
};

const PathSelectionPolicyEditor = () => {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [applyOnWan, setApplyOnWan] = useState(false);
  const [overrideDefaultRoute, setOverrideDefaultRoute] = useState(true);
  const [rules, setRules] = useState([]);
  const [pathLabels, setPathLabels] = useState([]);
  const [appIdentifications, setAppIdentifications] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRuleIdx, setEditingRuleIdx] = useState(null);
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE);

  const fetchPathLabels = useCallback(async () => {
    try {
      const res = await api.get('/pathlabels');
      setPathLabels(res.data || []);
    } catch (err) {
      // Non-fatal - the editor still works, just without a label picker
    }
  }, []);

  const fetchAppIdentifications = useCallback(async () => {
    try {
      const res = await api.get('/appidentifications');
      setAppIdentifications(res.data?.appIdentifications || []);
    } catch (err) {
      // Non-fatal - the Application classification just won't have options
    }
  }, []);

  const fetchPolicy = useCallback(async () => {
    if (isNew) return;
    try {
      const res = await api.get(`/mlpolicies/${id}`);
      setName(res.data.name || '');
      setDescription(res.data.description || '');
      setApplyOnWan(Boolean(res.data.applyOnWan));
      setOverrideDefaultRoute(res.data.overrideDefaultRoute !== false);
      setRules((res.data.rules || []).map(toRuleForm));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch policy');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { fetchPathLabels(); }, [fetchPathLabels]);
  useEffect(() => { fetchAppIdentifications(); }, [fetchAppIdentifications]);
  useEffect(() => { fetchPolicy(); }, [fetchPolicy]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { name, description, applyOnWan, overrideDefaultRoute, rules: rules.map(toRuleRequest) };
      if (isNew) await api.post('/mlpolicies', payload);
      else await api.put(`/mlpolicies/${id}`, payload);
      navigate('/path-selection-policy');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const openNewRule = () => {
    setEditingRuleIdx(null);
    setRuleForm({ ...EMPTY_RULE, priority: rules.length });
    setShowRuleModal(true);
  };
  const openEditRule = (idx) => {
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

  const handleMoveRule = (idx, dir) => {
    const sorted = rules.map((r, i) => ({ ...r, _idx: i })).sort((a, b) => a.priority - b.priority);
    const pos = sorted.findIndex((r) => r._idx === idx);
    const swapPos = dir === 'up' ? pos - 1 : pos + 1;
    if (swapPos < 0 || swapPos >= sorted.length) return;
    const next = [...rules];
    const a = sorted[pos]._idx;
    const b = sorted[swapPos]._idx;
    const tmp = next[a].priority;
    next[a] = { ...next[a], priority: next[b].priority };
    next[b] = { ...next[b], priority: tmp };
    setRules(next);
  };

  const updateLinkGroup = (idx, changes) => {
    const links = [...ruleForm.action.links];
    links[idx] = { ...links[idx], ...changes };
    setRuleForm({ ...ruleForm, action: { ...ruleForm.action, links } });
  };
  const addLinkGroup = () => {
    setRuleForm({ ...ruleForm, action: { ...ruleForm.action, links: [...ruleForm.action.links, { pathlabels: [], order: 'priority' }] } });
  };
  const removeLinkGroup = (idx) => {
    setRuleForm({ ...ruleForm, action: { ...ruleForm.action, links: ruleForm.action.links.filter((_, i) => i !== idx) } });
  };

  if (loading) return <div className="page-container"><p className="text-muted">Loading...</p></div>;

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'Path Selection Policy', path: '/path-selection-policy' }, { label: isNew ? 'add' : 'edit' }]}
        title="Path Selection Policy"
        actions={
          <>
            <button className="btn-icon-action" onClick={() => navigate('/path-selection-policy')} title="Back"><FaArrowLeft /></button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !name}>{saving ? 'Saving...' : 'Save Policy'}</Button>
          </>
        }
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}

      <div className="mlpolicy-header-card">
        <Row>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Policy Name *</Form.Label>
              <Form.Control value={name} onChange={(e) => setName(e.target.value)} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Description</Form.Label>
              <Form.Control value={description} onChange={(e) => setDescription(e.target.value)} />
            </Form.Group>
          </Col>
        </Row>
        <Row className="mt-3">
          <Col md={6}>
            <Form.Check
              type="switch"
              id="mlpolicy-apply-on-wan"
              label="Apply on WAN Rx (also apply this policy to traffic arriving on the WAN interface)"
              checked={applyOnWan}
              onChange={(e) => setApplyOnWan(e.target.checked)}
            />
          </Col>
          <Col md={6}>
            <Form.Check
              type="switch"
              id="mlpolicy-override-default-route"
              label="Override default route (takes precedence over the device's routing table)"
              checked={overrideDefaultRoute}
              onChange={(e) => setOverrideDefaultRoute(e.target.checked)}
            />
          </Col>
        </Row>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-bold mb-0">Rules</h6>
        <Button variant="primary" size="sm" onClick={openNewRule}>Add Rule</Button>
      </div>
      <div className="table-container-template">
        <table className="custom-table-template">
          <thead>
            <tr><th>Priority</th><th>Name</th><th>Classification</th><th>Path Labels</th><th>Order</th><th>Enabled</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rules.length > 0 ? rules.slice().sort((a, b) => a.priority - b.priority).map((rule, i, sortedRules) => {
              const idx = rules.indexOf(rule);
              const labelNames = (rule.action.links || [])
                .flatMap((l) => l.pathlabels)
                .map((id) => pathLabels.find((p) => p._id === id)?.name || id)
                .join(', ');
              const appName = rule.classificationType === 'application'
                ? (appIdentifications.find((a) => (a._id || a.id) === rule.application.appId)?.name || rule.application.appId)
                : null;
              return (
                <tr key={idx}>
                  <td>{rule.priority}</td>
                  <td className="fw-bold">{rule.name}</td>
                  <td>
                    {rule.classificationType === 'prefix' && `IP: ${rule.prefix.ip || 'Any'}`}
                    {rule.classificationType === 'application' && `App: ${appName || 'Any'}`}
                    {rule.classificationType === 'category' && `Category: ${rule.category.category}`}
                  </td>
                  <td>{labelNames || '-'}</td>
                  <td>{rule.action.order}</td>
                  <td>{rule.enabled ? 'Yes' : 'No'}</td>
                  <td>
                    <button className="btn-icon-teal" onClick={() => handleMoveRule(idx, 'up')} disabled={i === 0} title="Move up"><FaArrowUp /></button>
                    <button className="btn-icon-teal" onClick={() => handleMoveRule(idx, 'down')} disabled={i === sortedRules.length - 1} title="Move down"><FaArrowDown /></button>
                    <button className="btn-icon-yellow" onClick={() => openEditRule(idx)}><FaCog /></button>
                    <button className="btn-icon-red" onClick={() => handleDeleteRule(idx)}><FaTrash /></button>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan="7" className="text-center text-muted py-4">No rules yet. Add one to start routing traffic.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal show={showRuleModal} onHide={() => setShowRuleModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingRuleIdx !== null ? 'Edit Rule' : 'Add Rule'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={8}><Form.Group className="mb-3"><Form.Label>Rule Name</Form.Label><Form.Control value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} /></Form.Group></Col>
              <Col md={4}><Form.Group className="mb-3"><Form.Label>Priority (0=highest)</Form.Label><Form.Control type="number" min={0} max={1000} value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} /></Form.Group></Col>
            </Row>
            <Form.Check className="mb-3" type="switch" id="rule-enabled" label="Enabled" checked={ruleForm.enabled} onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })} />

            <h6 className="fw-bold">Traffic Classification</h6>
            <Form.Group className="mb-3">
              <Form.Select value={ruleForm.classificationType} onChange={(e) => setRuleForm({ ...ruleForm, classificationType: e.target.value })}>
                <option value="prefix">IP / Port</option>
                <option value="application">Application</option>
                <option value="category">Category / Service Class / Importance</option>
              </Form.Select>
            </Form.Group>
            {ruleForm.classificationType === 'prefix' && (
              <Row>
                <Col md={5}><Form.Group className="mb-3"><Form.Label>Destination IP/Mask</Form.Label><Form.Control value={ruleForm.prefix.ip} onChange={(e) => setRuleForm({ ...ruleForm, prefix: { ...ruleForm.prefix, ip: e.target.value } })} placeholder="Any" /></Form.Group></Col>
                <Col md={4}><Form.Group className="mb-3"><Form.Label>Ports</Form.Label><Form.Control value={ruleForm.prefix.ports} onChange={(e) => setRuleForm({ ...ruleForm, prefix: { ...ruleForm.prefix, ports: e.target.value } })} /></Form.Group></Col>
                <Col md={3}>
                  <Form.Group className="mb-3">
                    <Form.Label>Protocol</Form.Label>
                    <Form.Select value={ruleForm.prefix.protocol} onChange={(e) => setRuleForm({ ...ruleForm, prefix: { ...ruleForm.prefix, protocol: e.target.value } })}>
                      <option value="">Any</option>
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
            )}
            {ruleForm.classificationType === 'application' && (
              <Form.Group className="mb-3">
                <Form.Label>Application</Form.Label>
                <Form.Select value={ruleForm.application.appId} onChange={(e) => setRuleForm({ ...ruleForm, application: { appId: e.target.value } })}>
                  <option value="">Select application/traffic identification</option>
                  {appIdentifications.map((app) => <option key={app._id || app.id} value={app._id || app.id}>{app.name}</option>)}
                </Form.Select>
              </Form.Group>
            )}
            {ruleForm.classificationType === 'category' && (
              <Row>
                <Col md={4}><Form.Group className="mb-3"><Form.Label>Category</Form.Label><Form.Control value={ruleForm.category.category} onChange={(e) => setRuleForm({ ...ruleForm, category: { ...ruleForm.category, category: e.target.value } })} /></Form.Group></Col>
                <Col md={4}><Form.Group className="mb-3"><Form.Label>Service Class</Form.Label><Form.Control value={ruleForm.category.serviceClass} onChange={(e) => setRuleForm({ ...ruleForm, category: { ...ruleForm.category, serviceClass: e.target.value } })} /></Form.Group></Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Importance</Form.Label>
                    <Form.Select value={ruleForm.category.importance} onChange={(e) => setRuleForm({ ...ruleForm, category: { ...ruleForm.category, importance: e.target.value } })}>
                      <option value="">Any</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
            )}

            <h6 className="fw-bold mt-3">Action</h6>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Order Between Groups</Form.Label>
                  <Form.Select value={ruleForm.action.order} onChange={(e) => setRuleForm({ ...ruleForm, action: { ...ruleForm.action, order: e.target.value } })}>
                    <option value="priority">Priority</option>
                    <option value="load-balancing">Load Balancing</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Fallback</Form.Label>
                  <Form.Select value={ruleForm.action.fallback} onChange={(e) => setRuleForm({ ...ruleForm, action: { ...ruleForm.action, fallback: e.target.value } })}>
                    <option value="drop">Drop</option>
                    <option value="by-destination">By Destination</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <div className="d-flex justify-content-between align-items-center mb-2">
              <Form.Label className="mb-0">Link Groups (tried in order)</Form.Label>
              <Button size="sm" variant="outline-primary" onClick={addLinkGroup}>Add Group</Button>
            </div>
            {ruleForm.action.links.length > 0 && (
              <Row className="mb-1 d-none d-md-flex">
                <Col md={7}><Form.Label className="mb-0 small text-muted">Path Labels</Form.Label></Col>
                <Col md={4}><Form.Label className="mb-0 small text-muted">Selection Order</Form.Label></Col>
              </Row>
            )}
            {ruleForm.action.links.map((group, idx) => (
              <Row key={idx} className="align-items-center mb-2">
                <Col md={7}>
                  <Form.Select multiple value={group.pathlabels} onChange={(e) => updateLinkGroup(idx, { pathlabels: Array.from(e.target.selectedOptions, (o) => o.value) })}>
                    {pathLabels.map((label) => <option key={label._id} value={label._id}>{label.name}</option>)}
                  </Form.Select>
                </Col>
                <Col md={4}>
                  <Form.Select value={group.order} onChange={(e) => updateLinkGroup(idx, { order: e.target.value })}>
                    <option value="priority">Priority</option>
                    <option value="load-balancing">Load Balancing</option>
                    <option value="link-quality">Link Quality</option>
                  </Form.Select>
                </Col>
                <Col md={1}><button className="btn-icon-red" onClick={() => removeLinkGroup(idx)}><FaTrash /></button></Col>
              </Row>
            ))}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRuleModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSaveRule} disabled={!ruleForm.name}>Save Rule</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default PathSelectionPolicyEditor;
