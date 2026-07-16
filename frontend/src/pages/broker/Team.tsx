import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '../../lib/api';
import {
  formatDate,
  type TeamMemberView,
  type TeamResponse,
} from '../../components/broker/types';

/**
 * Broker Team page (route `/broker/team`, R19.5).
 *
 * Lets the broker view, add, and remove team members
 * (`GET/POST/DELETE /api/broker/team`) and assign or revoke role-based
 * permissions (`POST /api/broker/team/:id`). Permissions are a fixed set of
 * portal-section grants toggled per member. Light, card-based layout (R19.3).
 */

/** The role-based permissions a member can be granted (R19.5). */
const PERMISSION_KEYS = [
  'clients',
  'policies',
  'renewals',
  'commission',
  'claims',
  'documents',
  'reports',
] as const;

type PermissionKey = (typeof PERMISSION_KEYS)[number];

function permissionLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function isGranted(member: TeamMemberView, key: PermissionKey): boolean {
  return member.permissions[key] === true;
}

export function Team() {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<TeamMemberView | null>(null);

  const teamQuery = useQuery<TeamResponse>({
    queryKey: ['broker', 'team'],
    queryFn: () => api.get<TeamResponse>('/broker/team'),
  });

  const addMutation = useMutation({
    mutationFn: (body: { name: string; role?: string }) =>
      api.post<{ member: TeamMemberView }>('/broker/team', body),
    onSuccess: () => {
      setName('');
      setRole('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['broker', 'team'] });
    },
    onError: (err: unknown) => {
      setFormError(
        err instanceof ApiClientError ? err.message : 'Failed to add team member. Please try again.',
      );
    },
  });

  const permissionMutation = useMutation({
    mutationFn: ({
      memberId,
      grant,
      revoke,
    }: {
      memberId: string;
      grant?: string[];
      revoke?: string[];
    }) => api.post<{ member: TeamMemberView }>(`/broker/team/${memberId}`, { grant, revoke }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['broker', 'team'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => api.delete<void>(`/broker/team/${memberId}`),
    onSuccess: () => {
      setPendingRemove(null);
      void queryClient.invalidateQueries({ queryKey: ['broker', 'team'] });
    },
  });

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError('A name is required to add a team member.');
      return;
    }
    addMutation.mutate({ name: name.trim(), role: role.trim() || undefined });
  }

  function togglePermission(member: TeamMemberView, key: PermissionKey) {
    if (isGranted(member, key)) {
      permissionMutation.mutate({ memberId: member.id, revoke: [key] });
    } else {
      permissionMutation.mutate({ memberId: member.id, grant: [key] });
    }
  }

  const team = teamQuery.data?.team ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">Team</h1>
        <p className="text-sm text-slate-500">
          Add or remove team members and manage their permissions.
        </p>
      </header>

      {/* Add member (R19.5). */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-sm font-semibold text-slate-900">Add team member</h2>
        <form className="flex flex-wrap items-end gap-4" onSubmit={handleAdd}>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Role (optional)</span>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Agent, Admin"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <button
            type="submit"
            disabled={addMutation.isPending}
            className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {addMutation.isPending ? 'Adding…' : 'Add member'}
          </button>
        </form>
        {formError && (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {formError}
          </p>
        )}
      </section>

      {/* Members list with permission toggles (R19.5). */}
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-sm font-semibold text-slate-900">
          Team members
          <span className="ml-2 text-xs font-normal text-slate-400">
            {team.length} member{team.length === 1 ? '' : 's'}
          </span>
        </h2>

        {teamQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading team…</p>
        ) : teamQuery.error ? (
          <p role="alert" className="py-6 text-center text-sm text-rose-600">
            Couldn&apos;t load team members. Please try again.
          </p>
        ) : team.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No team members yet. Add your first team member above.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {team.map((member) => (
              <li key={member.id} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{member.name}</p>
                    <p className="text-xs text-slate-500">
                      {member.role ? permissionLabel(member.role) : 'No role'} · added{' '}
                      {formatDate(member.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingRemove(member)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Permissions
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PERMISSION_KEYS.map((key) => {
                      const granted = isGranted(member, key);
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={granted}
                          disabled={permissionMutation.isPending}
                          onClick={() => togglePermission(member, key)}
                          className={[
                            'rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50',
                            granted
                              ? 'bg-[#2563EB] text-white hover:bg-blue-700'
                              : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                          ].join(' ')}
                        >
                          {permissionLabel(key)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Remove confirmation. */}
      {pendingRemove && (
        <ConfirmModal
          title="Remove team member"
          message={`Remove ${pendingRemove.name} from your team? They will lose all access.`}
          pending={removeMutation.isPending}
          error={removeMutation.error instanceof ApiClientError ? removeMutation.error.message : null}
          onConfirm={() => removeMutation.mutate(pendingRemove.id)}
          onCancel={() => {
            if (!removeMutation.isPending) {
              removeMutation.reset();
              setPendingRemove(null);
            }
          }}
        />
      )}
    </div>
  );
}

/** Light-themed confirmation modal for destructive broker actions (R19.3). */
function ConfirmModal({
  title,
  message,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => !pending && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        {error && (
          <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {pending ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Team;
