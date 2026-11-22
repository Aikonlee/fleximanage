#!/usr/bin/env node
'use strict';

const fs = require('fs');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');

const DEFAULT_ENV_FILE = '/etc/fleximanage/backend.env';
const DEFAULT_OLDER_THAN_DAYS = 30;
const MAX_OLDER_THAN_DAYS = 36500;
const TUNNELS_COLLECTION = 'tunnels';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

class SafeToolError extends Error {
  constructor (message) {
    super(message);
    this.name = 'SafeToolError';
  }
}

function parsePositiveInt (raw, flagName) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    throw new SafeToolError(`${flagName} must be a positive integer`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SafeToolError(`${flagName} must be a positive integer`);
  }
  return value;
}

function parseArgs (argv) {
  const options = {
    apply: false,
    confirm: null,
    olderThanDays: DEFAULT_OLDER_THAN_DAYS,
    help: false
  };

  let seenApply = false;
  let seenConfirm = false;
  let seenOlderThanDays = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--apply') {
      if (seenApply) {
        throw new SafeToolError('Duplicate --apply flag');
      }
      seenApply = true;
      options.apply = true;
      continue;
    }

    if (arg.startsWith('--confirm=')) {
      if (seenConfirm) {
        throw new SafeToolError('Duplicate --confirm flag');
      }
      seenConfirm = true;
      options.confirm = parsePositiveInt(arg.slice('--confirm='.length), '--confirm');
      continue;
    }

    if (arg.startsWith('--older-than-days=')) {
      if (seenOlderThanDays) {
        throw new SafeToolError('Duplicate --older-than-days flag');
      }
      seenOlderThanDays = true;
      const days = parsePositiveInt(
        arg.slice('--older-than-days='.length),
        '--older-than-days'
      );
      if (days > MAX_OLDER_THAN_DAYS) {
        throw new SafeToolError(
          `--older-than-days must not exceed ${MAX_OLDER_THAN_DAYS}`
        );
      }
      options.olderThanDays = days;
      continue;
    }

    throw new SafeToolError(`Unsupported or ambiguous argument: ${arg}`);
  }

  if (options.help) {
    return options;
  }

  if (options.apply && options.confirm === null) {
    throw new SafeToolError('--apply requires --confirm=<expected-count>');
  }

  if (!options.apply && options.confirm !== null) {
    throw new SafeToolError('--confirm cannot be used without --apply');
  }

  return options;
}

function extractDatabaseName (mongoUri) {
  if (typeof mongoUri !== 'string' || !/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
    return '';
  }
  const withoutScheme = mongoUri.replace(/^mongodb(\+srv)?:\/\//, '');
  const withoutQuery = withoutScheme.split('?')[0];
  const slashIndex = withoutQuery.indexOf('/');
  if (slashIndex === -1) {
    return '';
  }
  return withoutQuery.slice(slashIndex + 1).trim();
}

function resolveMongoUri ({
  env = process.env,
  envFilePath = DEFAULT_ENV_FILE,
  fsModule = fs,
  dotenvModule = dotenv
} = {}) {
  let uri = typeof env.MONGO_URL === 'string' ? env.MONGO_URL.trim() : '';

  if (!uri && envFilePath && fsModule.existsSync(envFilePath)) {
    const parsed = dotenvModule.parse(fsModule.readFileSync(envFilePath, 'utf8'));
    if (typeof parsed.MONGO_URL === 'string') {
      uri = parsed.MONGO_URL.trim();
    }
  }

  if (!uri) {
    throw new SafeToolError('MONGO_URL is not configured in service environment');
  }

  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new SafeToolError('MONGO_URL must use a mongodb:// or mongodb+srv:// scheme');
  }

  const dbName = extractDatabaseName(uri);
  if (!dbName) {
    throw new SafeToolError('MONGO_URL must specify an explicit database name');
  }

  return uri;
}

function buildInactiveFilter (cutoffDate) {
  if (!(cutoffDate instanceof Date) || Number.isNaN(cutoffDate.getTime())) {
    throw new SafeToolError('Invalid cutoff date');
  }
  return {
    isActive: false,
    updatedAt: { $lte: cutoffDate }
  };
}

async function purgeInactiveTunnels (options, { tunnelsCollection, now = new Date() }) {
  if (!tunnelsCollection) {
    throw new SafeToolError('Tunnels collection handle is required');
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new SafeToolError('Invalid reference timestamp');
  }

  const olderThanDays = options.olderThanDays;
  if (!Number.isSafeInteger(olderThanDays) || olderThanDays < 1 ||
      olderThanDays > MAX_OLDER_THAN_DAYS) {
    throw new SafeToolError('Invalid olderThanDays value');
  }

  const apply = Boolean(options.apply);
  const confirm = options.confirm === undefined ? null : options.confirm;

  if (apply && (!Number.isSafeInteger(confirm) || confirm < 1)) {
    throw new SafeToolError('--apply requires a positive integer --confirm count');
  }
  if (!apply && confirm !== null) {
    throw new SafeToolError('--confirm cannot be used without --apply');
  }

  const cutoffDate = new Date(now.getTime() - olderThanDays * MS_PER_DAY);
  const totalInactiveFilter = { isActive: false };
  const eligibleFilter = buildInactiveFilter(cutoffDate);

  const totalInactive = await tunnelsCollection.countDocuments(totalInactiveFilter);
  const eligibleCount = await tunnelsCollection.countDocuments(eligibleFilter);
  const excludedCount = Math.max(0, totalInactive - eligibleCount);

  if (!apply) {
    return {
      mode: 'dry-run',
      olderThanDays,
      cutoffIso: cutoffDate.toISOString(),
      totalInactive,
      eligibleCount,
      excludedCount,
      deletedCount: 0
    };
  }

  if (eligibleCount === 0) {
    throw new SafeToolError('No eligible inactive tunnels match the purge criteria');
  }

  if (eligibleCount !== confirm) {
    throw new SafeToolError(
      `Confirmation count mismatch: expected ${confirm}, found ${eligibleCount}`
    );
  }

  const deleteResult = await tunnelsCollection.deleteMany(eligibleFilter);
  const deletedCount = deleteResult && typeof deleteResult.deletedCount === 'number'
    ? deleteResult.deletedCount
    : -1;

  if (deletedCount !== confirm) {
    throw new SafeToolError(
      `Unexpected delete count: expected ${confirm}, deleted ${deletedCount}`
    );
  }

  return {
    mode: 'apply',
    olderThanDays,
    cutoffIso: cutoffDate.toISOString(),
    totalInactive,
    eligibleCount,
    excludedCount,
    deletedCount
  };
}

function formatSummary (result) {
  return JSON.stringify({
    mode: result.mode,
    olderThanDays: result.olderThanDays,
    cutoffIso: result.cutoffIso,
    totalInactive: result.totalInactive,
    eligibleCount: result.eligibleCount,
    excludedCount: result.excludedCount,
    deletedCount: result.deletedCount
  }) + '\n';
}

function getUsageText () {
  return [
    'Usage: node backend/tools/purge-inactive-tunnels.js [options]',
    '',
    'Read-only by default. Prints aggregate candidate counts only.',
    '',
    'Options:',
    '  --older-than-days=<n>   Exclude soft deletes newer than <n> days ' +
      `(default: ${DEFAULT_OLDER_THAN_DAYS})`,
    '  --apply                 Delete eligible inactive tunnels (requires --confirm)',
    '  --confirm=<count>       Must exactly match the eligible candidate count',
    '  -h, --help              Show this help message',
    ''
  ].join('\n');
}

async function defaultConnect (mongoUri) {
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000
  });
  await client.connect();
  const db = client.db();
  return {
    tunnelsCollection: db.collection(TUNNELS_COLLECTION),
    close: () => client.close()
  };
}

async function runCli (argv, {
  env = process.env,
  envFilePath = DEFAULT_ENV_FILE,
  fsModule = fs,
  dotenvModule = dotenv,
  connect = defaultConnect,
  now = new Date(),
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  let connection = null;
  try {
    const options = parseArgs(argv);
    if (options.help) {
      stdout.write(getUsageText());
      return 0;
    }

    const mongoUri = resolveMongoUri({ env, envFilePath, fsModule, dotenvModule });
    connection = await connect(mongoUri);
    const result = await purgeInactiveTunnels(options, {
      tunnelsCollection: connection.tunnelsCollection,
      now
    });
    stdout.write(formatSummary(result));
    return 0;
  } catch (error) {
    // Never print raw database error messages: they may contain connection credentials.
    const detail = error instanceof SafeToolError
      ? error.message
      : (error && error.name ? error.name : 'Error');
    stderr.write(`Inactive tunnel purge aborted (${detail}).\n`);
    return 1;
  } finally {
    if (connection && typeof connection.close === 'function') {
      try {
        await connection.close();
      } catch (_closeError) {
        // Ignore sanitized close errors on exit.
      }
    }
  }
}

module.exports = {
  DEFAULT_ENV_FILE,
  DEFAULT_OLDER_THAN_DAYS,
  MAX_OLDER_THAN_DAYS,
  TUNNELS_COLLECTION,
  SafeToolError,
  parseArgs,
  extractDatabaseName,
  resolveMongoUri,
  buildInactiveFilter,
  purgeInactiveTunnels,
  formatSummary,
  getUsageText,
  runCli
};

if (require.main === module) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
