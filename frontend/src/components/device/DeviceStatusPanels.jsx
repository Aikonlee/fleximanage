import React from 'react';
import { Spinner } from 'react-bootstrap';
import StatusBadge from '../common/StatusBadge';

export default function DeviceStatusPanels({ activeTab, bgpStatus, currentSubTab, device, routingTable, statistics, statusLoading, vrrpStatus }) {
  return <>
{activeTab === 'status' && currentSubTab === 'apps' && (
          <div className="table-container-template">
            <table className="custom-table-template">
              <thead><tr><th>Identifier</th><th>Status</th></tr></thead>
              <tbody>
                {(device.applications || []).length > 0 ? device.applications.map((app, idx) => (
                  <tr key={idx}><td>{app.identifier}</td><td><StatusBadge status={app.status || 'pending'} /></td></tr>
                )) : (
                  <tr><td colSpan="2" className="text-center text-muted py-4">No applications installed on this device.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
{activeTab === 'status' && currentSubTab === 'bgp-neighbors' && (
          <div>
            {statusLoading ? <Spinner animation="border" size="sm" /> : (
              bgpStatus?.status?.neighbors?.length > 0 ? (
                <div className="table-container-template">
                  <table className="custom-table-template">
                    <thead><tr><th>#</th><th>Neighbor</th></tr></thead>
                    <tbody>
                      {bgpStatus.status.neighbors.map((n, idx) => <tr key={idx}><td>{idx + 1}</td><td>{n}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ) : <div className="global-settings-card text-muted">No live BGP neighbor data available{bgpStatus?.deviceStatus ? ` (device status: ${bgpStatus.deviceStatus})` : ''}.</div>
            )}
          </div>
        )}
{activeTab === 'status' && currentSubTab === 'policies' && (
          <div className="status-kv-grid">
            {['multilink', 'firewall', 'qos'].map((key) => (
              <div className="status-kv-item" key={key}>
                <span className="status-kv-label">{key === 'multilink' ? 'Path Selection Policy' : key === 'firewall' ? 'Firewall Policy' : 'QoS Policy'}</span>
                <span className="status-kv-value"><StatusBadge status={device.policies?.[key]?.status || 'none'} /></span>
              </div>
            ))}
          </div>
        )}
{activeTab === 'status' && currentSubTab === 'routing-table' && (
          <div>
            {statusLoading ? <Spinner animation="border" size="sm" /> : (
              <div className="table-container-template">
                <table className="custom-table-template">
                  <thead><tr><th>Destination</th><th>Gateway</th><th>Interface</th><th>Protocol</th></tr></thead>
                  <tbody>
                    {(routingTable?.osRoutes || []).length > 0 ? routingTable.osRoutes.map((r, idx) => (
                      <tr key={idx}><td>{r.destination || r.route}</td><td>{r.gateway || r.via}</td><td>{r.iface || r.dev}</td><td>{r.protocol || '-'}</td></tr>
                    )) : (
                      <tr><td colSpan="4" className="text-center text-muted py-4">No routing table data available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
{activeTab === 'status' && currentSubTab === 'statistics' && (
          <div>
            {statusLoading ? <Spinner animation="border" size="sm" /> : (
              statistics ? (
                <div className="status-kv-grid">
                  {Object.entries(statistics).filter(([, v]) => typeof v !== 'object').map(([k, v]) => (
                    <div className="status-kv-item" key={k}>
                      <span className="status-kv-label">{k}</span>
                      <span className="status-kv-value">{String(v)}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="global-settings-card text-muted">No statistics available.</div>
            )}
          </div>
        )}
{activeTab === 'status' && currentSubTab === 'vrrp' && (
          <div>
            {statusLoading ? <Spinner animation="border" size="sm" /> : (
              Array.isArray(vrrpStatus) && vrrpStatus.length > 0 ? (
                <div className="table-container-template">
                  <table className="custom-table-template">
                    <thead><tr><th>Group</th><th>VRID</th><th>State</th><th>Priority</th></tr></thead>
                    <tbody>
                      {vrrpStatus.map((v, idx) => (
                        <tr key={idx}><td>{v.name}</td><td>{v.virtualRouterId}</td><td><StatusBadge status={v.state} /></td><td>{v.priority}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="global-settings-card text-muted">No VRRP groups configured for this device.</div>
            )}
          </div>
        )}
  </>;
}
