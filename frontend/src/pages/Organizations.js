import PermissionButton from '../components/common/PermissionButton';
import { decodeJwtPayload } from '../auth/permissions';
import { useAuth } from '../auth/AuthContext';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Card, Alert, Modal, Row, Col } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash, FaEye, FaCheck } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './Organizations.css';
import '../styles/unified-table.css';

const Organizations = () => {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [settingOrg, setSettingOrg] = useState(null);
  const [currentOrgId, setCurrentOrgId] = useState(null);
  const navigate = useNavigate();
  const { orgId } = useAuth();
  useEffect(() => { setCurrentOrgId(orgId); }, [orgId]);

  useEffect(() => {
    // Get current org from JWT token
    const loadCurrentOrg = () => {
      try {
        const token = localStorage.getItem('token');
        if (token) {
          const payload = decodeJwtPayload(token);
          if (payload.org) {
            setCurrentOrgId(payload.org);
          }
        }
      } catch (error) {
        console.error('Error reading org from token:', error);
        // Fallback: fetch from API
        fetchCurrentUser();
      }
    };

    loadCurrentOrg();
    fetchOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const response = await api.get('/users/current');
      const user = response.data;
      if (user.defaultOrg) {
        setCurrentOrgId(user.defaultOrg._id || user.defaultOrg);
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  const fetchOrganizations = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.get('/organizations');
      console.log('Fetched organizations:', response.data);
      
      setOrganizations(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch (error) {
      console.error('Error fetching organizations:', error);
      setError(error.message || 'Failed to fetch organizations');
    } finally {
      setLoading(false);
    }
  };

  const handleNewOrganization = () => {
    navigate('/organizations/add');
  };

  const handleEditOrganization = (orgId) => {
    navigate(`/organizations/edit/${orgId}`);
  };

  const handleDeleteOrganization = (orgId) => {
    const org = organizations.find(o => (o._id || o.id) === orgId);
    setSelectedOrg(org);
    setShowDeleteModal(true);
  };

  const handleViewOrganization = (orgId) => {
    const org = organizations.find(o => (o._id || o.id) === orgId);
    setSelectedOrg(org);
    setShowViewModal(true);
  };

  const confirmDelete = async () => {
    if (!selectedOrg) return;
    
    setDeleting(true);
    try {
      const orgIdToDelete = selectedOrg._id || selectedOrg.id;
      const originalOrgId = currentOrgId; // Save the original current org ID
      const isDeletingCurrentOrg = (currentOrgId === orgIdToDelete);
      
      // Backend requires the organization to be selected before deletion
      // Temporarily set this organization as current if it's not already
      if (!isDeletingCurrentOrg) {
        await api.post('/organizations/select', { org: orgIdToDelete });
      }
      
      // Now delete the organization
      // Backend will automatically select a new org and return new JWT via Refresh-JWT header
      await api.delete(`/organizations/${orgIdToDelete}`);

      // If we deleted a non-current org, restore the original current org
      if (!isDeletingCurrentOrg && originalOrgId) {
        // Restore the original organization selection
        await api.post('/organizations/select', { org: originalOrgId });
        setCurrentOrgId(originalOrgId);
      } else {
        // We deleted the current org, so read the new current org from the JWT token
        try {
          const token = localStorage.getItem('token');
          if (token) {
            const payload = decodeJwtPayload(token);
            if (payload.org) {
              setCurrentOrgId(payload.org);
            } else {
              setCurrentOrgId(null);
            }
          }
        } catch (err) {
          console.error('Error reading org from token:', err);
          setCurrentOrgId(null);
        }
      }
      
      setShowDeleteModal(false);
      setSelectedOrg(null);
      
      // Reload organizations list to reflect the deletion
      fetchOrganizations();
      
    } catch (error) {
      console.error('Error deleting organization:', error);
      setError('Failed to delete organization: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleSetOrganization = async (orgId) => {
    const org = organizations.find(o => (o._id || o.id) === orgId);
    if (!org) return;

    setSettingOrg(orgId);
    try {
      await api.post('/organizations/select', { org: orgId });

      // Clear any previous errors - no alert popup
      setError(null);
      
    } catch (error) {
      console.error('Error setting organization:', error);
      setError('Failed to set organization: ' + error.message);
    } finally {
      setSettingOrg(null);
    }
  };

  if (loading) {
    return <div className="text-center p-5"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div><p className="mt-2 text-muted">Loading organizations...</p></div>;
  }

  if (error) {
    return (
      <div className="organizations-page p-3 p-md-4">
        <PageHeader
          breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Account' }, { label: 'Organizations' }]}
          title="Organizations"
        />
        <Alert variant="danger" className="shadow-sm">
          <Alert.Heading>Error Loading Organizations</Alert.Heading>
          <p>{error}</p>
          <Button variant="outline-danger" onClick={fetchOrganizations}>
            Try Again
          </Button>
        </Alert>
      </div>
    );
  }

  return (
    <div className="organizations-page p-3 p-md-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Account' }, { label: 'Organizations' }]}
        title="Organizations"
        actions={(
          <PermissionButton permKey="organizations" method={'post'} variant="primary" onClick={handleNewOrganization} className="shadow-sm d-flex align-items-center">
            <FaPlus className="me-2" />
            New Organization
          </PermissionButton>
        )}
      />

      <Card className="shadow-sm border-0">
        <Card.Body className="p-0">
          {organizations.length > 0 ? (
            <Table responsive hover className="unified-table mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Group</th>
                  <th>Tunnels Key</th>
                  <th>VXLAN Port</th>
                  <th>Tunnel Range</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => {
                  const orgId = org._id || org.id;
                  const isCurrent = currentOrgId === orgId;
                  return (
                    <tr key={orgId} className={isCurrent ? "table-success bg-opacity-10" : ""}>
                      <td>
                        <strong>{org.name}</strong>
                        {isCurrent && <span className="badge bg-success ms-2">Current</span>}
                      </td>
                      <td>{org.description || '-'}</td>
                      <td>{org.group || '-'}</td>
                      <td>{org.encryptionMethod || 'PSK'}</td>
                      <td>{org.vxlanPort || '4789'}</td>
                      <td>{org.tunnelRange ? `${org.tunnelRange}/16` : '-'}</td>
                      <td>
                      <div className="action-buttons" style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'nowrap',
                        gap: '5px',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}>
                        <Button
                          variant={isCurrent ? "success" : "outline-success"}
                          size="sm"
                          onClick={() => handleSetOrganization(orgId)}
                          title={isCurrent ? "Current Organization" : "Set as Current Organization"}
                          disabled={isCurrent || !!settingOrg}
                          style={{ minWidth: '35px' }}
                        >
                          {settingOrg === orgId ? <span className="spinner-border spinner-border-sm" /> : <FaCheck />}
                        </Button>
                        <Button
                          variant="outline-info"
                          size="sm"
                          onClick={() => handleViewOrganization(org._id || org.id)}
                          title="View"
                          style={{ minWidth: '35px' }}
                        >
                          <FaEye />
                        </Button>
                        <PermissionButton permKey="organizations" method={'put'}
                          variant="outline-primary"
                          size="sm"
                          onClick={() => handleEditOrganization(org._id || org.id)}
                          title="Edit"
                          style={{ minWidth: '35px' }}
                        >
                          <FaEdit />
                        </PermissionButton>
                        <PermissionButton permKey="organizations" method={'delete'}
                          variant="outline-danger"
                          size="sm"
                          onClick={() => handleDeleteOrganization(orgId)}
                          title="Delete"
                          style={{ minWidth: '35px' }}
                        >
                          <FaTrash />
                        </PermissionButton>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <div className="text-center p-5">
              <Alert variant="info" className="d-inline-block shadow-sm">
                No organizations found. Click "New Organization" to create one.
              </Alert>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* View Organization Modal */}
      <Modal show={showViewModal} onHide={() => setShowViewModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold text-primary">Organization Details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedOrg && (
            <Row>
              <Col md={6}>
                <div className="mb-3">
                  <strong className="text-muted small text-uppercase">Name</strong>
                  <div className="fw-bold">{selectedOrg.name}</div>
                </div>
                <div className="mb-3">
                  <strong className="text-muted small text-uppercase">Group</strong>
                  <div>{selectedOrg.group || '-'}</div>
                </div>
                <div className="mb-3">
                  <strong className="text-muted small text-uppercase">VXLAN Port</strong>
                  <div>{selectedOrg.vxlanPort || '4789'}</div>
                </div>
              </Col>
              <Col md={6}>
                <div className="mb-3">
                  <strong className="text-muted small text-uppercase">Tunnels Key Exchange Method</strong>
                  <div>{selectedOrg.encryptionMethod || 'PSK'}</div>
                </div>
                <div className="mb-3">
                  <strong className="text-muted small text-uppercase">Tunnel Range</strong>
                  <div>{selectedOrg.tunnelRange ? `${selectedOrg.tunnelRange}/16` : '-'}</div>
                </div>
              </Col>
              <Col md={12}>
                <div className="mb-3 p-3 bg-light rounded border">
                  <strong className="text-muted small text-uppercase d-block mb-1">Description</strong>
                  <div>{selectedOrg.description || '-'}</div>
                </div>
              </Col>
            </Row>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowViewModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title className="text-danger fw-bold">Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedOrg && (
            <>
              <p>Are you sure you want to delete the organization <strong>"{selectedOrg.name}"</strong>?</p>
              <Alert variant="warning" className="shadow-sm border-warning">
                <strong>Warning:</strong> This action cannot be undone. All data associated with this organization will be permanently deleted.
              </Alert>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
            Cancel
          </Button>
          <PermissionButton permKey="organizations" method={'delete'} variant="danger" onClick={confirmDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete Organization'}
          </PermissionButton>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default Organizations;