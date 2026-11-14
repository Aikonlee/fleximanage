import React from 'react';
import PermissionButton from '../common/PermissionButton';

export default function DeviceTroubleshootingPanels({ activeTab, currentSubTab, device, deviceLogs, fetchDeviceLogs, logsLoading, performAction, syncing }) {
  return <>
{activeTab === 'troubleshooting' && currentSubTab === 'command' && (
          <div className="global-settings-card">
            <h6 className="fw-bold mb-3">Device Commands</h6>
            <div className="d-flex gap-2 flex-wrap">
              <PermissionButton permKey="devices" method={'post'} native className="btn-template btn-gray" onClick={() => performAction('sync')} disabled={syncing}>Sync Device</PermissionButton>
              <PermissionButton permKey="devices" method={'post'} native className="btn-template btn-gray" onClick={() => performAction('reset')} disabled={syncing}>Reset Device</PermissionButton>
            </div>
            <p className="text-muted small mt-3 mb-0">Commands are queued as device jobs and applied over the device's websocket connection.</p>
          </div>
        )}
{activeTab === 'troubleshooting' && currentSubTab === 'edge-setting' && (
          <div className="global-settings-card">
            <h6 className="fw-bold mb-3">flexiEdge Local UI</h6>
            <p className="text-muted">Access the device's local troubleshooting UI directly, if reachable on its management IP.</p>
          </div>
        )}
{activeTab === 'troubleshooting' && currentSubTab === 'logs' && (
          <div className="global-settings-card">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Device Logs</h6>
              <button className="btn-template btn-save-gray" onClick={fetchDeviceLogs} disabled={logsLoading}>{logsLoading ? 'Loading...' : 'Refresh'}</button>
            </div>
            <pre className="device-logs-view">
              {Array.isArray(deviceLogs?.logs) ? deviceLogs.logs.join('\n') : (deviceLogs ? JSON.stringify(deviceLogs, null, 2) : 'No logs loaded yet.')}
            </pre>
          </div>
        )}
{activeTab === 'troubleshooting' && currentSubTab === 'packet-traces' && (
          <div className="global-settings-card text-muted">
            Packet trace capture is not implemented in this build yet.
          </div>
        )}
{activeTab === 'troubleshooting' && currentSubTab === 'recovery-info' && (
          <div className="status-kv-grid">
            <div className="status-kv-item"><span className="status-kv-label">Sync State</span><span className="status-kv-value">{device.sync?.state || 'unknown'}</span></div>
            <div className="status-kv-item"><span className="status-kv-label">Last Sync Hash</span><span className="status-kv-value">{device.sync?.hash || '-'}</span></div>
            <div className="status-kv-item"><span className="status-kv-label">Sync Trials</span><span className="status-kv-value">{device.sync?.trials ?? '-'}</span></div>
          </div>
        )}
  </>;
}
