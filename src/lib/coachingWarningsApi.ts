import { authFetchInit } from './authApi';
import type { ConsequenceCategory } from './consequenceScore';

export interface TaggingUser {
  id: string;
  email: string;
  name: string;
}

export interface UserNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  warningId: string | null;
  readAt: string | null;
  createdAt: string;
}

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
  return data;
}

export async function fetchTaggingUsers(): Promise<TaggingUser[]> {
  const res = await fetch('/api/users/directory', authFetchInit());
  const data = await parseJson(res) as { users: TaggingUser[] };
  return data.users || [];
}

export async function fetchUserNotifications(): Promise<UserNotification[]> {
  const res = await fetch('/api/notifications', authFetchInit());
  const data = await parseJson(res) as { notifications: UserNotification[] };
  return data.notifications || [];
}

export async function markUserNotificationRead(id: string): Promise<void> {
  const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, authFetchInit({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: true }),
  }));
  await parseJson(res);
}

export async function markAllUserNotificationsRead(): Promise<void> {
  const res = await fetch('/api/notifications/read-all', authFetchInit({ method: 'POST' }));
  await parseJson(res);
}

export async function issueWrittenWarning(input: {
  driverKey: string;
  driverName: string;
  comment: string;
  disciplineBand: ConsequenceCategory;
  taggedUserIds: string[];
}) {
  const res = await fetch('/api/coaching/warnings', authFetchInit({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
  return parseJson(res) as Promise<{ warning: { id: string; emailResults?: Array<{ sent: boolean; error?: string }> } }>;
}
