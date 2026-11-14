import React from 'react';
import { Link } from 'react-router-dom';
import './Breadcrumb.css';

// items: [{ label, path? }] - last item renders as plain text (current page)
const Breadcrumb = ({ items = [] }) => (
  <nav className="flexi-breadcrumb" aria-label="breadcrumb">
    {items.map((item, idx) => {
      const isLast = idx === items.length - 1;
      return (
        <span key={`${item.label}-${idx}`} className="flexi-breadcrumb-segment">
          {idx > 0 && <span className="flexi-breadcrumb-sep">»</span>}
          {!isLast && item.path ? (
            <Link to={item.path} className="flexi-breadcrumb-link">{item.label}</Link>
          ) : (
            <span className="flexi-breadcrumb-current">{item.label}</span>
          )}
        </span>
      );
    })}
  </nav>
);

export default Breadcrumb;
