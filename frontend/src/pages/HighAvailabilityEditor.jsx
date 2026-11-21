import PermissionButton from '../components/common/PermissionButton';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Row, Col, Alert, Modal } from 'react-bootstrap';
import { FaArrowLeft, FaCog, FaTrash } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './HighAvailabilityEditor.css';

const EMPTY_MEMBER = {
  device: '', interface: '', priority: 100, trackInterfacesMandatory: [], trackInterfacesOptional: []
};

const HighAvailabilityEditor = () => {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [virtualRouterId, setVirtualRouterId] = useState(1);
  const [virtualIp, setVirtualIp] = useState('');
  const [preemption, setPreemption] = useState(true);
  const [acceptMode, setAcceptMode] = useState(false);
  const [members, setMembers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [editingMemberIdx, setEditingMemberIdx] = useState(null);
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await api.get('/devices?response=detailed');
      setDevices(res.data?.devices || res.data || []);
    } catch (_err) {
      // Non-fatal
    }
  }, []);

  const fetchGroup = useCallback(async () => {
    if (isNew) return;
    try {
      const res = await api.get(`/vrrp/${id}`);
      setName(res.data.name || '');
      setVirtualRouterId(res.data.virtualRouterId || 1);
      setVirtualIp(res.data.virtualIp || '');
      setPreemption(res.data.preemption !== false);
      setAcceptMode(Boolean(res.data.acceptMode));
      setMembers((res.data.devices || []).map((d) => ({
        device: d.device?._id || d.device,
        interface: d.interface,
        priority: d.priority,
        trackInterfacesMandatory: d.trackInterfacesMandatory || [],
        trackInterfacesOptional: d.trackInterfacesOptional || []
      })));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch VRRP group');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);
  useEffect(() => { fetchGroup(); }, [fetchGroup]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { name, virtualRouterId: Number(virtualRouterId), virtualIp, preemption, acceptMode, devices: members };
      if (isNew) await api.post('/vrrp', payload);
      else await api.put(`/vrrp/${id}`, payload);
      navigate('/high-availability');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save VRRP group');
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setEditingMemberIdx(null);
    setMemberForm(EMPTY_MEMBER);
    setShowMemberModal(true);
  };
  const openEdit = (idx) => {
    setEditingMemberIdx(idx);
    setMemberForm(members[idx]);
    setShowMemberModal(true);
  };
  const handleSaveMember = () => {
    const next = [...members];
    if (editingMemberIdx !== null) next[editingMemberIdx] = memberForm;
    else next.push(memberForm);
    setMembers(next);
    setShowMemberModal(false);
  };
  const handleDeleteMember = (idx) => setMembers(members.filter((_, i) => i !== idx));

  const deviceName = (deviceId) => devices.find((d) => d._id === deviceId)?.name || deviceId;
  const interfaceName = (deviceId, devId) => {
    const device = devices.find((d) => d._id === deviceId);
    return device?.interfaces?.find((i) => i.devId === devId)?.name || devId;
  };
  const selectedDeviceInterfaces = devices.find((d) => d._id === memberForm.device)?.interfaces || [];

  if (loading) return <div className="page-container"><p className="text-muted">Loading...</p></div>;

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Security' }, { label: 'High Availability', path: '/high-availability' }, { label: isNew ? 'add' : 'edit' }]}
        title="High Availability (VRRP)"
        actions={
          <>
            <button className="btn-icon-action" onClick={() => navigate('/high-availability')} title="Back"><FaArrowLeft /></button>
            <PermissionButton permKey="vrrp" method={isNew ? 'post' : 'put'} variant="primary" onClick={handleSave} disabled={saving || !name || !virtualIp}>{saving ? 'Saving...' : 'Save Group'}</PermissionButton>
          </>
        }
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}

      <div className="ha-card">
        <Row>
          <Col md={4}><Form.Group className="mb-3"><Form.Label>Group Name *</Form.Label><Form.Control value={name} onChange={(e) => setName(e.target.value)} /></Form.Group></Col>
          <Col md={4}><Form.Group className="mb-3"><Form.Label>Virtual Router ID (1-255)</Form.Label><Form.Control type="number" min={1} max={255} value={virtualRouterId} onChange={(e) => setVirtualRouterId(e.target.value)} /></Form.Group></Col>
          <Col md={4}><Form.Group className="mb-3"><Form.Label>Virtual IP *</Form.Label><Form.Control value={virtualIp} onChange={(e) => setVirtualIp(e.target.value)} placeholder="e.g. 172.16.1.100" /></Form.Group></Col>
        </Row>
        <Row>
          <Col md={4}><Form.Check type="switch" id="ha-preemption" label="Preemption (higher-priority backup takes over)" checked={preemption} onChange={(e) => setPreemption(e.target.checked)} /></Col>
          <Col md={4}><Form.Check type="switch" id="ha-acceptmode" label="Accept Mode" checked={acceptMode} onChange={(e) => setAcceptMode(e.target.checked)} /></Col>
        </Row>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-bold mb-0">Devices</h6>
        <Button variant="primary" size="sm" onClick={openAdd}>Add Device</Button>
      </div>
      <div className="table-container-template">
        <table className="custom-table-template">
          <thead><tr><th>Device</th><th>LAN Interface</th><th>Priority</th><th>Mandatory Track</th><th>Optional Track</th><th>Actions</th></tr></thead>
          <tbody>
            {members.length > 0 ? members.map((m, idx) => (
              <tr key={idx}>
                <td className="fw-bold">{deviceName(m.device)}</td>
                <td>{interfaceName(m.device, m.interface)}</td>
                <td>{m.priority}</td>
                <td>{(m.trackInterfacesMandatory || []).length}</td>
                <td>{(m.trackInterfacesOptional || []).length}</td>
                <td>
                  <button className="btn-icon-yellow" onClick={() => openEdit(idx)}><FaCog /></button>
                  <button className="btn-icon-red" onClick={() => handleDeleteMember(idx)}><FaTrash /></button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan="6" className="text-center text-muted py-4">No devices in this group yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal show={showMemberModal} onHide={() => setShowMemberModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingMemberIdx !== null ? 'Edit Device' : 'Add Device'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Device</Form.Label>
                  <Form.Select value={memberForm.device} onChange={(e) => setMemberForm({ ...memberForm, device: e.target.value, interface: '' })}>
                    <option value="">Select device</option>
                    {devices.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>LAN Interface</Form.Label>
                  <Form.Select value={memberForm.interface} onChange={(e) => setMemberForm({ ...memberForm, interface: e.target.value })}>
                    <option value="">Select interface</option>
                    {selectedDeviceInterfaces.filter((i) => i.type === 'LAN').map((i) => (
                      <option key={i._id} value={i.devId || ''} disabled={!i.devId}>
                        {i.name}{!i.devId ? ' (bus address not yet reported by device)' : ''}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-3">
              <Form.Label>Priority (1-255, higher = master)</Form.Label>
              <Form.Control type="number" min={1} max={255} value={memberForm.priority} onChange={(e) => setMemberForm({ ...memberForm, priority: Number(e.target.value) })} />
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Mandatory Track Interfaces</Form.Label>
                  <Form.Select multiple value={memberForm.trackInterfacesMandatory} onChange={(e) => setMemberForm({ ...memberForm, trackInterfacesMandatory: Array.from(e.target.selectedOptions, (o) => o.value) })}>
                    {selectedDeviceInterfaces.map((i) => (
                      <option key={i._id} value={i.devId || ''} disabled={!i.devId}>{i.name}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Optional Track Interfaces</Form.Label>
                  <Form.Select multiple value={memberForm.trackInterfacesOptional} onChange={(e) => setMemberForm({ ...memberForm, trackInterfacesOptional: Array.from(e.target.selectedOptions, (o) => o.value) })}>
                    {selectedDeviceInterfaces.map((i) => (
                      <option key={i._id} value={i.devId || ''} disabled={!i.devId}>{i.name}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowMemberModal(false)}>Cancel</Button>
          <PermissionButton permKey="vrrp" method={isNew ? 'post' : 'put'} variant="primary" onClick={handleSaveMember} disabled={!memberForm.device || !memberForm.interface}>Save Device</PermissionButton>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default HighAvailabilityEditor;
