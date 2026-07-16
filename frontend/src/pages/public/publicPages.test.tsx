import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the Supabase browser client so the pages mount without a real project
// (createClient throws on an empty URL). Provides the auth surface the
// AuthContext + pages touch.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ data: { session: null, user: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
  },
}));

import { AuthProvider } from '../../context/AuthContext';
import { Login } from './Login';
import { Signup } from './Signup';
import { Try } from './Try';

/**
 * Render smoke tests for the public auth + guest-preview pages (task 11.2).
 * These verify the pages mount and expose their key affordances so the route
 * wiring (R17.1, R17.3, R20.7) is exercised end-to-end.
 */

describe('Login page', () => {
  it('renders email/password fields and a sign-in action', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('Email')).not.toBeNull();
    expect(screen.queryByLabelText('Password')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeNull();
  });
});

describe('Signup page', () => {
  it('renders name, email, and password fields plus a create-account action', () => {
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <Signup />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('Full name')).not.toBeNull();
    expect(screen.queryByLabelText('Email')).not.toBeNull();
    expect(screen.queryByLabelText('Password')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeNull();
  });
});

describe('Try (guest preview) page', () => {
  it('renders the no-account preview prompt and a file chooser', () => {
    render(
      <MemoryRouter initialEntries={['/try']}>
        <Try />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/no account needed/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /choose a policy/i })).not.toBeNull();
  });
});
