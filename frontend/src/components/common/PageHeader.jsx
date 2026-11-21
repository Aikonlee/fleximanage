import React from 'react';
import Breadcrumb from './Breadcrumb';
import './PageHeader.css';

// Matches flexiWAN 6.5.1 page chrome: breadcrumb, bold black title, actions row.
const PageHeader = ({ breadcrumb, title, actions }) => (
  <div className="flexi-page-header">
    {breadcrumb && <Breadcrumb items={breadcrumb} />}
    <div className="flexi-page-header-row">
      <h1 className="flexi-page-title">{title}</h1>
      {actions && <div className="flexi-page-actions">{actions}</div>}
    </div>
  </div>
);

export default PageHeader;
