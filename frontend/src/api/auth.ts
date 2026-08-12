const KEY = "edipo_auth";

export function setCredentials(username: string, password: string): void {
  sessionStorage.setItem(KEY, btoa(`${username}:${password}`));
}

export function getAuthHeader(): string | null {
  const token = sessionStorage.getItem(KEY);
  return token ? `Basic ${token}` : null;
}

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(KEY) !== null;
}

export function clearCredentials(): void {
  sessionStorage.removeItem(KEY);
}
