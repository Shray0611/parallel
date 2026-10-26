const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem("leadscope_token");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const normalizedPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const fullUrl = `${API_URL}${normalizedPath.startsWith("/api") ? normalizedPath : `/api${normalizedPath}`}`;

  const response = await fetch(fullUrl, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || `Request failed with status ${response.status}`;
    const code = data?.error?.code || "REQUEST_FAILED";
    const error: any = new Error(message);
    error.code = code;
    error.status = response.status;
    throw error;
  }

  return data as T;
}
