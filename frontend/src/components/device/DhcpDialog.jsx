import React from 'react';
import PermissionButton from '../common/PermissionButton';
import { Modal, Form, Button, Row, Col } from 'react-bootstrap';
import { FaSave, FaTrash } from 'react-icons/fa';

export default function DhcpDialog({ DHCP_OPTION_CHOICES, DHCP_OPTION_CODES, device, dhcpForm, editingDhcp, handleSaveDHCP, setDhcpForm, setShowDhcpModal, showDhcpModal }) {
  return <>
<Modal show={showDhcpModal} onHide={() => setShowDhcpModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingDhcp ? 'Edit DHCP Server' : 'Add DHCP Server'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Interface</Form.Label>
              <Form.Select
                value={dhcpForm.interface}
                onChange={e => setDhcpForm({...dhcpForm, interface: e.target.value})}
                disabled={!!editingDhcp} // Disable interface selection when editing
              >
                <option value="">Select Interface</option>
                {device?.interfaces?.filter(i => i.type === 'LAN').map(i => (
                  <option key={i._id} value={i.devId || ''} disabled={!i.devId}>{i.name} ({i.IPv4}){!i.devId ? ' (bus address not yet reported by device)' : ''}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Range Start</Form.Label>
                  <Form.Control value={dhcpForm.rangeStart} onChange={e => setDhcpForm({...dhcpForm, rangeStart: e.target.value})} placeholder="192.168.1.100" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Range End</Form.Label>
                  <Form.Control value={dhcpForm.rangeEnd} onChange={e => setDhcpForm({...dhcpForm, rangeEnd: e.target.value})} placeholder="192.168.1.200" />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-3">
              <Form.Label>DNS Servers (comma separated)</Form.Label>
              <Form.Control value={dhcpForm.dns} onChange={e => setDhcpForm({...dhcpForm, dns: e.target.value})} placeholder="8.8.8.8, 8.8.4.4" />
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Default Lease Time (seconds)</Form.Label>
                  <Form.Control type="number" value={dhcpForm.defaultLeaseTime} onChange={e => setDhcpForm({...dhcpForm, defaultLeaseTime: e.target.value})} placeholder="600" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Max Lease Time (seconds)</Form.Label>
                  <Form.Control type="number" value={dhcpForm.maxLeaseTime} onChange={e => setDhcpForm({...dhcpForm, maxLeaseTime: e.target.value})} placeholder="7200" />
                </Form.Group>
              </Col>
            </Row>

            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="fw-bold mb-0">Static IP Assignments</h6>
              <Button size="sm" variant="outline-primary" onClick={() => setDhcpForm({ ...dhcpForm, macAssign: [...dhcpForm.macAssign, { host: '', mac: '', ipv4: '' }] })}>Add Assignment</Button>
            </div>
            {dhcpForm.macAssign.map((assign, aidx) => (
              <Row key={aidx} className="align-items-center mb-2">
                <Col md={4}><Form.Control placeholder="Host name" value={assign.host} onChange={e => { const macAssign = [...dhcpForm.macAssign]; macAssign[aidx] = { ...assign, host: e.target.value }; setDhcpForm({ ...dhcpForm, macAssign }); }} /></Col>
                <Col md={4}><Form.Control placeholder="MAC address" value={assign.mac} onChange={e => { const macAssign = [...dhcpForm.macAssign]; macAssign[aidx] = { ...assign, mac: e.target.value }; setDhcpForm({ ...dhcpForm, macAssign }); }} /></Col>
                <Col md={3}><Form.Control placeholder="IPv4 address" value={assign.ipv4} onChange={e => { const macAssign = [...dhcpForm.macAssign]; macAssign[aidx] = { ...assign, ipv4: e.target.value }; setDhcpForm({ ...dhcpForm, macAssign }); }} /></Col>
                <Col md={1}><button type="button" className="btn-icon-red" onClick={() => setDhcpForm({ ...dhcpForm, macAssign: dhcpForm.macAssign.filter((_, i) => i !== aidx) })}><FaTrash /></button></Col>
              </Row>
            ))}

            <div className="d-flex justify-content-between align-items-center mb-2 mt-3">
              <h6 className="fw-bold mb-0">DHCP Options</h6>
              <Button size="sm" variant="outline-primary" onClick={() => setDhcpForm({ ...dhcpForm, options: [...dhcpForm.options, { option: DHCP_OPTION_CHOICES[0], code: DHCP_OPTION_CODES[0], value: '' }] })}>Add Option</Button>
            </div>
            {dhcpForm.options.map((opt, oidx) => (
              <Row key={oidx} className="align-items-center mb-2">
                <Col md={4}>
                  <Form.Select value={opt.option} onChange={e => { const options = [...dhcpForm.options]; options[oidx] = { ...opt, option: e.target.value }; setDhcpForm({ ...dhcpForm, options }); }}>
                    {DHCP_OPTION_CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Select value={opt.code} onChange={e => { const options = [...dhcpForm.options]; options[oidx] = { ...opt, code: e.target.value }; setDhcpForm({ ...dhcpForm, options }); }}>
                    {DHCP_OPTION_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                  </Form.Select>
                </Col>
                <Col md={4}><Form.Control placeholder="Value" value={opt.value} onChange={e => { const options = [...dhcpForm.options]; options[oidx] = { ...opt, value: e.target.value }; setDhcpForm({ ...dhcpForm, options }); }} /></Col>
                <Col md={1}><button type="button" className="btn-icon-red" onClick={() => setDhcpForm({ ...dhcpForm, options: dhcpForm.options.filter((_, i) => i !== oidx) })}><FaTrash /></button></Col>
              </Row>
            ))}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDhcpModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'post'} variant="primary" onClick={handleSaveDHCP}><FaSave className="me-2"/>Save DHCP Server</PermissionButton>
        </Modal.Footer>
      </Modal>
  </>;
}
