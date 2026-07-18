import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * NotificationBell — in-app notifications for the customer navbar.
 *
 * Polls `GET /api/notifications` for the caller's recent notifications and
 * unread count, shows an unread badge, and opens a dropdown with the list.
 * Opening the dropdown marks everything read (`POST /notifications/read`).
 * Clicking a "policy_analysis_ready" item navigates to that policy's dashboard.
 */

interface NotificationItem {
  id: string;
  type: string;
  payload: { policyId?: string; filename?: string | null; message?: string } | null;
  read: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/notifications'),
    refetchInterval: 15000, // poll every 15s
    refetchOnWindowFocus: true,
  });

  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Mark all read when opening (best-effort).
    if (next && unread > 0) {
      try {
        await api.post('/notifications/read-all', {});
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch {
        /* ignore */
      }
    }
  }

  function handleItem(n: NotificationItem) {
    setOpen(false);
    if (n.payload?.policyId) navigate(`/app/policy/${n.payload.policyId}`);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-foreground transition hover:border-primary hover:text-primary"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
          <path
            d="M6 9a6 6 0 1112 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M10 20a2 2 0 004 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/20">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleItem(n)}
                    className="flex w-full flex-col gap-0.5 border-b border-border/60 px-4 py-3 text-left transition hover:bg-primary/5"
                  >
                    <span className="text-sm text-foreground">
                      {n.payload?.message ??
                        (n.type === 'policy_analysis_ready'
                          ? 'Your policy analysis is ready to view.'
                          : 'You have a new notification.')}
                    </span>
                    {n.payload?.filename && (
                      <span className="text-xs text-muted">{n.payload.filename}</span>
                    )}
                    <span className="text-xs text-muted">{timeAgo(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
