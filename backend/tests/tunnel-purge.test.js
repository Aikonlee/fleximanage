/** @jest-environment node */
'use strict';

const { spawnSync } = require('child_process');
const {
  DEFAULT_OLDER_THAN_DAYS,
  TUNNELS_COLLECTION,
  SafeToolError,
  parseArgs,
  resolveMongoUri,
  purgeInactiveTunnels,
  runCli
} = require('../tools/purge-inactive-tunnels');

const NOW = new Date('2026-11-22T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo (days) {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

function matchesFilter (doc, filter) {
  for (const [key, condition] of Object.entries(filter)) {
    const value = doc[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if (Object.prototype.hasOwnProperty.call(condition, '$lte')) {
        if (!(value instanceof Date) || value.getTime() > condition.$lte.getTime()) {
          return false;
        }
      } else {
        throw new Error(`Unsupported operator in mock filter for ${key}`);
      }
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

function createMockDb () {
  const tunnelsDocs = [
    {
      _id: 'tun-active-old',
      org: 'org-alpha',
      num: 1,
      isActive: true,
      tunnelKeys: { key1: 'secret-key-1' },
      updatedAt: daysAgo(90)
    },
    {
      _id: 'tun-active-recent',
      org: 'org-alpha',
      num: 2,
      isActive: true,
      tunnelKeys: { key1: 'secret-key-2' },
      updatedAt: daysAgo(2)
    },
    {
      _id: 'tun-inactive-old-1',
      org: 'org-alpha',
      num: 3,
      isActive: false,
      tunnelKeys: null,
      updatedAt: daysAgo(45)
    },
    {
      _id: 'tun-inactive-old-2',
      org: 'org-beta',
      num: 4,
      isActive: false,
      tunnelKeys: null,
      updatedAt: daysAgo(31)
    },
    {
      _id: 'tun-inactive-recent',
      org: 'org-alpha',
      num: 5,
      isActive: false,
      tunnelKeys: null,
      updatedAt: daysAgo(5)
    },
    {
      _id: 'tun-inactive-no-timestamp',
      org: 'org-alpha',
      num: 6,
      isActive: false,
      tunnelKeys: null
    }
  ];

  const tunnelIdsDocs = [
    { _id: 'tid-alpha', org: 'org-alpha', nextAvailID: 10 },
    { _id: 'tid-beta', org: 'org-beta', nextAvailID: 4 }
  ];

  const tunnelsCollection = {
    countDocuments: jest.fn(async (filter) => {
      return tunnelsDocs.filter((doc) => matchesFilter(doc, filter)).length;
    }),
    deleteMany: jest.fn(async (filter) => {
      let deletedCount = 0;
      for (let i = tunnelsDocs.length - 1; i >= 0; i -= 1) {
        if (matchesFilter(tunnelsDocs[i], filter)) {
          tunnelsDocs.splice(i, 1);
          deletedCount += 1;
        }
      }
      return { acknowledged: true, deletedCount };
    })
  };

  const tunnelIdsCollection = {
    countDocuments: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn()
  };

  const db = {
    collection: jest.fn((name) => {
      if (name === TUNNELS_COLLECTION) return tunnelsCollection;
      if (name === 'tunnelids') return tunnelIdsCollection;
      throw new Error(`Unexpected collection requested: ${name}`);
    })
  };

  return {
    db,
    tunnelsDocs,
    tunnelIdsDocs,
    tunnelsCollection,
    tunnelIdsCollection
  };
}

function createBufferStream () {
  let text = '';
  return {
    write: (chunk) => {
      text += String(chunk);
    },
    toString: () => text
  };
}

describe('purge-inactive-tunnels maintenance tool', () => {
  test('dry-run prints candidate counts only, issues no deletes, and leaves all docs untouched',
    async () => {
      const mock = createMockDb();
      const stdout = createBufferStream();
      const stderr = createBufferStream();
      const close = jest.fn().mockResolvedValue();

      const exitCode = await runCli([], {
        env: { MONGO_URL: 'mongodb://user:pass@db.internal:27017/flexiwan?replicaSet=rs' },
        envFilePath: '/nonexistent/backend.env',
        fsModule: { existsSync: () => false },
        connect: async () => ({
          tunnelsCollection: mock.db.collection(TUNNELS_COLLECTION),
          close
        }),
        now: NOW,
        stdout,
        stderr
      });

      expect(exitCode).toBe(0);
      expect(stderr.toString()).toBe('');
      expect(close).toHaveBeenCalledTimes(1);
      expect(mock.tunnelsCollection.deleteMany).not.toHaveBeenCalled();
      expect(mock.db.collection).toHaveBeenCalledWith('tunnels');
      expect(mock.db.collection).not.toHaveBeenCalledWith('tunnelids');

      const summary = JSON.parse(stdout.toString());
      expect(summary).toEqual({
        mode: 'dry-run',
        olderThanDays: DEFAULT_OLDER_THAN_DAYS,
        cutoffIso: daysAgo(DEFAULT_OLDER_THAN_DAYS).toISOString(),
        totalInactive: 4,
        eligibleCount: 2,
        excludedCount: 2,
        deletedCount: 0
      });

      // Output must never leak document contents or database credentials.
      const rawOutput = stdout.toString() + stderr.toString();
      expect(rawOutput).not.toContain('tun-');
      expect(rawOutput).not.toContain('org-alpha');
      expect(rawOutput).not.toContain('secret-key');
      expect(rawOutput).not.toContain('mongodb://');
      expect(rawOutput).not.toContain('user:pass');

      // All records remain intact.
      expect(mock.tunnelsDocs).toHaveLength(6);
      expect(mock.tunnelIdsDocs).toEqual([
        { _id: 'tid-alpha', org: 'org-alpha', nextAvailID: 10 },
        { _id: 'tid-beta', org: 'org-beta', nextAvailID: 4 }
      ]);
    });

  test('--apply without --confirm is refused before connecting and issues no deletes', async () => {
    const connect = jest.fn();
    const stdout = createBufferStream();
    const stderr = createBufferStream();

    const exitCode = await runCli(['--apply'], {
      env: { MONGO_URL: 'mongodb://user:pass@db.internal:27017/flexiwan' },
      connect,
      now: NOW,
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe('');
    expect(stderr.toString()).toContain('--apply requires --confirm=<expected-count>');
  });

  test('--apply with mismatched --confirm issues no deletes and exits non-zero', async () => {
    const mock = createMockDb();
    const stdout = createBufferStream();
    const stderr = createBufferStream();
    const close = jest.fn().mockResolvedValue();

    const exitCode = await runCli(['--apply', '--confirm=7'], {
      env: { MONGO_URL: 'mongodb://user:pass@db.internal:27017/flexiwan' },
      envFilePath: '/nonexistent/backend.env',
      fsModule: { existsSync: () => false },
      connect: async () => ({
        tunnelsCollection: mock.db.collection(TUNNELS_COLLECTION),
        close
      }),
      now: NOW,
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(mock.tunnelsCollection.deleteMany).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe('');
    expect(stderr.toString()).toContain('Confirmation count mismatch: expected 7, found 2');
    expect(mock.tunnelsDocs).toHaveLength(6);
  });

  test('--apply with matching --confirm deletes only aged inactive candidates and ' +
    'never touches active records or tunnelids', async () => {
    const mock = createMockDb();
    const stdout = createBufferStream();
    const stderr = createBufferStream();
    const close = jest.fn().mockResolvedValue();

    const exitCode = await runCli(['--older-than-days=30', '--apply', '--confirm=2'], {
      env: { MONGO_URL: 'mongodb://user:pass@db.internal:27017/flexiwan' },
      envFilePath: '/nonexistent/backend.env',
      fsModule: { existsSync: () => false },
      connect: async () => ({
        tunnelsCollection: mock.db.collection(TUNNELS_COLLECTION),
        close
      }),
      now: NOW,
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stderr.toString()).toBe('');
    expect(close).toHaveBeenCalledTimes(1);
    expect(mock.tunnelsCollection.deleteMany).toHaveBeenCalledTimes(1);
    expect(mock.tunnelsCollection.deleteMany).toHaveBeenCalledWith({
      isActive: false,
      updatedAt: { $lte: daysAgo(30) }
    });

    const summary = JSON.parse(stdout.toString());
    expect(summary).toEqual({
      mode: 'apply',
      olderThanDays: 30,
      cutoffIso: daysAgo(30).toISOString(),
      totalInactive: 4,
      eligibleCount: 2,
      excludedCount: 2,
      deletedCount: 2
    });

    // Only the two aged inactive records were deleted; active, recent inactive, and
    // untimestamped inactive records remain untouched.
    expect(mock.tunnelsDocs.map((d) => d._id)).toEqual([
      'tun-active-old',
      'tun-active-recent',
      'tun-inactive-recent',
      'tun-inactive-no-timestamp'
    ]);

    // tunnelids collection is never accessed or modified.
    expect(mock.db.collection).toHaveBeenCalledTimes(1);
    expect(mock.db.collection).toHaveBeenCalledWith('tunnels');
    for (const fn of Object.values(mock.tunnelIdsCollection)) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(mock.tunnelIdsDocs).toEqual([
      { _id: 'tid-alpha', org: 'org-alpha', nextAvailID: 10 },
      { _id: 'tid-beta', org: 'org-beta', nextAvailID: 4 }
    ]);
  });

  test('--older-than-days adjusts the eligibility window cleanly', async () => {
    const mock = createMockDb();
    const result = await purgeInactiveTunnels(
      { apply: false, confirm: null, olderThanDays: 3 },
      { tunnelsCollection: mock.tunnelsCollection, now: NOW }
    );

    expect(result.eligibleCount).toBe(3);
    expect(result.excludedCount).toBe(1);
    expect(result.deletedCount).toBe(0);
    expect(mock.tunnelsCollection.deleteMany).not.toHaveBeenCalled();
  });

  test.each([
    [['--confirm=2'], '--confirm cannot be used without --apply'],
    [['--apply', '--confirm=0'], '--confirm must be a positive integer'],
    [['--apply', '--confirm=-1'], '--confirm must be a positive integer'],
    [['--apply', '--confirm=abc'], '--confirm must be a positive integer'],
    [['--older-than-days=0'], '--older-than-days must be a positive integer'],
    [['--older-than-days=-5'], '--older-than-days must be a positive integer'],
    [['--older-than-days=1.5'], '--older-than-days must be a positive integer'],
    [['--mongo-uri=mongodb://host/db'], 'Unsupported or ambiguous argument'],
    [['--apply', '--apply', '--confirm=1'], 'Duplicate --apply flag'],
    [['extra-arg'], 'Unsupported or ambiguous argument']
  ])('rejects unsafe or ambiguous arguments %j', (argv, expectedMessage) => {
    expect(() => parseArgs(argv)).toThrow(SafeToolError);
    expect(() => parseArgs(argv)).toThrow(expectedMessage);
  });

  test('resolves MONGO_URL only from service environment config without hardcoded fallback', () => {
    const fromEnvFile = resolveMongoUri({
      env: {},
      envFilePath: '/etc/fleximanage/backend.env',
      fsModule: {
        existsSync: (p) => p === '/etc/fleximanage/backend.env',
        readFileSync: () => 'MONGO_URL=mongodb://u:p@h1:27017,h2:27018/flexiwan?replicaSet=rs\n'
      }
    });
    expect(fromEnvFile).toBe('mongodb://u:p@h1:27017,h2:27018/flexiwan?replicaSet=rs');

    expect(() => resolveMongoUri({
      env: {},
      envFilePath: '/etc/fleximanage/backend.env',
      fsModule: { existsSync: () => false }
    })).toThrow('MONGO_URL is not configured in service environment');

    expect(() => resolveMongoUri({
      env: { MONGO_URL: 'mongodb://u:p@h1:27017/?replicaSet=rs' },
      envFilePath: '/nonexistent/backend.env',
      fsModule: { existsSync: () => false }
    })).toThrow('MONGO_URL must specify an explicit database name');
  });

  test('sanitizes unexpected database errors so connection credentials are never printed',
    async () => {
      const stdout = createBufferStream();
      const stderr = createBufferStream();

      const exitCode = await runCli([], {
        env: { MONGO_URL: 'mongodb://secretuser:secretpass@db.internal:27017/flexiwan' },
        envFilePath: '/nonexistent/backend.env',
        fsModule: { existsSync: () => false },
        connect: async () => {
          const err = new Error('connect ECONNREFUSED mongodb://secretuser:secretpass@db.internal');
          err.name = 'MongoServerSelectionError';
          throw err;
        },
        now: NOW,
        stdout,
        stderr
      });

      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain('MongoServerSelectionError');
      expect(stderr.toString()).not.toContain('secretuser');
      expect(stderr.toString()).not.toContain('secretpass');
    });

  test('CLI subprocess exits non-zero on unsafe flags without accessing any database', () => {
    const scriptPath = require.resolve('../tools/purge-inactive-tunnels');
    const result = spawnSync(process.execPath, [scriptPath, '--apply'], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 5000
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--apply requires --confirm=<expected-count>');
  });
});
