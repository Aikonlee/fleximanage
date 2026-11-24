import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DeviceInfo from './DeviceInfo';
import api from '../services/api';

const DEVICE_ID = 'dev-1';
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ deviceId: DEVICE_ID }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../services/api', () => ({
  default: Object.assign(vi.fn(), {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
  inferBaseURL: vi.fn(() => ''),
}));

vi.mock('../components/common/PermissionButton', async () => {
  const { Button } = await import('react-bootstrap');
  return {
    default: ({ permKey: _permKey, method: _method, native, ...props }) => (
      native ? <button type="button" {...props} /> : <Button {...props} />
    ),
  };
});

const makeSampleDevice = () => ({
  _id: DEVICE_ID,
  machineId: 'edge-machine-01',
  name: 'Edge Router 1',
  description: 'Primary branch edge',
  isApproved: true,
  isConnected: true,
  state: 'running',
  interfaces: [
    {
      _id: 'iface-1',
      name: 'eth0',
      type: 'WAN',
      isAssigned: true,
      IPv4: '198.51.100.10',
      IPv4Mask: '24',
      gateway: '198.51.100.1',
      linkStatus: 'up',
      routing: 'None',
    },
    {
      _id: 'iface-2',
      name: 'eth1',
      type: 'LAN',
      isAssigned: true,
      IPv4: '10.0.1.1',
      IPv4Mask: '24',
      gateway: '',
      linkStatus: 'up',
      routing: 'OSPF',
    },
  ],
  dhcp: [],
  firewall: { rules: [] },
  routingFilters: [],
  edgeLoopbacks: [],
});

let alertSpy;

function stubDeviceApi(initialDevice = makeSampleDevice()) {
  let currentDevice = initialDevice;
  api.mockImplementation(async (config) => {
    const method = (config.method || 'GET').toUpperCase();
    const url = config.url || '';

    if (method === 'GET' && (url === `/devices/${DEVICE_ID}` || url.startsWith(`/devices/${DEVICE_ID}?`))) {
      return { status: 200, data: currentDevice };
    }
    if (method === 'GET' && url === `/devices/${DEVICE_ID}/staticroutes`) {
      return { status: 200, data: [] };
    }
    if (method === 'PUT' && url === `/devices/${DEVICE_ID}`) {
      currentDevice = { ...currentDevice, ...config.data };
      return { status: 200, data: currentDevice };
    }
    throw new Error(`Unexpected API call: ${method} ${url}`);
  });
}

async function renderInterfacesTab() {
  render(
    <MemoryRouter>
      <DeviceInfo />
    </MemoryRouter>
  );

  expect(await screen.findByText(/edge-machine-01/)).toBeInTheDocument();

  fireEvent.click(screen.getByText('Configuration'));
  fireEvent.click(screen.getByRole('button', { name: 'Interfaces' }));

  expect(await screen.findByText('eth0')).toBeInTheDocument();
  expect(screen.getByText('eth1')).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('token', 'test-token');
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  localStorage.removeItem('token');
  alertSpy.mockRestore();
});

test('Type cell renders a select with WAN, LAN, TRUNK options and current type selected', async () => {
  stubDeviceApi();
  await renderInterfacesTab();

  const eth0Row = screen.getByText('eth0').closest('tr');
  const eth1Row = screen.getByText('eth1').closest('tr');

  const eth0Select = within(eth0Row).getByRole('combobox');
  const eth1Select = within(eth1Row).getByRole('combobox');

  const eth0Options = within(eth0Select).getAllByRole('option').map((opt) => opt.value);
  const eth1Options = within(eth1Select).getAllByRole('option').map((opt) => opt.value);

  expect(eth0Options).toEqual(['WAN', 'LAN', 'TRUNK']);
  expect(eth1Options).toEqual(['WAN', 'LAN', 'TRUNK']);
  expect(eth0Select.value).toBe('WAN');
  expect(eth0Select.selectedIndex).toBe(0);
  expect(eth1Select.value).toBe('LAN');
  expect(eth1Select.selectedIndex).toBe(1);
});

test('selecting TRUNK records a pending edit and Update Device sends one PUT with type TRUNK', async () => {
  const initialDevice = makeSampleDevice();
  stubDeviceApi(initialDevice);
  await renderInterfacesTab();

  const eth0Row = screen.getByText('eth0').closest('tr');
  const eth0Select = within(eth0Row).getByRole('combobox');

  fireEvent.change(eth0Select, { target: { value: 'TRUNK' } });
  expect(eth0Select.value).toBe('TRUNK');

  const putsBeforeSave = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
  expect(putsBeforeSave).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Update Device' }));

  await waitFor(() => {
    const putCalls = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
    expect(putCalls).toHaveLength(1);
  });

  const putCalls = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
  expect(putCalls).toHaveLength(1);
  expect(putCalls[0][0].url).toBe(`/devices/${DEVICE_ID}`);
  expect(putCalls[0][0].data).toEqual({
    name: initialDevice.name,
    description: initialDevice.description,
    isApproved: initialDevice.isApproved,
    interfaces: [
      { ...initialDevice.interfaces[0], type: 'TRUNK' },
      { ...initialDevice.interfaces[1] },
    ],
  });

  const updatedEth0 = putCalls[0][0].data.interfaces.find((i) => i._id === 'iface-1');
  const unchangedEth1 = putCalls[0][0].data.interfaces.find((i) => i._id === 'iface-2');
  expect(updatedEth0.type).toBe('TRUNK');
  expect(unchangedEth1.type).toBe('LAN');
});

test('selecting LAN instead of WAN sends type LAN in the PUT body on Update Device', async () => {
  const initialDevice = makeSampleDevice();
  stubDeviceApi(initialDevice);
  await renderInterfacesTab();

  const eth0Row = screen.getByText('eth0').closest('tr');
  const eth0Select = within(eth0Row).getByRole('combobox');

  expect(eth0Select.value).toBe('WAN');
  fireEvent.change(eth0Select, { target: { value: 'LAN' } });
  expect(eth0Select.value).toBe('LAN');

  const putsBeforeSave = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
  expect(putsBeforeSave).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Update Device' }));

  await waitFor(() => {
    const putCalls = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
    expect(putCalls).toHaveLength(1);
  });

  const putCalls = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
  expect(putCalls).toHaveLength(1);
  expect(putCalls[0][0].url).toBe(`/devices/${DEVICE_ID}`);
  expect(putCalls[0][0].data).toEqual({
    name: initialDevice.name,
    description: initialDevice.description,
    isApproved: initialDevice.isApproved,
    interfaces: [
      { ...initialDevice.interfaces[0], type: 'LAN' },
      { ...initialDevice.interfaces[1] },
    ],
  });

  const updatedEth0 = putCalls[0][0].data.interfaces.find((i) => i._id === 'iface-1');
  expect(updatedEth0.type).toBe('LAN');
});

test('interface with type NONE shows NONE label with no option selected and choosing WAN sends type WAN in PUT', async () => {
  const initialDevice = makeSampleDevice();
  initialDevice.interfaces[0].type = 'NONE';
  stubDeviceApi(initialDevice);
  await renderInterfacesTab();

  const eth0Row = screen.getByText('eth0').closest('tr');
  const eth0Select = within(eth0Row).getByRole('combobox');
  const typeCell = eth0Select.closest('td');

  const eth0Options = within(eth0Select).getAllByRole('option').map((opt) => opt.value);
  expect(eth0Options).toEqual(['WAN', 'LAN', 'TRUNK']);
  expect(within(typeCell).getByText('NONE')).toBeInTheDocument();
  expect(eth0Select.selectedIndex).toBe(-1);
  expect(eth0Select.value).toBe('');

  fireEvent.change(eth0Select, { target: { value: 'WAN' } });
  expect(eth0Select.value).toBe('WAN');
  expect(eth0Select.selectedIndex).toBe(0);
  expect(within(typeCell).queryByText('NONE')).not.toBeInTheDocument();

  const putsBeforeSave = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
  expect(putsBeforeSave).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Update Device' }));

  await waitFor(() => {
    const putCalls = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
    expect(putCalls).toHaveLength(1);
  });

  const putCalls = api.mock.calls.filter(([cfg]) => (cfg.method || 'GET').toUpperCase() === 'PUT');
  expect(putCalls).toHaveLength(1);
  expect(putCalls[0][0].url).toBe(`/devices/${DEVICE_ID}`);
  expect(putCalls[0][0].data).toEqual({
    name: initialDevice.name,
    description: initialDevice.description,
    isApproved: initialDevice.isApproved,
    interfaces: [
      { ...initialDevice.interfaces[0], type: 'WAN' },
      { ...initialDevice.interfaces[1] },
    ],
  });
});

test('DeviceInfo.css .content-area-template no longer caps width at max-width: 56rem', () => {
  const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'DeviceInfo.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const ruleMatch = cssContent.match(/\.content-area-template\s*\{[^}]*\}/);

  expect(ruleMatch).not.toBeNull();
  expect(ruleMatch[0]).not.toMatch(/max-width\s*:\s*56rem/i);
  expect(ruleMatch[0]).toMatch(/position\s*:\s*relative/);
  expect(ruleMatch[0]).toMatch(/z-index\s*:\s*1/);
});
