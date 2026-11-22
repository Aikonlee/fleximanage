jest.mock('../utils/deviceQueue', () => () => ({
  resetWaitPause: jest.fn()
}));

const connections = require('../websocket/Connections');

describe('websocket identity binding', () => {
  test('malformed JSON is handled without throwing', () => {
    const run = () => connections.classifyDeviceResponse(
      '{',
      'machine-a',
      'machine-a'
    );
    expect(run).not.toThrow();
    expect(run().status).toBe('invalid-json');
  });

  test('a response with a mismatched machineId is ignored', () => {
    const message = JSON.stringify({ seq: '1:abcd', msg: { ok: true } });
    const mismatch = connections.classifyDeviceResponse(
      message,
      'other-machine',
      'machine-a'
    );
    expect(mismatch.status).toBe('ignored');
    expect(mismatch.parsed.seq).toBe('1:abcd');

    const match = connections.classifyDeviceResponse(
      message,
      'machine-a',
      'machine-a'
    );
    expect(match.status).toBe('accepted');
  });

  test('no-claim token uses the URL id and a mismatched claim is rejected', () => {
    const noClaim = connections.resolveUpgradeMachineId('device-from-url', null);
    expect(noClaim.ok).toBe(true);
    expect(noClaim.machineId).toBe('device-from-url');

    const emptyClaim = connections.resolveUpgradeMachineId('device-from-url', '');
    expect(emptyClaim.ok).toBe(true);
    expect(emptyClaim.machineId).toBe('device-from-url');

    const mismatch = connections.resolveUpgradeMachineId('device-from-url', 'other-device');
    expect(mismatch.ok).toBe(false);
    expect(mismatch.status).toBe(401);
    expect(mismatch.message).toBe('Unauthorized: Device ID mismatch');
  });
});
