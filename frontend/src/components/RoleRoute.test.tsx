import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RoleRoute } from './RoleRoute';
import type { Profile } from '../context/AuthContext';

/**
 * Smoke tests for the role-routing guard (R17.2, R17.5).
 *
 * We stub `useAuth` so each test controls the auth state the guard sees,
 * keeping the tests focused on the guard's redirect/allow decisions.
 */
const mockAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth(),
}));

function makeProfile(role: Profile['role']): Profile {
  return {
    userId: 'u1',
    fullName: 'Test User',
    email: 'test@example.com',
    role,
    tier: 'free',
    brokerId: null,
  };
}

function renderAt(path: string, guard: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={guard} />
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/broker" element={<div>broker home</div>} />
        <Route path="/not-authorized" element={<div>not authorized</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RoleRoute', () => {
  it('renders a spinner while auth is loading', () => {
    mockAuth.mockReturnValue({ user: null, profile: null, loading: true });
    renderAt('/app', <RoleRoute allow={['customer']}>secret</RoleRoute>);
    expect(screen.queryByRole('status')).not.toBeNull();
  });

  it('redirects unauthenticated users to login with a redirect param', () => {
    mockAuth.mockReturnValue({ user: null, profile: null, loading: false });
    renderAt('/app', <RoleRoute allow={['customer']}>secret</RoleRoute>);
    expect(screen.queryByText('login page')).not.toBeNull();
  });

  it('renders children when the role is allowed', () => {
    mockAuth.mockReturnValue({
      user: { id: 'u1' },
      profile: makeProfile('customer'),
      loading: false,
    });
    renderAt('/app', <RoleRoute allow={['customer']}>secret content</RoleRoute>);
    expect(screen.queryByText('secret content')).not.toBeNull();
  });

  it('redirects to the user portal home when the role is not allowed', () => {
    mockAuth.mockReturnValue({
      user: { id: 'u1' },
      profile: makeProfile('broker'),
      loading: false,
    });
    renderAt('/app', <RoleRoute allow={['customer']}>secret</RoleRoute>);
    expect(screen.queryByText('broker home')).not.toBeNull();
  });
});
