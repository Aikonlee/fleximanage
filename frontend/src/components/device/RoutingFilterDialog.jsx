import React from 'react';
import PermissionButton from '../common/PermissionButton';
import { Modal, Form, Button, Row, Col } from 'react-bootstrap';
import { FaTrash } from 'react-icons/fa';

export default function RoutingFilterDialog({ editingRoutingFilterIdx, handleSaveRoutingFilter, routingFilterForm, setRoutingFilterForm, setShowRoutingFilterModal, showRoutingFilterModal }) {
  return <>
<Modal show={showRoutingFilterModal} onHide={() => setShowRoutingFilterModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingRoutingFilterIdx !== null ? 'Edit Routing Filter' : 'New Routing Filter'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Name (no spaces)</Form.Label><Form.Control value={routingFilterForm.name} onChange={e => setRoutingFilterForm({ ...routingFilterForm, name: e.target.value.replace(/\s/g, '') })} /></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control value={routingFilterForm.description} onChange={e => setRoutingFilterForm({ ...routingFilterForm, description: e.target.value })} /></Form.Group></Col>
            </Row>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="fw-bold mb-0">Rules</h6>
              <Button size="sm" variant="outline-primary" onClick={() => setRoutingFilterForm({ ...routingFilterForm, rules: [...routingFilterForm.rules, { route: '', action: 'allow', nextHop: '', priority: routingFilterForm.rules.length }] })}>Add Rule</Button>
            </div>
            {routingFilterForm.rules.map((rule, ridx) => (
              <Row key={ridx} className="align-items-center mb-2">
                <Col md={4}><Form.Control placeholder="Route (IP/mask)" value={rule.route} onChange={e => { const rules = [...routingFilterForm.rules]; rules[ridx] = { ...rule, route: e.target.value }; setRoutingFilterForm({ ...routingFilterForm, rules }); }} /></Col>
                <Col md={3}>
                  <Form.Select value={rule.action} onChange={e => { const rules = [...routingFilterForm.rules]; rules[ridx] = { ...rule, action: e.target.value }; setRoutingFilterForm({ ...routingFilterForm, rules }); }}>
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </Form.Select>
                </Col>
                <Col md={3}><Form.Control placeholder="Next hop" value={rule.nextHop} onChange={e => { const rules = [...routingFilterForm.rules]; rules[ridx] = { ...rule, nextHop: e.target.value }; setRoutingFilterForm({ ...routingFilterForm, rules }); }} /></Col>
                <Col md={1}><Form.Control type="number" placeholder="Pri" value={rule.priority} onChange={e => { const rules = [...routingFilterForm.rules]; rules[ridx] = { ...rule, priority: Number(e.target.value) }; setRoutingFilterForm({ ...routingFilterForm, rules }); }} /></Col>
                <Col md={1}><button className="btn-icon-red" onClick={() => setRoutingFilterForm({ ...routingFilterForm, rules: routingFilterForm.rules.filter((_, i) => i !== ridx) })}><FaTrash /></button></Col>
              </Row>
            ))}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRoutingFilterModal(false)}>Cancel</Button>
          <PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleSaveRoutingFilter} disabled={!routingFilterForm.name}>Save Filter</PermissionButton>
        </Modal.Footer>
      </Modal>
  </>;
}
