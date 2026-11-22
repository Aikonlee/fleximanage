import React from 'react';
import './Footer.css';

/* global __BUILD_REV__ */
export const BUILD_REV = typeof __BUILD_REV__ === 'string' && __BUILD_REV__ ? __BUILD_REV__ : 'dev';
export const COPYRIGHT_TEXT = `© OpenSource-OpenNetworking.org 2025.10, All Rights Reserved · Rev ${BUILD_REV}`;

const Footer = () => {
  return (
    <footer className="app-footer">
      <div className="footer-divider"></div>
      <div className="footer-content">
        <span className="footer-copyright">
          {COPYRIGHT_TEXT}
        </span>
        <a 
          href="https://docs.flexiwan.com/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="footer-link"
        >
          Documentation
        </a>
      </div>
    </footer>
  );
};

export default Footer;
