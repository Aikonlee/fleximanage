import React from 'react';
import PageHeader from '../components/common/PageHeader';

// Placeholder for menu pages not yet built out in this pass. Tracked as
// backlog in /root/.claude/plans/structured-chasing-clover.md (Phase B/C).
const ComingSoon = ({ title, breadcrumb, message }) => (
  <div className="page-container">
    <PageHeader breadcrumb={breadcrumb} title={title} />
    <div className="card">
      <div className="card-body text-center text-muted py-5">
        <p className="mb-0">{message || 'This page is on the implementation backlog and isn\'t built out yet.'}</p>
      </div>
    </div>
  </div>
);

export default ComingSoon;
