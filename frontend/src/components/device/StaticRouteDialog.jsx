import React from 'react';
import PermissionButton from '../common/PermissionButton';
import { Modal, Form, Button, Row, Col } from 'react-bootstrap';
import { FaSave } from 'react-icons/fa';

export default function StaticRouteDialog({ device, editingRoute, handleSaveRoute, routeForm, setRouteForm, setShowRouteModal, showRouteModal }) {
  return <>
<Modal show={showRouteModal} onHide={() => setShowRouteModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title>{editingRoute ? 'Edit Route' : 'Add Route'}</Modal.Title></Modal.Header>
        <Modal.Body><Form><Row><Col md={6}><Form.Group className="mb-3"><Form.Label>Destination Network</Form.Label><Form.Control value={routeForm.destination} onChange={e => setRouteForm({...routeForm, destination: e.target.value})} placeholder="192.168.10.0/24" /></Form.Group></Col><Col md={6}><Form.Group className="mb-3"><Form.Label>Gateway</Form.Label><Form.Control value={routeForm.gateway} onChange={e => setRouteForm({...routeForm, gateway: e.target.value})} placeholder="192.168.1.1" /></Form.Group></Col></Row><Row><Col md={6}><Form.Group className="mb-3"><Form.Label>Interface (optional)</Form.Label><Form.Select value={routeForm.ifname} onChange={e => setRouteForm({...routeForm, ifname: e.target.value})}><option value="">Auto (derive from gateway subnet)</option>{(device?.interfaces || []).map(i => <option key={i._id} value={i.devId || i.name}>{i.name}</option>)}</Form.Select><Form.Text className="text-muted">The outgoing interface. Optional if the gateway is within a subnet of one of the router interfaces.</Form.Text></Form.Group></Col><Col md={6}><Form.Group className="mb-3"><Form.Label>Metric (optional)</Form.Label><Form.Control value={routeForm.metric} onChange={e => setRouteForm({...routeForm, metric: e.target.value})} /></Form.Group></Col></Row><Form.Check label="Redistribute OSPF" checked={routeForm.redistributeViaOSPF} onChange={e => setRouteForm({...routeForm, redistributeViaOSPF: e.target.checked})} /><Form.Check label="Redistribute BGP" checked={routeForm.redistributeViaBGP} onChange={e => setRouteForm({...routeForm, redistributeViaBGP: e.target.checked})} /></Form></Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowRouteModal(false)}>Cancel</Button><PermissionButton permKey="devices" method={editingRoute ? 'patch' : 'post'} variant="primary" onClick={handleSaveRoute}><FaSave className="me-2"/>Save Route</PermissionButton></Modal.Footer>
      </Modal>
  </>;
}
