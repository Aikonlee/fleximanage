/* Server-local fixtures only. Never selects or modifies an existing tenant. */
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const backend = process.env.FLEXIMANAGE_BACKEND;
if (!backend || !path.isAbsolute(backend)) throw new Error('Set FLEXIMANAGE_BACKEND to the absolute backend directory');
const load = name => require(path.join(backend, name));
load('node_modules/dotenv').config({ path: path.join(backend, '.env') });
const mongoose = load('node_modules/mongoose');
const Account = load('models/accounts');
const User = load('models/users');
const Org = load('models/organizations');
const PathLabel = load('models/pathlabels');
const { devices } = load('models/devices');
const { membership, preDefinedPermissions } = load('models/membership');
const root = process.env.E2E_STATE_DIR || path.resolve(backend, '../tmp/frontend-e2e-state');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const statePath = path.join(root, 'fixture-state.json');
async function main() {
  const db = load('mongoConns')().getMainDB(); await db.asPromise();
  if (process.argv[2] === 'cleanup') {
    const state = JSON.parse(fs.readFileSync(statePath));
    // Every delete is scoped by IDs created by this run, never a blanket collection delete.
    const orgIds = state.orgs.map(o => new mongoose.Types.ObjectId(o.id));
    for (const name of ['qospolicies', 'firewallpolicies', 'multilinkpolicies', 'devices', 'tokens', 'pathlabels', 'linkmonitors']) {
      await db.collection(name).deleteMany({ org: { $in: orgIds } });
    }
    const analytics = load('mongoConns')().getAnalyticsDB();
    await analytics.asPromise();
    for (const collection of await analytics.db.listCollections({}, { nameOnly: true }).toArray()) {
      await analytics.collection(collection.name).deleteMany({ org: { $in: orgIds } });
    }
    await membership.deleteMany({ account: state.account });
    await User.deleteMany({ _id: { $in: state.users.map(u => u.id) }, defaultAccount: state.account });
    await Org.deleteMany({ _id: { $in: orgIds }, account: state.account });
    await Account.deleteOne({ _id: state.account, name: state.name });
    fs.renameSync(statePath, statePath + '.cleaned-' + Date.now());
    console.log('Isolated fixture tenant removed'); return;
  }
  if (fs.existsSync(statePath)) throw new Error('Fixture manifest already exists; clean it before starting another run');
  const suffix = crypto.randomBytes(4).toString('hex');
  const state = { name: `e2e-${suffix}`, orgs: [], users: [] };
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  const account = await Account.create({ name: state.name, country: 'US', companySize: '0-10', serviceType: 'Provider', numSites: '2' });
  state.account = String(account._id); save();
  for (const label of ['Alpha', 'Beta']) {
    const org = await Org.create({ name: `E2E ${label} ${suffix}`, group: 'e2e', account: account._id });
    state.orgs.push({ id: String(org._id), name: org.name }); save();
  }
  account.organizations = state.orgs.map(o => o.id); await account.save();
  const foreign = await PathLabel.create({ org: state.orgs[1].id, name: 'E2E foreign path', color: '#ff0000', type: 'DIA' });
  state.foreignLabel = { id: String(foreign._id) }; save();
  for (const role of ['owner', 'mixed', 'viewer']) {
    const password = crypto.randomBytes(24).toString('hex');
    const username = `e2e-${suffix}-${role}@example.invalid`;
    const user = new User({ username, email: username, name: 'Test', lastName: 'User', jobTitle: 'Engineer', state: 'verified', admin: false, defaultAccount: account._id, defaultOrg: state.orgs[0].id });
    await user.setPassword(password); await user.save();
    state.users.push({ id: String(user._id), role, username, password }); save();
    const full = preDefinedPermissions.account_owner;
    const readOnly = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, k === 'accesstokens' ? 0 : (v ? 1 : 0)]));
    if (role === 'owner') await membership.create({ user: user._id, account: account._id, to: 'account', role: 'owner', perms: full });
    else for (let i = 0; i < state.orgs.length; i++) await membership.create({ user: user._id, account: account._id, organization: state.orgs[i].id, to: 'organization', role: role === 'mixed' && i === 0 ? 'manager' : 'viewer', perms: role === 'mixed' && i === 0 ? full : readOnly });
  }
  const device = await devices.create({ account: account._id, org: state.orgs[0].id, name: `E2E Device ${suffix}`, hostname: 'e2e-device', machineId: crypto.randomUUID(), isApproved: true, versions: { device: '6.4.32', agent: '6.4.32', router: '6.4.32' }, interfaces: [{ name: 'eth0', devId: 'pci:0000:00:01.00', driver: 'virtio', MAC: '02:00:00:00:00:01', isAssigned: false }, { name: 'eth1', devId: 'pci:0000:00:02.00', driver: 'virtio', MAC: '02:00:00:00:00:02', isAssigned: false }], fromToken: 'e2e-fixture', deviceToken: crypto.randomBytes(32).toString('hex'), ipList: '192.0.2.10' });
  state.device = { id: String(device._id), name: device.name, machineId: device.machineId }; save();
  console.log('Created isolated account, two organizations, three users and one offline device');
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
