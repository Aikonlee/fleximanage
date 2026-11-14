import React from 'react';
import PermissionButton from '../common/PermissionButton';
import { Modal, Form, Button } from 'react-bootstrap';

export default function EdgeLoopbackDialog({ edgeLoopbackForm, handleAddEdgeLoopback, setEdgeLoopbackForm, setShowEdgeLoopbackModal, showEdgeLoopbackModal }) {
  return <>
<Modal show={showEdgeLoopbackModal} onHide={() => setShowEdgeLoopbackModal(false)} centered>
        <Modal.Header closeButton><Modal.Title>Add Edge Loopback</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>Name</Form.Label><Form.Control value={edgeLoopbackForm.name} onChange={(e) => setEdgeLoopbackForm({ ...edgeLoopbackForm, name: e.target.value })} /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>IP Address</Form.Label><Form.Control value={edgeLoopbackForm.ip} onChange={(e) => setEdgeLoopbackForm({ ...edgeLoopbackForm, ip: e.target.value })} placeholder="e.g. 10.100.0.1" /></Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEdgeLoopbackModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleAddEdgeLoopback} disabled={!edgeLoopbackForm.name || !edgeLoopbackForm.ip}>Add</PermissionButton>
        </Modal.Footer>
      </Modal>
  </>;
}
