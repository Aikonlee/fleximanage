import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Row, Col, Alert } from 'react-bootstrap';
import { FaArrowLeft } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './IpsecPeeringEditor.css';

const DEFAULTS = {
  name: '', idType: 'fqdn', localId: '', remoteIdType: 'fqdn', remoteId: '', psk: '', remoteIP: '',
  ips: '', urls: '',
  ikeDhGroup: 'modp-2048', ikeCryptoAlg: 'aes-cbc', ikeKeySize: '256', ikeIntegAlg: 'hmac-sha2-256-128',
  espDhGroup: 'ecp-256', espCryptoAlg: 'aes-cbc', espKeySize: '256', espIntegAlg: 'hmac-sha2-256-128',
  ikeLifeTime: '86400', sessionLifeTime: '3600', pfs: false,
  localIpRangeStart: '0.0.0.0', localIpRangeEnd: '255.255.255.255', localPortRangeStart: '0', localPortRangeEnd: '65535', localProtocol: 'any',
  remoteIpRangeStart: '0.0.0.0', remoteIpRangeEnd: '255.255.255.255', remotePortRangeStart: '0', remotePortRangeEnd: '65535', remoteProtocol: 'any',
};

const DH_GROUPS = ['modp-1024', 'modp-2048', 'modp-3072', 'modp-4096', 'ecp-256', 'ecp-384'];
const CRYPTO_ALGS = ['aes-cbc', 'aes-gcm-16', 'aes-ctr', '3des'];
const KEY_SIZES = ['128', '256'];
const INTEG_ALGS = ['hmac-sha2-256-128', 'hmac-sha2-384-192', 'sha1-96', 'none'];
const PROTOCOLS = ['any', 'tcp', 'udp', 'icmp'];

const IpsecPeeringEditor = () => {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();

  const [form, setForm] = useState(DEFAULTS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fetchPeer = useCallback(async () => {
    if (isNew) return;
    try {
      const res = await api.get(`/peers/${id}`);
      setForm({
        ...DEFAULTS,
        ...res.data,
        ips: (res.data.ips || []).join(', '),
        urls: (res.data.urls || []).join(', ')
      });
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch peer');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { fetchPeer(); }, [fetchPeer]);

  const set = (field, value) => setForm({ ...form, [field]: value });

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        ips: form.ips.split(',').map((s) => s.trim()).filter(Boolean),
        urls: form.urls.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (isNew) await api.post('/peers', payload);
      else await api.put(`/peers/${id}`, payload);
      navigate('/ipsec-peering');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save peer');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-container"><p className="text-muted">Loading...</p></div>;

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Traffic Optimization' }, { label: 'IPsec Peering', path: '/ipsec-peering' }, { label: isNew ? 'add' : 'edit' }]}
        title="IPsec Peer"
        actions={
          <>
            <button className="btn-icon-action" onClick={() => navigate('/ipsec-peering')} title="Back"><FaArrowLeft /></button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !form.name || !form.remoteIP}>{saving ? 'Saving...' : 'Save Peer'}</Button>
          </>
        }
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}

      <div className="peer-card">
        <h6 className="fw-bold mb-3">Identification</h6>
        <Row>
          <Col md={6}><Form.Group className="mb-3"><Form.Label>Name *</Form.Label><Form.Control value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Company router" /></Form.Group></Col>
          <Col md={6}><Form.Group className="mb-3"><Form.Label>Remote IP *</Form.Label><Form.Control value={form.remoteIP} onChange={(e) => set('remoteIP', e.target.value)} /></Form.Group></Col>
        </Row>
        <Row>
          <Col md={3}>
            <Form.Group className="mb-3">
              <Form.Label>Local ID Type</Form.Label>
              <Form.Select value={form.idType} onChange={(e) => set('idType', e.target.value)}>
                <option value="fqdn">FQDN</option>
                <option value="ip4-addr">IPv4 Address</option>
                <option value="email">Email</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3}><Form.Group className="mb-3"><Form.Label>Local ID</Form.Label><Form.Control value={form.localId} onChange={(e) => set('localId', e.target.value)} /></Form.Group></Col>
          <Col md={3}>
            <Form.Group className="mb-3">
              <Form.Label>Remote ID Type</Form.Label>
              <Form.Select value={form.remoteIdType} onChange={(e) => set('remoteIdType', e.target.value)}>
                <option value="fqdn">FQDN</option>
                <option value="ip4-addr">IPv4 Address</option>
                <option value="email">Email</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3}><Form.Group className="mb-3"><Form.Label>Remote ID</Form.Label><Form.Control value={form.remoteId} onChange={(e) => set('remoteId', e.target.value)} /></Form.Group></Col>
        </Row>
        <Form.Group className="mb-1"><Form.Label>Pre-Shared Key (PSK)</Form.Label><Form.Control type="password" value={form.psk} onChange={(e) => set('psk', e.target.value)} /></Form.Group>
      </div>

      <div className="peer-card">
        <h6 className="fw-bold mb-1">Peer Monitoring</h6>
        <p className="text-muted small">IP and URL based monitoring, comma-separated.</p>
        <Row>
          <Col md={6}><Form.Group className="mb-3"><Form.Label>Monitor IPs</Form.Label><Form.Control value={form.ips} onChange={(e) => set('ips', e.target.value)} placeholder="1.1.1.1, 8.8.8.8" /></Form.Group></Col>
          <Col md={6}><Form.Group className="mb-3"><Form.Label>Monitor URLs</Form.Label><Form.Control value={form.urls} onChange={(e) => set('urls', e.target.value)} placeholder="monitoring.example.com" /></Form.Group></Col>
        </Row>
      </div>

      <div className="peer-card">
        <div className="d-flex justify-content-between align-items-center">
          <h6 className="fw-bold mb-0">Cryptography &amp; Traffic Selector (Advanced)</h6>
          <Button variant="outline-secondary" size="sm" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? 'Hide' : 'Show'}</Button>
        </div>
        {showAdvanced && (
          <>
            <Row className="mt-3">
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>IKE DH Group</Form.Label>
                  <Form.Select value={form.ikeDhGroup} onChange={(e) => set('ikeDhGroup', e.target.value)}>{DH_GROUPS.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>IKE Crypto Alg</Form.Label>
                  <Form.Select value={form.ikeCryptoAlg} onChange={(e) => set('ikeCryptoAlg', e.target.value)}>{CRYPTO_ALGS.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>IKE Key Size</Form.Label>
                  <Form.Select value={form.ikeKeySize} onChange={(e) => set('ikeKeySize', e.target.value)}>{KEY_SIZES.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>IKE Integrity</Form.Label>
                  <Form.Select value={form.ikeIntegAlg} onChange={(e) => set('ikeIntegAlg', e.target.value)}>{INTEG_ALGS.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>ESP DH Group</Form.Label>
                  <Form.Select value={form.espDhGroup} onChange={(e) => set('espDhGroup', e.target.value)}>{DH_GROUPS.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>ESP Crypto Alg</Form.Label>
                  <Form.Select value={form.espCryptoAlg} onChange={(e) => set('espCryptoAlg', e.target.value)}>{CRYPTO_ALGS.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>ESP Key Size</Form.Label>
                  <Form.Select value={form.espKeySize} onChange={(e) => set('espKeySize', e.target.value)}>{KEY_SIZES.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>ESP Integrity</Form.Label>
                  <Form.Select value={form.espIntegAlg} onChange={(e) => set('espIntegAlg', e.target.value)}>{INTEG_ALGS.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col md={3}><Form.Group className="mb-3"><Form.Label>IKE Lifetime (s)</Form.Label><Form.Control value={form.ikeLifeTime} onChange={(e) => set('ikeLifeTime', e.target.value)} /></Form.Group></Col>
              <Col md={3}><Form.Group className="mb-3"><Form.Label>Session Lifetime (s)</Form.Label><Form.Control value={form.sessionLifeTime} onChange={(e) => set('sessionLifeTime', e.target.value)} /></Form.Group></Col>
              <Col md={3} className="d-flex align-items-center"><Form.Check className="mt-4" type="switch" id="peer-pfs" label="PFS" checked={form.pfs} onChange={(e) => set('pfs', e.target.checked)} /></Col>
            </Row>

            <h6 className="fw-bold mt-2">Traffic Selector</h6>
            <Row>
              <Col md={6}>
                <p className="text-muted small mb-1">Local range</p>
                <Row>
                  <Col md={5}><Form.Control className="mb-2" value={form.localIpRangeStart} onChange={(e) => set('localIpRangeStart', e.target.value)} placeholder="Start IP" /></Col>
                  <Col md={5}><Form.Control className="mb-2" value={form.localIpRangeEnd} onChange={(e) => set('localIpRangeEnd', e.target.value)} placeholder="End IP" /></Col>
                  <Col md={2}>
                    <Form.Select className="mb-2" value={form.localProtocol} onChange={(e) => set('localProtocol', e.target.value)}>{PROTOCOLS.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                  </Col>
                </Row>
              </Col>
              <Col md={6}>
                <p className="text-muted small mb-1">Remote range</p>
                <Row>
                  <Col md={5}><Form.Control className="mb-2" value={form.remoteIpRangeStart} onChange={(e) => set('remoteIpRangeStart', e.target.value)} placeholder="Start IP" /></Col>
                  <Col md={5}><Form.Control className="mb-2" value={form.remoteIpRangeEnd} onChange={(e) => set('remoteIpRangeEnd', e.target.value)} placeholder="End IP" /></Col>
                  <Col md={2}>
                    <Form.Select className="mb-2" value={form.remoteProtocol} onChange={(e) => set('remoteProtocol', e.target.value)}>{PROTOCOLS.map((v) => <option key={v} value={v}>{v}</option>)}</Form.Select>
                  </Col>
                </Row>
              </Col>
            </Row>
          </>
        )}
      </div>
    </div>
  );
};

export default IpsecPeeringEditor;
