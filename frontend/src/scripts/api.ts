export interface User {
  id: string;
  displayName: string;
  department: string;
  role: 'student' | 'moderator' | 'admin';
  emailVerified?: boolean;
  accountStatus?: 'active' | 'suspended' | 'banned' | 'deleting';
}

export interface SessionState {
  authenticated: boolean;
  user: User | null;
  demoAuthAvailable: boolean;
  campusEmailVerified?: boolean;
  syntheticIdentity?: boolean;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  englishTitle: string;
  department: string;
  courseType: string;
  enrollmentType: string;
  credits: number;
  term: string;
  assessment: string;
  rating: number;
  difficulty: number;
  reviewCount: number;
}

export interface Review {
  id: string;
  author: string;
  rating: number;
  difficulty: number;
  workload: number;
  content: string;
  tags: string[];
  term: string;
  createdAt: string;
}

export interface Listing {
  id: string;
  title: string;
  category: string;
  price: number;
  condition: string;
  location: string;
  description: string;
  images: string[];
  status: string;
  sellerName: string;
  isOwner: boolean;
  createdAt: string;
}

export interface SkillPost {
  id: string;
  kind: 'offer' | 'request';
  title: string;
  category: string;
  description: string;
  tags: string[];
  canOffer: string;
  wants: string;
  isOwner: boolean;
  createdAt: string;
}

export interface TreePost {
  id: string;
  content: string;
  topic: string;
  createdAt: string;
  reactions: number;
  reacted: boolean;
  author: string;
}

export interface SearchResult {
  id: string;
  identifier: string;
  title: string;
  detail: string;
  type: 'course' | 'listing' | 'skill' | 'tree-hole';
}

interface ApiError {
  message?: string;
  error?: { code?: string; message?: string };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has('content-type')
  ) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (payload as ApiError)?.error?.message ?? (payload as ApiError)?.message;
    throw new Error(message || `请求失败（${response.status}）`);
  }
  return payload as T;
}

export const jsonBody = (value: unknown): string => JSON.stringify(value);

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char] ?? char;
  });
}

export function showToast(
  message: string,
  tone: 'success' | 'error' | 'info' = 'info',
): void {
  document.dispatchEvent(
    new CustomEvent('shenxiaoli:toast', { detail: { message, tone } }),
  );
}

export function formatRelativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30
    ? `${days} 天前`
    : new Date(value).toLocaleDateString('zh-CN');
}

export function imageUrl(value: string | undefined): string {
  if (!value || !/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(value))
    return '';
  return value;
}
