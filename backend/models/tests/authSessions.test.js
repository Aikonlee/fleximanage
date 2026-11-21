/** @jest-environment node */
jest.mock('../../mongoConns', () => {
  const mongoose = require('mongoose');
  const main = mongoose.createConnection();
  return () => ({ getMainDB: () => main });
});
const Sessions = require('../authSessions');

test('session IDs are unique and expired session records have a TTL index', () => {
  const indexes = Sessions.schema.indexes();
  expect(indexes).toEqual(expect.arrayContaining([
    [{ sid: 1 }, expect.objectContaining({ unique: true })],
    [{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]
  ]));
  expect(Sessions.schema.path('refreshHash').options.select).toBe(false);
});
