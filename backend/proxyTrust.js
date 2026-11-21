const configureProxyTrust = app => {
  // Only the loopback reverse proxy may supply the client address.
  app.set('trust proxy', 'loopback');
};

module.exports = configureProxyTrust;
