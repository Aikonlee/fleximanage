import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Row, Col, Alert } from 'react-bootstrap';
import { FaArrowLeft } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './QoSEditor.css';

const DSCP_OPTIONS = [
  'CS0', 'CS1', 'CS2', 'CS3', 'CS4', 'CS5', 'CS6', 'CS7',
  'AF11', 'AF12', 'AF13', 'AF21', 'AF22', 'AF23', 'AF31', 'AF32', 'AF33', 'AF41', 'AF42', 'AF43',
  'EF', 'VA'
];

const DATA_QUEUES = [
  { key: 'control-signaling', label: 'Control / Signaling' },
  { key: 'prime-select', label: 'Prime Select' },
  { key: 'standard-select', label: 'Standard Select' },
  { key: 'best-effort', label: 'Best Effort' },
];

const DEFAULT_OUTBOUND = {
  realtime: { bandwidthLimitPercent: 30, dscpRewrite: 'CS0' },
  'control-signaling': { weight: 30, dscpRewrite: 'CS0' },
  'prime-select': { weight: 20, dscpRewrite: 'CS0' },
  'standard-select': { weight: 15, dscpRewrite: 'CS0' },
  'best-effort': { weight: 5, dscpRewrite: 'CS0' },
};

const DEFAULT_INBOUND = { policerBandwidthLimitPercent: { high: 100, medium: 80, low: 65 } };

const QoSEditor = () => {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [outbound, setOutbound] = useState(DEFAULT_OUTBOUND);
  const [inbound, setInbound] = useState(DEFAULT_INBOUND);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fetchPolicy = useCallback(async () => {
    if (isNew) return;
    try {
      const res = await api.get(`/qosPolicies/${id}`);
      setName(res.data.name || '');
      setDescription(res.data.description || '');
      setAdvanced(Boolean(res.data.advanced));
      setOutbound({ ...DEFAULT_OUTBOUND, ...res.data.outbound });
      setInbound({ ...DEFAULT_INBOUND, ...res.data.inbound });
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch QoS policy');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { fetchPolicy(); }, [fetchPolicy]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { name, description, advanced, outbound, inbound };
      if (isNew) await api.post('/qosPolicies', payload);
      else await api.put(`/qosPolicies/${id}`, payload);
      navigate('/qos');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save QoS policy');
    } finally {
      setSaving(false);
    }
  };

  const updateOutbound = (queue, field, value) => {
    setOutbound({ ...outbound, [queue]: { ...outbound[queue], [field]: value } });
  };
  const updatePolicer = (level, value) => {
    setInbound({ ...inbound, policerBandwidthLimitPercent: { ...inbound.policerBandwidthLimitPercent, [level]: Number(value) } });
  };

  const dataQueueWeightSum = DATA_QUEUES.reduce((sum, q) => sum + (Number(outbound[q.key]?.weight) || 0), 0);

  if (loading) return <div className="page-container"><p className="text-muted">Loading...</p></div>;

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'Quality of Service', path: '/qos' }, { label: isNew ? 'add' : 'edit' }]}
        title="Quality of Service"
        actions={
          <>
            <button className="btn-icon-action" onClick={() => navigate('/qos')} title="Back"><FaArrowLeft /></button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !name}>{saving ? 'Saving...' : 'Save Policy'}</Button>
          </>
        }
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}

      <div className="qos-card">
        <Row>
          <Col md={6}><Form.Group><Form.Label>Policy Name *</Form.Label><Form.Control value={name} onChange={(e) => setName(e.target.value)} /></Form.Group></Col>
          <Col md={6}><Form.Group><Form.Label>Description</Form.Label><Form.Control value={description} onChange={(e) => setDescription(e.target.value)} /></Form.Group></Col>
        </Row>
        <Form.Check className="mt-3" type="switch" id="qos-advanced" label="Advanced (allow custom DSCP tag rewriting per queue)" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
      </div>

      <div className="qos-card">
        <h6 className="fw-bold mb-1">Outbound — Real-time Queue</h6>
        <p className="text-muted small">Highest priority queue (voice/video). Reserved bandwidth, not weighted.</p>
        <Row className="align-items-end">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Bandwidth Limit %</Form.Label>
              <Form.Control type="number" min={10} max={90} value={outbound.realtime.bandwidthLimitPercent} onChange={(e) => updateOutbound('realtime', 'bandwidthLimitPercent', Number(e.target.value))} />
              <Form.Text className="text-muted">Must be between 10% and 90%.</Form.Text>
            </Form.Group>
          </Col>
          {advanced && (
            <Col md={4}>
              <Form.Group>
                <Form.Label>DSCP Rewrite</Form.Label>
                <Form.Select value={outbound.realtime.dscpRewrite} onChange={(e) => updateOutbound('realtime', 'dscpRewrite', e.target.value)}>
                  {DSCP_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </Form.Select>
              </Form.Group>
            </Col>
          )}
        </Row>
      </div>

      <div className="qos-card">
        <h6 className="fw-bold mb-1">Outbound — Data Queues</h6>
        <p className="text-muted small">
          Remaining bandwidth is shared between these queues by weighted round-robin
          (current weights: {DATA_QUEUES.map((q) => `${outbound[q.key]?.weight ?? 0}`).join(' / ')}, sum {dataQueueWeightSum}). Each weight must be between 10 and 70.
        </p>
        {DATA_QUEUES.map((q) => (
          <Row key={q.key} className="align-items-end mb-2">
            <Col md={3}><Form.Label className="mb-0">{q.label}</Form.Label></Col>
            <Col md={3}>
              <Form.Control type="number" min={10} max={70} value={outbound[q.key]?.weight ?? 0} onChange={(e) => updateOutbound(q.key, 'weight', Number(e.target.value))} placeholder="Weight" />
            </Col>
            {advanced && (
              <Col md={4}>
                <Form.Select value={outbound[q.key]?.dscpRewrite || 'CS0'} onChange={(e) => updateOutbound(q.key, 'dscpRewrite', e.target.value)}>
                  {DSCP_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </Form.Select>
              </Col>
            )}
          </Row>
        ))}
      </div>

      <div className="qos-card">
        <h6 className="fw-bold mb-1">Inbound Policer</h6>
        <p className="text-muted small">Caps how much of the link's inbound capacity each importance level may use.</p>
        <Row>
          {['high', 'medium', 'low'].map((level) => (
            <Col md={4} key={level}>
              <Form.Group>
                <Form.Label className="text-capitalize">{level} importance %</Form.Label>
                <Form.Control type="number" min={0} max={100} value={inbound.policerBandwidthLimitPercent[level]} onChange={(e) => updatePolicer(level, e.target.value)} />
              </Form.Group>
            </Col>
          ))}
        </Row>
      </div>
    </div>
  );
};

export default QoSEditor;
