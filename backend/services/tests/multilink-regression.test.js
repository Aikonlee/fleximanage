/** @jest-environment node */
jest.mock('mongoose', () => ({ Types: { ObjectId: jest.requireActual('bson').ObjectId } }));
jest.mock('../../models/mlpolicies', () => ({ findOne: jest.fn() }));
jest.mock('../../models/pathlabels', () => ({ find: jest.fn() }));
jest.mock('../../utils/membershipUtils', () => ({}));
jest.mock('../../models/devices', () => ({ devices: {} }));
jest.mock('../../deviceLogic/mlpolicy', () => ({}));
jest.mock('../../deviceLogic/validators', () => ({}));
jest.mock('../../models/notificationsConf', () => ({}));
jest.mock('../../notifications/notifications', () => () => ({}));
const { Types: { ObjectId } } = require('mongoose');
const Policy = require('../../models/mlpolicies');
const Labels = require('../../models/pathlabels');
const Service = require('../MultiLinkPoliciesService');
const org = new ObjectId().toString();
const label = new ObjectId().toString();
const policy = () => ({ name: 'Policy test', rules: [{ enabled: true,
  classification: { prefix: { ip: '192.0.2.0/24', ports: '', protocol: 'tcp' } },
  action: { links: [{ pathlabels: [label] }] } }] });
beforeEach(() => {
  Policy.findOne.mockReset().mockResolvedValue(null);
  Labels.find.mockReturnValue({ lean: async () => [{ _id: new ObjectId(label) }] });
});
test('creation works with modern ObjectId and accepts plain label IDs', async () => {
  expect(await Service.verifyRequestSchema(policy(), org)).toEqual({ valid: true, message: '' });
  expect(Policy.findOne.mock.calls[0][0]).not.toHaveProperty('_id');
});
test('editing excludes the current policy from duplicate detection', async () => {
  const id = new ObjectId().toString();
  await Service.verifyRequestSchema({ ...policy(), _id: id }, org);
  expect(Policy.findOne.mock.calls[0][0]._id.$ne.toString()).toBe(id);
});
test('populated labels accepted; labels belonging to another organization rejected', async () => {
  const request = policy(); request.rules[0].action.links[0].pathlabels = [{ _id: label }];
  expect((await Service.verifyRequestSchema(request, org)).valid).toBe(true);
  request.rules[0].action.links[0].pathlabels = [new ObjectId().toString()];
  expect((await Service.verifyRequestSchema(request, org)).valid).toBe(false);
});
test('duplicate policy names rejected and regex metacharacters treated literally', async () => {
  Policy.findOne.mockResolvedValue({ _id: new ObjectId() });
  expect((await Service.verifyRequestSchema({ ...policy(), name: 'Policy.test' }, org)).valid).toBe(false);
  const expression = Policy.findOne.mock.calls[0][0].name.$regex;
  expect(expression.test('PolicyXtest')).toBe(false);
  expect(expression.test('Policy.test')).toBe(true);
});
