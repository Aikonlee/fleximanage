const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Determine backend target based on environment. REACT_APP_API_TARGET lets
  // docker-compose setups point this at the 'backend' service by name; outside
  // of that (bare-metal/local dev) it must fall back to the real backend port,
  // not the docker-only hostname, or every relative /api/* request 500s.
  const backendTarget = process.env.REACT_APP_API_TARGET || 'https://localhost:3443';

  console.log('Frontend proxy target:', backendTarget);

  app.use(
    '/api',
    createProxyMiddleware({
      target: backendTarget,
      changeOrigin: true,
      secure: false, // Bypass SSL certificate verification for dev
      logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
      timeout: 30000, // 30 second timeout
      pathRewrite: {
        // Don't rewrite the path - keep /api prefix
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Proxy connection failed' });
        }
      },
      onProxyReq: (proxyReq, req, res) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('Proxying request:', req.method, req.url);
        }
      },
      onProxyRes: (proxyRes, req, res) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('Proxy response:', proxyRes.statusCode, req.url);
        }
      }
    })
  );
  
  // WebSocket proxy for real-time features
  app.use(
    '/ws',
    createProxyMiddleware({
      target: backendTarget.replace('http:', 'ws:'),
      ws: true,
      changeOrigin: true,
      logLevel: 'info'
    })
  );
};