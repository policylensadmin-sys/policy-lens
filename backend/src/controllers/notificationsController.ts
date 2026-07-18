// In-app notifications controller — HTTP layer for `/api/notifications`.
//
// Role-agnostic (customer + broker): the routes apply `authMiddleware` only,
// so `req.user` is any authenticated caller. Notifications are owned via
// `notifications.user_id = profiles.id`, so each handler first resolves the
// caller's profile id from their auth user id the same way
// {@link brokerDashboardController} does.
//
// Handlers:
//   • listNotifications — newest-first list (limit 50) + unread count.
//   • markRead          — mark a single notification read (must be the caller's).
//   • markAllRead       — mark all of the caller's unread notifications read.

import type { RequestHandler } from 'express';

import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { AppError } from '../middleware/errorHandler';

/** Max notifications returned by the list endpoint. */
const LIST_LIMIT = 50;

/** Resolve the caller's `profiles.id` from their auth user id, or throw 403. */
async function resolveProfileId(userId: string): Promise<string> {
  const { data, error } = await getSupabaseServiceRoleClient()
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.id) {
    throw AppError.forbidden('No profile found for the authenticated user');
  }
  return data.id as string;
}

/**
 * `GET /api/notifications` — the authenticated caller's notifications, newest
 * first (limited to {@link LIST_LIMIT}), plus the current unread count.
 * Returns `{ notifications: [...], unreadCount: n }`.
 */
export const listNotifications: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const profileId = await resolveProfileId(user.id);
    const supabase = getSupabaseServiceRoleClient();

    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, payload, read, created_at')
      .eq('user_id', profileId)
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (error) {
      throw AppError.internal('Failed to load notifications', { reason: error.message });
    }

    const notifications = (data ?? []).map((n) => ({
      id: n.id as string,
      type: n.type as string,
      payload: (n.payload ?? {}) as Record<string, unknown>,
      read: n.read as boolean,
      createdAt: n.created_at as string,
    }));
    const unreadCount = notifications.filter((n) => !n.read).length;

    res.json({ notifications, unreadCount });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load notifications'));
  });
};

/**
 * `POST /api/notifications/:id/read` — mark a single notification read. Scoped
 * to the caller (`user_id = profiles.id`), so a foreign id is a no-op rather
 * than an error. Returns `{ ok: true }`.
 */
export const markRead: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }
  const id = req.params.id;
  if (!id) {
    next(AppError.badRequest('Notification id is required'));
    return;
  }

  void (async () => {
    const profileId = await resolveProfileId(user.id);
    const supabase = getSupabaseServiceRoleClient();

    const { error } = await supabase
      .from('notifications')
      .update({ read: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', profileId);
    if (error) {
      throw AppError.internal('Failed to update notification', { reason: error.message });
    }

    res.json({ ok: true });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to update notification'));
  });
};

/**
 * `POST /api/notifications/read-all` — mark all of the caller's unread
 * notifications read. Returns `{ ok: true }`.
 */
export const markAllRead: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const profileId = await resolveProfileId(user.id);
    const supabase = getSupabaseServiceRoleClient();

    const { error } = await supabase
      .from('notifications')
      .update({ read: true, updated_at: new Date().toISOString() })
      .eq('user_id', profileId)
      .eq('read', false);
    if (error) {
      throw AppError.internal('Failed to update notifications', { reason: error.message });
    }

    res.json({ ok: true });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to update notifications'));
  });
};
