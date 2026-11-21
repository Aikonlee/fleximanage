/** @jest-environment node */
// Requiring the user model calls mongoConns(), which opens live connections.
// Keep this mock aligned with tools/test-models-setup.cjs so tests stay offline.
jest.mock('../mongoConns', () => {
  const mongoose = require('mongoose');
  const main = mongoose.createConnection();
  const analytics = mongoose.createConnection();
  const vpn = mongoose.createConnection();
  return () => ({
    getMainDB: () => main,
    getAnalyticsDB: () => analytics,
    getVpnDB: () => vpn
  });
});

const User = require('../models/users');
const {
  VERIFY_TTL_MS,
  RESET_PASSWORD_TTL_MS,
  verifyIssuedAtQuery,
  resetPasswordIssuedAtQuery
} = require('../utils/emailTokenExpiry');

const FROZEN_NOW = new Date('2026-06-15T12:00:00.000Z');

const userWithTokens = (emailTokens) => new User({
  name: 'Jean Marc',
  lastName: 'Smith',
  email: 'john.smith@company.com',
  username: 'john.smith@company.com',
  jobTitle: 'Engineer',
  phoneNumber: '+1-208-7979791',
  state: 'unverified',
  emailTokens
});

// A missing issued-at is null and must fail the MongoDB $gte comparison.
const matchesGte = (value, query) => {
  if (value == null || !(query.$gte instanceof Date)) return false;
  const time = value instanceof Date ? value.getTime() : NaN;
  return !Number.isNaN(time) && time >= query.$gte.getTime();
};

describe('email token expiry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('issued-at queries are one TTL before now', () => {
    const verifyQuery = verifyIssuedAtQuery();
    const resetQuery = resetPasswordIssuedAtQuery();

    expect(verifyQuery.$gte).toBeInstanceOf(Date);
    expect(resetQuery.$gte).toBeInstanceOf(Date);
    expect(Date.now() - verifyQuery.$gte.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(Date.now() - resetQuery.$gte.getTime()).toBe(60 * 60 * 1000);
    expect(verifyQuery.$gte.toISOString()).toBe('2026-06-14T12:00:00.000Z');
    expect(resetQuery.$gte.toISOString()).toBe('2026-06-15T11:00:00.000Z');
  });

  test('TTL constants are 24 hours and 1 hour', () => {
    expect(VERIFY_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(RESET_PASSWORD_TTL_MS).toBe(60 * 60 * 1000);
  });

  test('verifyIssuedAt satisfies $gte only when set and within 24h', () => {
    const query = verifyIssuedAtQuery();
    const fresh = userWithTokens({
      verify: 'verify-token',
      verifyIssuedAt: new Date()
    });
    const missing = userWithTokens({
      verify: 'verify-token',
      verifyIssuedAt: null
    });
    const stale = userWithTokens({
      verify: 'verify-token',
      verifyIssuedAt: new Date(Date.now() - VERIFY_TTL_MS - 1)
    });

    expect(fresh.emailTokens.verify).toBe('verify-token');
    expect(matchesGte(fresh.emailTokens.verifyIssuedAt, query)).toBe(true);
    expect(missing.emailTokens.verifyIssuedAt).toBeNull();
    expect(matchesGte(missing.emailTokens.verifyIssuedAt, query)).toBe(false);
    expect(matchesGte(stale.emailTokens.verifyIssuedAt, query)).toBe(false);
  });

  test('resetPasswordIssuedAt satisfies $gte only when set and within 1h', () => {
    const query = resetPasswordIssuedAtQuery();
    const fresh = userWithTokens({
      resetPassword: 'reset-token',
      resetPasswordIssuedAt: new Date()
    });
    const missing = userWithTokens({
      resetPassword: 'reset-token',
      resetPasswordIssuedAt: null
    });
    const stale = userWithTokens({
      resetPassword: 'reset-token',
      resetPasswordIssuedAt: new Date(Date.now() - RESET_PASSWORD_TTL_MS - 1)
    });

    expect(fresh.emailTokens.resetPassword).toBe('reset-token');
    expect(matchesGte(fresh.emailTokens.resetPasswordIssuedAt, query)).toBe(true);
    expect(missing.emailTokens.resetPasswordIssuedAt).toBeNull();
    expect(matchesGte(missing.emailTokens.resetPasswordIssuedAt, query)).toBe(false);
    expect(matchesGte(stale.emailTokens.resetPasswordIssuedAt, query)).toBe(false);
  });
});
