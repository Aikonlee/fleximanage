/** @jest-environment node */
jest.mock('../configs', () => () => ({
  get: (key) => {
    if (key === 'companyName') return 'TestCo';
    if (key === 'notificationCoolDownPeriod') return 60000;
    return '';
  }
}));
jest.mock('../logging/logging', () => {
  const error = jest.fn();
  const info = jest.fn();
  const factory = () => ({
    info,
    warn: jest.fn(),
    error,
    debug: jest.fn()
  });
  factory.error = error;
  factory.info = info;
  return factory;
});
jest.mock('../utils/mailer', () => () => ({
  sendMailHTML: jest.fn(async () => true)
}));
jest.mock('../utils/webhooks', () => {
  const sendToWebHook = jest.fn();
  const factory = () => ({ sendToWebHook });
  factory.sendToWebHook = sendToWebHook;
  return factory;
});
jest.mock('../models/notifications', () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  bulkWrite: jest.fn()
}));
jest.mock('../models/notificationsConf', () => ({
  findOne: jest.fn()
}));
jest.mock('../models/organizations', () => ({
  aggregate: jest.fn()
}));
jest.mock('../models/devices', () => ({
  devices: {}
}));
jest.mock('../models/tunnels', () => ({
  findOne: jest.fn()
}));
jest.mock('../models/users', () => ({
  find: jest.fn()
}));

const mongoose = require('mongoose');
const logError = require('../logging/logging').error;
const notificationsDb = require('../models/notifications');
const notificationsConf = require('../models/notificationsConf');
const organizations = require('../models/organizations');
const { sendToWebHook } = require('../utils/webhooks');
const createNotificationsMgr = require('../notifications/notifications');

const flushDetached = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('sendNotifications persists batch before slow webhook resolves', async () => {
  const org1 = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const org2 = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
  const account1 = new mongoose.Types.ObjectId('507f1f77bcf86cd799439021');
  const account2 = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');

  const events = [];
  let resolveSlowWebhook;
  sendToWebHook.mockImplementation((url) => {
    events.push(`webhook:start:${url}`);
    if (url.includes('slow.example')) {
      return new Promise((resolve) => {
        resolveSlowWebhook = (val) => {
          events.push(`webhook:done:${url}`);
          resolve(val);
        };
      });
    }
    events.push(`webhook:done:${url}`);
    return Promise.resolve(true);
  });

  notificationsConf.findOne.mockImplementation((query) => ({
    lean: async () => {
      if (query.name) return null;
      const isOrg1 = String(query.org) === String(org1);
      return {
        org: query.org,
        rules: {
          'Custom Alert': {
            severity: 'critical',
            immediateEmail: false,
            sendWebHook: true,
            resolvedAlert: false
          }
        },
        webHookSettings: {
          webhookURL: isOrg1 ? 'https://slow.example/hook' : 'https://fast.example/hook',
          sendCriticalAlerts: true,
          sendWarningAlerts: false
        }
      };
    }
  }));

  notificationsDb.findOne.mockResolvedValue(null);
  organizations.aggregate.mockResolvedValue([
    { _id: org1, accountID: [account1] },
    { _id: org2, accountID: [account2] }
  ]);
  notificationsDb.bulkWrite.mockImplementation(async (ops) => {
    events.push(`bulkWrite:${ops.length}`);
    return { ok: 1 };
  });

  const mgr = createNotificationsMgr();
  await mgr.sendNotifications([
    {
      org: org1,
      eventType: 'Custom Alert',
      title: 'Org1 Alert',
      details: 'Detail 1',
      severity: 'critical',
      targets: { deviceId: new mongoose.Types.ObjectId() }
    },
    {
      org: org2,
      eventType: 'Custom Alert',
      title: 'Org2 Alert',
      details: 'Detail 2',
      severity: 'critical',
      targets: { deviceId: new mongoose.Types.ObjectId() }
    }
  ]);

  // Persistence finished before any webhook was even started or awaited.
  expect(notificationsDb.bulkWrite).toHaveBeenCalledTimes(1);
  expect(events).toEqual(['bulkWrite:2']);

  await flushDetached();
  expect(sendToWebHook).toHaveBeenCalledTimes(2);
  expect(events).toEqual([
    'bulkWrite:2',
    'webhook:start:https://slow.example/hook',
    'webhook:start:https://fast.example/hook',
    'webhook:done:https://fast.example/hook'
  ]);

  resolveSlowWebhook(true);
  await flushDetached();
  expect(events).toContain('webhook:done:https://slow.example/hook');
});

test('sendNotifications logs detached webhook errors without failing persistence', async () => {
  const org1 = new mongoose.Types.ObjectId('507f1f77bcf86cd799439031');
  const account1 = new mongoose.Types.ObjectId('507f1f77bcf86cd799439032');

  sendToWebHook.mockRejectedValueOnce(new Error('Webhook target rejected'));
  notificationsConf.findOne.mockImplementation((query) => ({
    lean: async () => {
      if (query.name) return null;
      return {
        org: query.org,
        rules: {
          'Custom Alert': {
            severity: 'critical',
            immediateEmail: false,
            sendWebHook: true,
            resolvedAlert: false
          }
        },
        webHookSettings: {
          webhookURL: 'https://bad.example/hook',
          sendCriticalAlerts: true,
          sendWarningAlerts: false
        }
      };
    }
  }));
  notificationsDb.findOne.mockResolvedValue(null);
  organizations.aggregate.mockResolvedValue([{ _id: org1, accountID: [account1] }]);
  notificationsDb.bulkWrite.mockResolvedValue({ ok: 1 });

  const mgr = createNotificationsMgr();
  await mgr.sendNotifications([{
    org: org1,
    eventType: 'Custom Alert',
    title: 'Org1 Alert',
    details: 'Detail 1',
    severity: 'critical',
    targets: { deviceId: new mongoose.Types.ObjectId() }
  }]);

  expect(notificationsDb.bulkWrite).toHaveBeenCalledTimes(1);
  await flushDetached();
  expect(logError).toHaveBeenCalledWith(
    'Failed to send an immediate webhook notification',
    expect.objectContaining({
      params: expect.objectContaining({ error: 'Webhook target rejected' })
    })
  );
});
