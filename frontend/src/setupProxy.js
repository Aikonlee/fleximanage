const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Determine backend target based on environment
  const backendTarget = process.env.NODE_ENV === 'production' 
    ? 'http://backend:8000'  // Production-dev mode: use service name
    : process.env.REACT_APP_API_TARGET || 'http://backend:8000'; // Development: use internal service name for proxy

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