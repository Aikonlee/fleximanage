import React from 'react';

// Maps common flexiManage status strings to the status-* classes defined in theme.css
const STATUS_CLASS_MAP = {
  connected: 'status-connected',
  running: 'status-running',
  complete: 'status-running',
  approved: 'status-approved',
  disconnected: 'status-disconnected',
  failed: 'status-disconnected',
  error: 'status-disconnected',
  denied: 'status-disconnected',
  stopped: 'status-stopped',
  na: 'status-stopped',
  pending: 'status-pending',
  installing: 'status-pending',
};

const StatusBadge = ({ status, label }) => {
  const key = (status || '').toString().toLowerCase();
  const cls = STATUS_CLASS_MAP[key] || 'status-stopped';
  return <span className={`status-indicator ${cls}`}>{label || status}</span>;
};

export default StatusBadge;
