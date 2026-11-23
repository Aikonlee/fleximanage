import React from 'react';
import './Footer.css';

/* global __BUILD_REV__ */
export const BUILD_REV = typeof __BUILD_REV__ === 'string' && __BUILD_REV__ ? __BUILD_REV__ : 'dev';
export const COPYRIGHT_TEXT = `© OpenSource-OpenNetworking.org 2025.10, All Rights Reserved · Rev ${BUILD_REV}`;
export const DOCS_URL = '/docs/index.html';

export const CopyrightLine = ({ linkClassName = 'text-reset' } = {}) => (
  <>
    <span>{COPYRIGHT_TEXT}</span>
    {' · '}
    <a
      href={DOCS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={linkClassName}
    >
      documentation
    </a>
  </>
);

const Footer = () => {
  return (
    <footer className="app-footer">
      <div className="footer-divider"></div>
      <div className="footer-content">
        <span className="footer-copyright">
          <CopyrightLine linkClassName="footer-link" />
        </span>
      </div>
    </footer>
  );
};

export default Footer;
