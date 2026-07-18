// In-app notifications routes (mounted under `/api/notifications`).
//
//   GET  /api/notifications          — list the caller's recent notifications + unreadCount.
//   POST /api/notifications/:id/read  — mark a single notification read.
//   POST /api/notifications/read-all  — mark all of the caller's unread notifications read.
//
// Role-agnostic (customer + broker), so it applies `authMiddleware` only — no
// RBAC — and is mounted BEFORE the customer router so the customer portal's
// router-level RBAC guard doesn't intercept these requests.

import { Router } from 'express';

import {
  listNotifications,
  markAllRead,
  markRead,
} from '../controllers/notificationsController';
import { authMiddleware } from '../middleware/index';

/** Router carrying the in-app notification endpoints. */
export const notificationsRouter = Router();

// Every notification route requires an authenticated caller (any role).
notificationsRouter.use(authMiddleware);

notificationsRouter.get('/', listNotifications);
notificationsRouter.post('/:id/read', markRead);
notificationsRouter.post('/read-all', markAllRead);
