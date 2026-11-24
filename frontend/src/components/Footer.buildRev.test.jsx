import React from 'react';
import { render, screen, within } from '@testing-library/react';
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

test('footer, login, and register show the same revision suffix and only login uses the light variant', () => {
  render(
    <MemoryRouter>
      <div data-testid="footer-host">
        <Footer />
      </div>
      <div data-testid="login-host">
        <Login />
      </div>
      <div data-testid="register-host">
        <Register />
      </div>
    </MemoryRouter>
  );
  expect(screen.getAllByText(COPYRIGHT_TEXT)).toHaveLength(3);

  const docLinks = screen.getAllByRole('link', { name: 'documentation' });
  expect(docLinks).toHaveLength(3);
  for (const link of docLinks) {
    expect(link).toHaveAttribute('href', 'http://158.101.149.157/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.parentElement).toHaveClass('copyright-line');
    expect(link.parentElement?.textContent).toBe(`${COPYRIGHT_TEXT} · documentation`);
  }

  const footerLink = within(screen.getByTestId('footer-host')).getByRole('link', { name: 'documentation' });
  const loginLink = within(screen.getByTestId('login-host')).getByRole('link', { name: 'documentation' });
  const registerLink = within(screen.getByTestId('register-host')).getByRole('link', { name: 'documentation' });

  expect(footerLink).toHaveClass('footer-link');
  expect(footerLink.parentElement).not.toHaveClass('is-light');
  expect(footerLink.closest('.footer-copyright')).not.toBeNull();

  expect(loginLink.parentElement).toHaveClass('is-light');

  expect(registerLink.parentElement).not.toHaveClass('is-light');
  expect(registerLink.closest('small')).toHaveClass('text-muted');
});
