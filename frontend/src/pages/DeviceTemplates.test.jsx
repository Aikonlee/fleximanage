import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DeviceTemplates from './DeviceTemplates';
import api from '../services/api';

vi.mock('../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../components/common/PermissionButton', async () => {
  const { Button } = await import('react-bootstrap');
  return {
    default: ({ permKey: _permKey, method: _method, ...props }) => <Button {...props} />,
  };
});

const SAMPLE_TEMPLATES = [
  {
    _id: 'tpl-1',
    org: 'org-1',
    name: 'Branch Edge',
    description: 'Standard branch baseline',
    version: 1,
    config: { mtu: 1400, dns: ['8.8.8.8'] },
    createdBy: 'user-1',
  },
  {
    _id: 'tpl-2',
    org: 'org-1',
    name: 'Hub Gateway',
    description: 'Primary DC hub',
    version: 2,
    config: { bgp: { asn: 65001 } },
    createdBy: 'user-1',
  },
];

let confirmSpy;

beforeEach(() => {
  vi.clearAllMocks();
  confirmSpy = vi.spyOn(window, 'confirm');
});

afterEach(() => {
  confirmSpy.mockRestore();
});

test('renders rows returned by GET /devicetemplates and displays read-only config modal', async () => {
  api.get.mockResolvedValueOnce({ data: SAMPLE_TEMPLATES });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  expect(await screen.findByText('Branch Edge')).toBeInTheDocument();
  expect(screen.getByText('Standard branch baseline')).toBeInTheDocument();
  expect(screen.getByText('v1')).toBeInTheDocument();
  expect(screen.getByText('Hub Gateway')).toBeInTheDocument();
  expect(screen.getByText('v2')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/devicetemplates');

  fireEvent.click(screen.getByRole('button', { name: 'View config for Branch Edge' }));
  const viewer = await screen.findByTestId('template-config-viewer');
  expect(viewer).toHaveTextContent('"mtu": 1400');
});

test('create flow POSTs { name, description, config } exactly once and refreshes the list', async () => {
  const created = {
    _id: 'tpl-3',
    org: 'org-1',
    name: 'Retail Site',
    description: 'Compact branch profile',
    version: 1,
    config: { wan: { dhcp: true } },
    createdBy: 'user-1',
  };
  api.get
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValueOnce({ data: [created] });
  api.post.mockResolvedValueOnce({ status: 201, data: created });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  expect(await screen.findByText('No device templates configured yet.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Create Template/i }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Retail Site' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Compact branch profile' } });
  fireEvent.change(screen.getByLabelText('Config (JSON)'), { target: { value: '{"wan": {"dhcp": true}}' } });

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith('/devicetemplates', {
    name: 'Retail Site',
    description: 'Compact branch profile',
    config: { wan: { dhcp: true } },
  });
  expect(await screen.findByText('Retail Site')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('new-version flow PUTs only { config, description } to /devicetemplates/{id} and refreshes', async () => {
  const updated = {
    ...SAMPLE_TEMPLATES[0],
    _id: 'tpl-1-v2',
    description: 'Updated branch baseline',
    version: 2,
    config: { mtu: 1420, dns: ['1.1.1.1'] },
  };
  api.get
    .mockResolvedValueOnce({ data: [SAMPLE_TEMPLATES[0]] })
    .mockResolvedValueOnce({ data: [SAMPLE_TEMPLATES[0], updated] });
  api.put.mockResolvedValueOnce({ status: 200, data: updated });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  expect(await screen.findByText('Branch Edge')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'New version of Branch Edge' }));

  const configField = screen.getByLabelText('Config (JSON)');
  expect(configField.value).toBe(JSON.stringify(SAMPLE_TEMPLATES[0].config, null, 2));
  expect(screen.getByLabelText('Description').value).toBe('Standard branch baseline');

  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated branch baseline' } });
  fireEvent.change(configField, { target: { value: '{"mtu": 1420, "dns": ["1.1.1.1"]}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Version' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  expect(api.put).toHaveBeenCalledWith('/devicetemplates/tpl-1', {
    config: { mtu: 1420, dns: ['1.1.1.1'] },
    description: 'Updated branch baseline',
  });
  expect(Object.keys(api.put.mock.calls[0][1]).sort()).toEqual(['config', 'description']);
  expect(await screen.findByText('Updated branch baseline')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('delete flow calls DELETE after confirm and refreshes', async () => {
  api.get
    .mockResolvedValueOnce({ data: SAMPLE_TEMPLATES })
    .mockResolvedValueOnce({ data: [SAMPLE_TEMPLATES[1]] });
  api.delete.mockResolvedValueOnce({ status: 204 });
  confirmSpy.mockReturnValueOnce(true);

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  expect(await screen.findByText('Branch Edge')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Delete Branch Edge' }));

  await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(api.delete).toHaveBeenCalledWith('/devicetemplates/tpl-1');
  await waitFor(() => expect(screen.queryByText('Branch Edge')).not.toBeInTheDocument());
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('invalid JSON, array config, and unsafe keys are rejected locally with no API call', async () => {
  api.get.mockResolvedValueOnce({ data: [] });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  expect(await screen.findByText('No device templates configured yet.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Create Template/i }));

  // Empty name
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/Template name is required/i)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad Template' } });

  // Invalid JSON
  fireEvent.change(screen.getByLabelText('Config (JSON)'), { target: { value: '{not valid json' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/Config must be valid JSON/i)).toBeInTheDocument();

  // Array config
  fireEvent.change(screen.getByLabelText('Config (JSON)'), { target: { value: '[1, 2, 3]' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/Config must be a plain JSON object/i)).toBeInTheDocument();

  // Unsafe $ prefix key
  fireEvent.change(screen.getByLabelText('Config (JSON)'), { target: { value: '{"$where": "1==1"}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/unsafe key.*\$where/i)).toBeInTheDocument();

  // Unsafe __proto__ key (nested)
  fireEvent.change(screen.getByLabelText('Config (JSON)'), {
    target: { value: '{"nested": {"__proto__": {"polluted": true}}}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/unsafe key.*__proto__/i)).toBeInTheDocument();

  // Unsafe constructor key
  fireEvent.change(screen.getByLabelText('Config (JSON)'), {
    target: { value: '{"constructor": {}}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/unsafe key.*constructor/i)).toBeInTheDocument();

  // Unsafe prototype key
  fireEvent.change(screen.getByLabelText('Config (JSON)'), {
    target: { value: '{"prototype": {}}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/unsafe key.*prototype/i)).toBeInTheDocument();

  expect(api.post).not.toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
});

test('API failure renders the error message', async () => {
  api.get.mockRejectedValueOnce({
    response: { data: { error: 'Template service unavailable' } },
  });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  expect(await screen.findByText('Template service unavailable')).toBeInTheDocument();
});

test('stale GET response resolving out of order does not overwrite a newer snapshot', async () => {
  const createDeferred = () => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  const remaining = {
    _id: 'tpl-3',
    org: 'org-1',
    name: 'Core Router',
    description: 'Campus core',
    version: 1,
    config: { ospf: { area: 0 } },
    createdBy: 'user-1',
  };
  const olderGet = createDeferred();
  const newerGet = createDeferred();

  api.get
    .mockResolvedValueOnce({ data: [...SAMPLE_TEMPLATES, remaining] })
    .mockReturnValueOnce(olderGet.promise)
    .mockReturnValueOnce(newerGet.promise);
  api.delete
    .mockResolvedValueOnce({ status: 204 })
    .mockResolvedValueOnce({ status: 204 });
  confirmSpy.mockReturnValue(true);

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  expect(await screen.findByText('Branch Edge')).toBeInTheDocument();
  expect(screen.getByText('Core Router')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Delete Hub Gateway' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));

  fireEvent.click(screen.getByRole('button', { name: 'Delete Branch Edge' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));

  await act(async () => {
    newerGet.resolve({ data: [remaining] });
    await newerGet.promise;
  });

  expect(screen.getByText('Core Router')).toBeInTheDocument();
  expect(screen.queryByText('Branch Edge')).not.toBeInTheDocument();

  await act(async () => {
    olderGet.resolve({ data: [SAMPLE_TEMPLATES[0], remaining] });
    await olderGet.promise;
  });

  expect(screen.getByText('Core Router')).toBeInTheDocument();
  expect(screen.queryByText('Branch Edge')).not.toBeInTheDocument();
});
