import React from 'react';
import PermissionButton from '../common/PermissionButton';
import { Modal, Form, Button, Row, Col } from 'react-bootstrap';

export default function InterfaceDialog({ editingInterface, handleInterfaceEdit, interfaceChanges, setEditingInterface }) {
  return <>
<Modal show={true} onHide={() => setEditingInterface(null)} centered size="lg">
          <Modal.Header closeButton><Modal.Title>Edit {editingInterface.name}</Modal.Title></Modal.Header>
          <Modal.Body>
            <Form>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>IPv4 Address / Mask</Form.Label>
                    <Form.Control
                      type="text"
                      value={(interfaceChanges[editingInterface._id]?.IPv4 !== undefined ? interfaceChanges[editingInterface._id].IPv4 : (editingInterface.IPv4 ? `${editingInterface.IPv4}/${editingInterface.IPv4Mask || '24'}` : '')) || ''}
                      onChange={(e) => handleInterfaceEdit(editingInterface, 'IPv4', e.target.value)}
                      placeholder="e.g. 192.168.1.1/24"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Gateway</Form.Label>
                    <Form.Control
                      type="text"
                      value={(interfaceChanges[editingInterface._id]?.gateway !== undefined ? interfaceChanges[editingInterface._id].gateway : editingInterface.gateway) || ''}
                      onChange={(e) => handleInterfaceEdit(editingInterface, 'gateway', e.target.value)}
                      placeholder="e.g. 192.168.1.254"
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>IPv4 Mask (Optional override)</Form.Label>
                    <Form.Control
                      type="text"
                      value={(interfaceChanges[editingInterface._id]?.IPv4Mask !== undefined ? interfaceChanges[editingInterface._id].IPv4Mask : editingInterface.IPv4Mask) || ''}
                      onChange={(e) => handleInterfaceEdit(editingInterface, 'IPv4Mask', e.target.value)}
                      placeholder="e.g. 24"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                   <Form.Group className="mb-3"><Form.Label>Metric</Form.Label><Form.Control type="text" value={(interfaceChanges[editingInterface._id]?.metric !== undefined ? interfaceChanges[editingInterface._id].metric : editingInterface.metric) || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'metric', e.target.value)} /></Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3"><Form.Label>Routing Protocol</Form.Label><Form.Select value={interfaceChanges[editingInterface._id]?.routing || editingInterface.routing || 'NONE'} onChange={(e) => handleInterfaceEdit(editingInterface, 'routing', e.target.value)}><option value="NONE">None</option><option value="OSPF">OSPF</option><option value="BGP">BGP</option></Form.Select></Form.Group>
              <Form.Group className="mb-3"><Form.Label>Bandwidth (Upload)</Form.Label><Form.Control type="number" value={interfaceChanges[editingInterface._id]?.bandwidthMbps?.tx || editingInterface.bandwidthMbps?.tx || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'bandwidthMbps', { ...editingInterface.bandwidthMbps, tx: e.target.value })} /></Form.Group>

              {/* OSPF Settings - displayed if routing is OSPF */}
              {(interfaceChanges[editingInterface._id]?.routing === 'OSPF' || (editingInterface.routing === 'OSPF' && !interfaceChanges[editingInterface._id]?.routing)) && (
                <>
                  <hr className="my-4" />
                  <h6 className="mb-3 fw-bold">OSPF Settings</h6>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Area</Form.Label>
                        <Form.Control type="text" value={interfaceChanges[editingInterface._id]?.ospf?.area || editingInterface.ospf?.area || '0.0.0.0'} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, area: e.target.value })} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Cost</Form.Label>
                        <Form.Control type="number" value={interfaceChanges[editingInterface._id]?.ospf?.cost || editingInterface.ospf?.cost || '10'} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, cost: e.target.value })} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Authentication Key ID</Form.Label>
                        <Form.Control type="text" value={interfaceChanges[editingInterface._id]?.ospf?.keyId || editingInterface.ospf?.keyId || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, keyId: e.target.value })} />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Authentication Key</Form.Label>
                        <Form.Control type="password" maxLength={16} value={interfaceChanges[editingInterface._id]?.ospf?.key || editingInterface.ospf?.key || ''} onChange={(e) => handleInterfaceEdit(editingInterface, 'ospf', { ...editingInterface.ospf, ...interfaceChanges[editingInterface._id]?.ospf, key: e.target.value })} />
                      </Form.Group>
                    </Col>
                  </Row>
                </>
              )}
            </Form>
          </Modal.Body>
          <Modal.Footer><Button variant="secondary" onClick={() => setEditingInterface(null)}>Cancel</Button><PermissionButton permKey="devices" method={'put'} variant="primary" onClick={() => setEditingInterface(null)}>Save Locally</PermissionButton></Modal.Footer>
        </Modal>
  </>;
}
