import React from 'react';
import PermissionButton from '../common/PermissionButton';
import { Modal, Form, Button, Row, Col } from 'react-bootstrap';

export default function DeviceFirewallDialog({ device, editingFirewallRuleIdx, firewallRuleForm, handleSaveFirewallRule, setFirewallRuleForm, setShowFirewallRuleModal, showFirewallRuleModal }) {
  return <>
<Modal show={showFirewallRuleModal} onHide={() => setShowFirewallRuleModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingFirewallRuleIdx !== null ? 'Edit Rule' : 'New Rule'}{firewallRuleForm.direction === 'lanNat' ? ' (LAN NAT)' : ''}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control value={firewallRuleForm.description} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, description: e.target.value })} /></Form.Group>

            {firewallRuleForm.direction !== 'lanNat' && (
              <>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Direction</Form.Label>
                      <Form.Select value={firewallRuleForm.direction} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, direction: e.target.value })}>
                        <option value="outbound">Outbound</option>
                        <option value="inbound">Inbound</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Action</Form.Label>
                      <Form.Select value={firewallRuleForm.action} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, action: e.target.value })}>
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                </Row>
                {firewallRuleForm.direction === 'inbound' && (
                  <Row>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Inbound Type</Form.Label>
                        <Form.Select value={firewallRuleForm.inbound} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, inbound: e.target.value })}>
                          <option value="edgeAccess">flexiEdge access</option>
                          <option value="portForward">Port Forward</option>
                          <option value="nat1to1">1:1 NAT</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    {firewallRuleForm.inbound !== 'edgeAccess' && (
                      <>
                        <Col md={4}><Form.Group className="mb-3"><Form.Label>Internal IP</Form.Label><Form.Control value={firewallRuleForm.internalIP} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, internalIP: e.target.value })} /></Form.Group></Col>
                        <Col md={4}><Form.Group className="mb-3"><Form.Label>Internal Port</Form.Label><Form.Control value={firewallRuleForm.internalPortStart} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, internalPortStart: e.target.value })} /></Form.Group></Col>
                      </>
                    )}
                  </Row>
                )}
                <h6 className="fw-bold mt-3">Source</h6>
                <Row>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Source IP/Mask (blank = Any)</Form.Label><Form.Control value={firewallRuleForm.classification.source.ipPort.ip} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, ipPort: { ...firewallRuleForm.classification.source.ipPort, ip: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Source Ports</Form.Label><Form.Control value={firewallRuleForm.classification.source.ipPort.ports} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, ipPort: { ...firewallRuleForm.classification.source.ipPort, ports: e.target.value } } } })} /></Form.Group></Col>
                </Row>
                <h6 className="fw-bold">Destination</h6>
                <Row>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>Destination IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.destination.ipProtoPort.ip} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, ipProtoPort: { ...firewallRuleForm.classification.destination.ipProtoPort, ip: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>Destination Ports</Form.Label><Form.Control value={firewallRuleForm.classification.destination.ipProtoPort.ports} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, ipProtoPort: { ...firewallRuleForm.classification.destination.ipProtoPort, ports: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Protocol</Form.Label>
                      <Form.Select value={firewallRuleForm.classification.destination.ipProtoPort.protocols?.[0] || ''} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, ipProtoPort: { ...firewallRuleForm.classification.destination.ipProtoPort, protocols: e.target.value ? [e.target.value] : [] } } } })}>
                        <option value="">Any</option>
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                        <option value="icmp">ICMP</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                </Row>
                <Row>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Priority</Form.Label><Form.Control type="number" value={firewallRuleForm.priority} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, priority: Number(e.target.value) })} /></Form.Group></Col>
                  <Col md={6}>
                    <Form.Group className="mb-3 d-flex align-items-center gap-2">
                      <Form.Check type="switch" id="fw-rule-enabled" checked={firewallRuleForm.enabled} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, enabled: e.target.checked })} label="Enabled" />
                    </Form.Group>
                  </Col>
                </Row>
              </>
            )}

            {firewallRuleForm.direction === 'lanNat' && (
              <>
                <h6 className="fw-bold mt-2">Source</h6>
                <Row>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>LAN Interface</Form.Label><Form.Select value={firewallRuleForm.classification.source.lanNat.interface} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, lanNat: { ...firewallRuleForm.classification.source.lanNat, interface: e.target.value } } } })}><option value="">Select interface</option>{(device.interfaces || []).filter(i => i.type === 'LAN').map(i => <option key={i._id} value={i.devId || ''} disabled={!i.devId}>{i.name}{!i.devId ? ' (bus address not yet reported by device)' : ''}</option>)}</Form.Select></Form.Group></Col>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>Match IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.source.lanNat.match} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, lanNat: { ...firewallRuleForm.classification.source.lanNat, match: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={4}><Form.Group className="mb-3"><Form.Label>Action IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.source.lanNat.action} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, source: { ...firewallRuleForm.classification.source, lanNat: { ...firewallRuleForm.classification.source.lanNat, action: e.target.value } } } })} /></Form.Group></Col>
                </Row>
                <h6 className="fw-bold">Destination</h6>
                <Row>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Match IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.destination.lanNat.match} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, lanNat: { ...firewallRuleForm.classification.destination.lanNat, match: e.target.value } } } })} /></Form.Group></Col>
                  <Col md={6}><Form.Group className="mb-3"><Form.Label>Action IP/Mask</Form.Label><Form.Control value={firewallRuleForm.classification.destination.lanNat.action} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, classification: { ...firewallRuleForm.classification, destination: { ...firewallRuleForm.classification.destination, lanNat: { ...firewallRuleForm.classification.destination.lanNat, action: e.target.value } } } })} /></Form.Group></Col>
                </Row>
                <Form.Group className="mb-3"><Form.Label>Priority</Form.Label><Form.Control type="number" value={firewallRuleForm.priority} onChange={e => setFirewallRuleForm({ ...firewallRuleForm, priority: Number(e.target.value) })} /></Form.Group>
              </>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowFirewallRuleModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleSaveFirewallRule}>Save Rule</PermissionButton>
        </Modal.Footer>
      </Modal>
  </>;
}
