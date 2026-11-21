import { safeDownloadUrl } from './Billing';

test('accepts https invoice download URLs', () => {
  expect(safeDownloadUrl('https://billing.example/invoices/1.pdf')).toBe('https://billing.example/invoices/1.pdf');
});

test('rejects javascript URLs', () => {
  expect(safeDownloadUrl('javascript:alert(1)')).toBeNull();
});

test('rejects data URLs', () => {
  expect(safeDownloadUrl('data:text/html,invoice')).toBeNull();
});

test('rejects invalid strings', () => {
  expect(safeDownloadUrl('not a url')).toBeNull();
  expect(safeDownloadUrl('')).toBeNull();
  expect(safeDownloadUrl(null)).toBeNull();
});

test('rejects non-local http and allows same-origin localhost http', () => {
  expect(safeDownloadUrl('http://evil.example/invoices/1.pdf')).toBeNull();
  const { protocol, hostname, origin } = window.location;
  if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
    const local = `${origin}/invoices/1.pdf`;
    expect(safeDownloadUrl(local)).toBe(local);
  }
});
