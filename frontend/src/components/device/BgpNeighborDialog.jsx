import React from 'react';
import PermissionButton from '../common/PermissionButton';
import { Modal, Form, Button, Row, Col } from 'react-bootstrap';

export default function BgpNeighborDialog({ bgpNeighborForm, editingBgpNeighborIdx, handleSaveBgpNeighbor, routingFilters, setBgpNeighborForm, setShowBgpNeighborModal, showBgpNeighborModal }) {
  return <>
<Modal show={showBgpNeighborModal} onHide={() => setShowBgpNeighborModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingBgpNeighborIdx !== null ? 'Edit BGP Neighbor' : 'Add BGP Neighbor'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Remote IP</Form.Label><Form.Control value={bgpNeighborForm.ip} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, ip: e.target.value })} placeholder="10.0.0.1" /></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Remote ASN</Form.Label><Form.Control value={bgpNeighborForm.remoteASN} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, remoteASN: e.target.value })} /></Form.Group></Col>
            </Row>
            <Form.Group className="mb-3"><Form.Label>MD5 Key (optional)</Form.Label><Form.Control type="password" value={bgpNeighborForm.password} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, password: e.target.value })} /></Form.Group>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Inbound Filter (by name)</Form.Label><Form.Select value={bgpNeighborForm.inboundFilter} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, inboundFilter: e.target.value })}><option value="">None</option>{routingFilters.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}</Form.Select></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Outbound Filter (by name)</Form.Label><Form.Select value={bgpNeighborForm.outboundFilter} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, outboundFilter: e.target.value })}><option value="">None</option>{routingFilters.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}</Form.Select></Form.Group></Col>
            </Row>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Send Community</Form.Label>
                  <Form.Select value={bgpNeighborForm.sendCommunity} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, sendCommunity: e.target.value })}>
                    {['all', 'both', 'extended', 'large', 'standard', ''].map(v => <option key={v} value={v}>{v || '(none)'}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Multi-hop (1-255)</Form.Label><Form.Control type="number" min={1} max={255} value={bgpNeighborForm.multiHop} onChange={e => setBgpNeighborForm({ ...bgpNeighborForm, multiHop: e.target.value })} /></Form.Group></Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowBgpNeighborModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleSaveBgpNeighbor} disabled={!bgpNeighborForm.ip || !bgpNeighborForm.remoteASN}>Save Neighbor</PermissionButton>
        </Modal.Footer>
      </Modal>
  </>;
}
