import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const SUPPORTED_TEMPLATE = {
  _id: 'tpl-1',
  org: 'org-1',
  name: 'Branch Route',
  description: 'Single static route template',
  version: 3,
  config: {
    staticroutes: [{ destination: '10.20.0.0/16', gateway: '192.168.10.1' }],
  },
  createdBy: 'user-1',
};

const SAMPLE_DEVICES = [
  { _id: 'dev-1', name: 'Branch-1', hostname: 'branch-1.local', isApproved: true },
  { _id: 'dev-2', hostname: 'hub-west' },
  { _id: 'dev-3', name: 'Pending-Edge', hostname: 'pending.local', isApproved: false },
  { _id: 'dev-4', name: 'Null-Approval', hostname: 'null.local', isApproved: null },
];

test('Apply button is disabled with explanation for unsupported keys, multiple routes, default route, or invalid route fields', async () => {
  const unsupportedTemplates = [
    {
      _id: 'tpl-extra-top',
      name: 'Extra Top Key',
      version: 1,
      config: {
        staticroutes: [{ destination: '10.0.0.0/24', gateway: '192.168.1.1' }],
        mtu: 1400,
      },
    },
    {
      _id: 'tpl-multi',
      name: 'Multiple Routes',
      version: 1,
      config: {
        staticroutes: [
          { destination: '10.0.0.0/24', gateway: '192.168.1.1' },
          { destination: '10.1.0.0/24', gateway: '192.168.1.1' },
        ],
      },
    },
    {
      _id: 'tpl-default',
      name: 'Default Route',
      version: 1,
      config: {
        staticroutes: [{ destination: '0.0.0.0/0', gateway: '192.168.1.1' }],
      },
    },
    {
      _id: 'tpl-extra-route-key',
      name: 'Extra Route Key',
      version: 1,
      config: {
        staticroutes: [{ destination: '10.2.0.0/24', gateway: '192.168.1.1', metric: 10 }],
      },
    },
    {
      _id: 'tpl-blank-gateway',
      name: 'Blank Gateway',
      version: 1,
      config: {
        staticroutes: [{ destination: '10.3.0.0/24', gateway: '   ' }],
      },
    },
  ];
  api.get.mockResolvedValueOnce({ data: unsupportedTemplates });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  expect(await screen.findByText('Extra Top Key')).toBeInTheDocument();

  for (const tpl of unsupportedTemplates) {
    const btn = screen.getByRole('button', { name: `Apply ${tpl.name}` });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/only single-static-route templates can be applied/i);
  }
  expect(api.get).toHaveBeenCalledTimes(1);
});

test('Apply button is enabled for supported template, fetches detailed devices, and lists only approved devices', async () => {
  api.get
    .mockResolvedValueOnce({ data: [SUPPORTED_TEMPLATE] })
    .mockResolvedValueOnce({ data: SAMPLE_DEVICES });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  const applyBtn = await screen.findByRole('button', { name: 'Apply Branch Route' });
  expect(applyBtn).not.toBeDisabled();

  fireEvent.click(applyBtn);

  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/devices?response=detailed'));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Apply Template — Branch Route (v3)')).toBeInTheDocument();
  expect(within(dialog).getByText('10.20.0.0/16')).toBeInTheDocument();
  expect(within(dialog).getByText('192.168.10.1')).toBeInTheDocument();

  const select = within(dialog).getByLabelText('Target Device');
  await waitFor(() => {
    expect(within(select).getByRole('option', { name: /Branch-1.*dev-1/ })).toBeInTheDocument();
  });
  expect(within(select).queryByRole('option', { name: /hub-west|dev-2/ })).not.toBeInTheDocument();
  expect(within(select).queryByRole('option', { name: /Pending-Edge|dev-3/ })).not.toBeInTheDocument();
  expect(within(select).queryByRole('option', { name: /Null-Approval|dev-4/ })).not.toBeInTheDocument();
  expect(within(select).getAllByRole('option')).toHaveLength(2);
});

test('submitting apply modal with no device selected does not POST', async () => {
  api.get
    .mockResolvedValueOnce({ data: [SUPPORTED_TEMPLATE] })
    .mockResolvedValueOnce({ data: SAMPLE_DEVICES });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Apply Branch Route' }));
  const dialog = await screen.findByRole('dialog');
  const select = within(dialog).getByLabelText('Target Device');
  await waitFor(() => {
    expect(within(select).getByRole('option', { name: /Branch-1.*dev-1/ })).toBeInTheDocument();
  });

  const submitBtn = within(dialog).getByRole('button', { name: 'Apply to Device' });
  expect(submitBtn).toBeDisabled();

  fireEvent.click(submitBtn);
  fireEvent.submit(select.closest('form'));

  expect(api.post).not.toHaveBeenCalled();
});

test('selecting a device POSTs once to /devicetemplates/tpl-1/apply, disables submit while pending, shows 202 receipt, and keeps list unchanged', async () => {
  let resolvePost;
  const pendingPost = new Promise((resolve) => {
    resolvePost = resolve;
  });

  api.get
    .mockResolvedValueOnce({ data: [SUPPORTED_TEMPLATE] })
    .mockResolvedValueOnce({ data: SAMPLE_DEVICES });
  api.post.mockReturnValueOnce(pendingPost);

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Apply Branch Route' }));
  const dialog = await screen.findByRole('dialog');
  const select = within(dialog).getByLabelText('Target Device');
  await waitFor(() => {
    expect(within(select).getByRole('option', { name: /Branch-1.*dev-1/ })).toBeInTheDocument();
  });

  fireEvent.change(select, { target: { value: 'dev-1' } });
  const submitBtn = within(dialog).getByRole('button', { name: 'Apply to Device' });
  expect(submitBtn).not.toBeDisabled();

  fireEvent.click(submitBtn);

  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith('/devicetemplates/tpl-1/apply', { deviceId: 'dev-1' });

  const pendingBtn = within(dialog).getByRole('button', { name: 'Applying...' });
  expect(pendingBtn).toBeDisabled();
  fireEvent.click(pendingBtn);
  expect(api.post).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolvePost({
      status: 202,
      data: {
        templateId: 'tpl-1',
        version: 3,
        deviceId: 'dev-1',
        routeId: 'route-42',
        destination: '10.20.0.0/16',
        gateway: '192.168.10.1',
      },
    });
    await pendingPost;
  });

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('v3');
  expect(alert).toHaveTextContent('route-42');
  expect(alert).toHaveTextContent('dev-1');
  expect(within(screen.getByRole('table')).getByText('Branch Route')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('apply API rejection renders error message and does not show a success receipt', async () => {
  api.get
    .mockResolvedValueOnce({ data: [SUPPORTED_TEMPLATE] })
    .mockResolvedValueOnce({ data: SAMPLE_DEVICES });
  api.post.mockRejectedValueOnce({
    response: { status: 409, data: { error: 'Device is not approved' } },
  });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Apply Branch Route' }));
  const dialog = await screen.findByRole('dialog');
  const select = within(dialog).getByLabelText('Target Device');
  await waitFor(() => {
    expect(within(select).getByRole('option', { name: /Branch-1.*dev-1/ })).toBeInTheDocument();
  });

  fireEvent.change(select, { target: { value: 'dev-1' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to Device' }));

  expect(await within(dialog).findByText('Device is not approved')).toBeInTheDocument();
  expect(screen.queryByText(/route-/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Applied /i)).not.toBeInTheDocument();
});

test('Cancel closes the apply modal without POST', async () => {
  api.get
    .mockResolvedValueOnce({ data: [SUPPORTED_TEMPLATE] })
    .mockResolvedValueOnce({ data: SAMPLE_DEVICES });

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Apply Branch Route' }));
  const dialog = await screen.findByRole('dialog');
  const select = within(dialog).getByLabelText('Target Device');
  await waitFor(() => {
    expect(within(select).getByRole('option', { name: /Branch-1.*dev-1/ })).toBeInTheDocument();
  });

  fireEvent.change(select, { target: { value: 'dev-1' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.post).not.toHaveBeenCalled();
});

test('apply modal cannot be dismissed or re-submitted while POST is in flight, then completes normally', async () => {
  let resolvePost;
  const pendingPost = new Promise((resolve) => {
    resolvePost = resolve;
  });

  api.get
    .mockResolvedValueOnce({ data: [SUPPORTED_TEMPLATE] })
    .mockResolvedValueOnce({ data: SAMPLE_DEVICES });
  api.post.mockReturnValueOnce(pendingPost);

  render(<MemoryRouter><DeviceTemplates /></MemoryRouter>);

  const rowApplyBtn = await screen.findByRole('button', { name: 'Apply Branch Route' });
  fireEvent.click(rowApplyBtn);
  const dialog = await screen.findByRole('dialog');
  const select = within(dialog).getByLabelText('Target Device');
  await waitFor(() => {
    expect(within(select).getByRole('option', { name: /Branch-1.*dev-1/ })).toBeInTheDocument();
  });

  fireEvent.change(select, { target: { value: 'dev-1' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to Device' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

  const cancelBtn = within(dialog).getByRole('button', { name: 'Cancel' });
  const closeBtn = within(dialog).getByRole('button', { name: 'Close' });
  const pendingBtn = within(dialog).getByRole('button', { name: 'Applying...' });

  expect(cancelBtn).toBeDisabled();
  expect(closeBtn).toBeDisabled();
  expect(pendingBtn).toBeDisabled();
  expect(rowApplyBtn).toBeDisabled();

  // Attempt Cancel, header Close, Escape key, and backdrop click dismissal
  fireEvent.click(cancelBtn);
  fireEvent.click(closeBtn);
  fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', keyCode: 27 });
  fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', keyCode: 27 });
  fireEvent.click(dialog);
  const backdrop = document.querySelector('.modal-backdrop');
  if (backdrop) {
    fireEvent.click(backdrop);
  }

  // Modal remains open and no second POST or device refetch can be triggered
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(within(dialog).getByText('Apply Template — Branch Route (v3)')).toBeInTheDocument();
  fireEvent.click(pendingBtn);
  fireEvent.submit(select.closest('form'));
  fireEvent.click(rowApplyBtn);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledTimes(2);

  await act(async () => {
    resolvePost({
      status: 202,
      data: {
        templateId: 'tpl-1',
        version: 3,
        deviceId: 'dev-1',
        routeId: 'route-99',
        destination: '10.20.0.0/16',
        gateway: '192.168.10.1',
      },
    });
    await pendingPost;
  });

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('v3');
  expect(alert).toHaveTextContent('route-99');
  expect(alert).toHaveTextContent('dev-1');
  expect(api.post).toHaveBeenCalledTimes(1);
});
