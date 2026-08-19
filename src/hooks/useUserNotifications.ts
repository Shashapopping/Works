import { useCallback, useEffect, useState } from 'react';
import {
  fetchUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  type UserNotification,
} from '../lib/coachingWarningsApi';

export function useUserNotifications(pollMs = 45_000) {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await fetchUserNotifications();
      setNotifications(rows);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  const unreadCount = notifications.filter(n => !n.readAt).length;

  const dismiss = useCallback(async (id: string) => {
    await markUserNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
  }, []);

  const clearAll = useCallback(async () => {
    await markAllUserNotificationsRead();
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt || now })));
  }, []);

  return { notifications, unreadCount, loading, refresh, dismiss, clearAll };
}
