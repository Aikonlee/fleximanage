/* Local dependency interoperability smoke checks; no real device or external messages. */
const assert = require('assert/strict');
const crypto = require('crypto');
const kue = require('kue');
require('dotenv').config({ path: '.env', quiet: true });
const { generateRemoteVpnPKI } = require('../utils/certificates');
async function main() {
  const keys = await generateRemoteVpnPKI('e2e-runtime');
  const ca = new crypto.X509Certificate(keys.caCert);
  for (const prefix of ['server', 'client']) {
    const cert = new crypto.X509Certificate(keys[prefix + 'Cert']);
    assert.ok(cert.checkPrivateKey(crypto.createPrivateKey(keys[prefix + 'Key'])));
    assert.ok(cert.verify(ca.publicKey));
  }
  console.log('PASS VPN certificate generation and key/CA verification');
  const prefix = 'e2e-runtime-' + Date.now();
  const queue = kue.createQueue({ prefix, redis: process.env.REDIS_URL });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Queue processing timed out')), 15000);
    queue.on('error', reject);
    queue.process('dependency-smoke', (job, done) => done(null, { ok: true }));
    const job = queue.create('dependency-smoke', { label: 'dependency interop' });
    job.on('complete', () => job.remove(error => {
      clearTimeout(timer); if (error) reject(error); else resolve();
    }));
    job.save(error => { if (error) reject(error); });
  });
  await new Promise((resolve, reject) => queue.shutdown(5000, error => error ? reject(error) : resolve()));
  console.log('PASS Redis-backed job create/process/complete/remove with upgraded dependencies');
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
