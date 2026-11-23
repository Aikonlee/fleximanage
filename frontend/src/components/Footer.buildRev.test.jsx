import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer, { BUILD_REV, COPYRIGHT_TEXT } from './Footer';
import Login from '../pages/Login';
import Register from '../pages/Register';

vi.mock('../services/api', () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
    defaults: {}
  }
}));

test('build revision is a short sha or the dev fallback', () => {
  expect(BUILD_REV).toMatch(/^(dev|[0-9a-f]{4,40})$/);
  expect(COPYRIGHT_TEXT).toBe(`© OpenSource-OpenNetworking.org 2025.10, All Rights Reserved · Rev ${BUILD_REV}`);
});

test('footer, login, and register show the same revision suffix', () => {
  render(
    <MemoryRouter>
      <Footer />
      <Login />
      <Register />
    </MemoryRouter>
  );
  expect(screen.getAllByText(COPYRIGHT_TEXT)).toHaveLength(3);

  const docLinks = screen.getAllByRole('link', { name: 'documentation' });
  expect(docLinks).toHaveLength(3);
  for (const link of docLinks) {
    expect(link).toHaveAttribute('href', '/docs/index.html');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.parentElement).toHaveClass('copyright-line');
    expect(link.parentElement?.textContent).toBe(`${COPYRIGHT_TEXT} · documentation`);
  }
});
