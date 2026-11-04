const TOKEN_KEY = 'xinoia.token';

// O token chega no fragmento da URL de abertura, que nunca vai para o servidor. Depois
// de lido, some da barra de endereços.
function readToken(): string {
  const match = /[#&]token=([^&]+)/.exec(window.location.hash);
  try {
    if (match?.[1]) {
      sessionStorage.setItem(TOKEN_KEY, match[1]);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return match[1];
    }
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return match?.[1] ?? '';
  }
}

export const token = readToken();

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Não foi possível falar com o XinoIA.');
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? 'error', data.message ?? `Erro ${response.status}.`);
  }
  return data as T;
}

export const api = {
  get: <T,>(url: string) => request<T>('GET', url),
  post: <T,>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T,>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T,>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: (url: string) => request<void>('DELETE', url),
};

export function wsUrl(path: string, params: Record<string, string | number> = {}): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({ token, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  return `${protocol}//${window.location.host}${path}?${query}`;
}
