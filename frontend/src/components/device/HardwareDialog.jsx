import React from 'react';
import PermissionButton from '../common/PermissionButton';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import { FaMicrochip, FaInfoCircle } from 'react-icons/fa';

export default function HardwareDialog({ applyingConfig, cpuOptimization, currentVRouterCores, handleApplyHardwareConfig, hwCpuCores, powerSaving, setPowerSaving, setShowHardwareModal, setVRouterCores, showHardwareModal, vRouterCores }) {
  return <>
<Modal show={showHardwareModal} onHide={() => setShowHardwareModal(false)} centered size="lg">
        <Modal.Header closeButton><Modal.Title><FaMicrochip className="me-2" /> Hardware Configuration</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3"><Form.Label>HW CPU cores:</Form.Label><Form.Control type="text" value={hwCpuCores} readOnly className="input-readonly" /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>Current vRouter cores:</Form.Label><Form.Control type="text" value={currentVRouterCores} readOnly className="input-readonly" /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>vRouter cores:</Form.Label><Form.Control type="number" value={vRouterCores} onChange={(e) => setVRouterCores(e.target.value)} min="1" max={hwCpuCores} /></Form.Group>
            {cpuOptimization && <Alert variant={cpuOptimization.optimization?.status === 'optimal' ? 'success' : 'warning'}><h6 className="fw-bold"><FaInfoCircle className="me-2"/> CPU Analysis</h6><p className="small mb-0">{cpuOptimization.optimization?.message}</p></Alert>}
            <Form.Check type="switch" label="Power Saving" checked={powerSaving} onChange={(e) => setPowerSaving(e.target.checked)} />
          </Form>
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowHardwareModal(false)}>Cancel</Button><PermissionButton permKey="devices" method={'put'} variant="primary" onClick={handleApplyHardwareConfig} disabled={applyingConfig}>{applyingConfig ? 'Applying...' : 'Apply Configuration'}</PermissionButton></Modal.Footer>
      </Modal>
  </>;
}
