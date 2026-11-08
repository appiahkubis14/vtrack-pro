/**
 * V-Track Pro frontend API client.
 *
 * Every backend response is wrapped by a global TransformInterceptor as
 * { data: <original return value> } UNLESS the original return value
 * already has its own `.data` key (e.g. VehiclesService.findAll() returns
 * { data, total, page, limit } directly, so the interceptor leaves it as-is
 * instead of double-wrapping). That means the shape of `.data` varies by
 * endpoint - documented on each call site below so nothing here is guessed:
 *
 *   GET  /vehicles        -> { data: Vehicle[], total, page, limit }
 *   GET  /devices          -> { data: [Device[], count] }        (a tuple!)
 *   GET  /alerts            -> { data: Alert[] }
 *   GET  /dashboard/overview -> { data: { totalVehicles, ... } }
 *   GET  /vehicles/:id/digital-twin -> { data: TwinState | null }
 *   GET  /twin/fleet?vehicleIds=a,b -> { data: { [vehicleId]: TwinState|null } }
 */
const VTrackAPI = (() => {
  // On a real server the website and the API share one address (the reverse proxy sends /api to the backend);
  // on a developer's machine the API is on port 3000. window.VTRACK_API_BASE_URL overrides both.
  const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
  const BASE_URL = window.VTRACK_API_BASE_URL || (IS_LOCAL ? 'http://localhost:3000/api' : `${window.location.origin}/api`);
  const TOKEN_KEY = 'vtrack_token';
  const REFRESH_KEY = 'vtrack_refresh_token';
  const USER_KEY = 'vtrack_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function setSession({ accessToken, refreshToken, user }) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function isAuthed() {
    return Boolean(getToken());
  }

  /** Redirects to login unless already authenticated. Call at the top of every protected page. */
  function requireAuth() {
    if (!isAuthed()) {
      const here = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `login.html?next=${here}`;
      return;
    }
    // An account created by an administrator must choose its own password before anything else.
    const u = getUser();
    if (u && u.mustChangePassword && !/change-password\.html$/.test(window.location.pathname)) {
      window.location.href = 'change-password.html';
    }
  }

  /** Where each kind of user lands after signing in. */
  function homeFor(user) {
    if (user && user.mustChangePassword) return 'change-password.html';
    if (user && user.role === 'investor') return 'investor.html';
    if (user && user.role === 'rider') return 'rider-portal.html';
    return 'dashboard.html';
  }

  function updateUser(patch) {
    const u = getUser();
    if (u) localStorage.setItem(USER_KEY, JSON.stringify({ ...u, ...patch }));
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      clearSession();
      const here = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `login.html?next=${here}`;
      throw new Error('Unauthorized - redirecting to login');
    }

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const message = json?.detail || json?.message || `Request failed with status ${res.status}`;
      throw new Error(message);
    }

    return json;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),

    async login(email, password, twoFactorCode) {
      const res = await request('POST', '/auth/login', { email, password, twoFactorCode });
      setSession(res.data);
      return res.data;
    },

    logout() {
      clearSession();
      window.location.href = 'login.html';
    },

    getToken,
    getUser,
    homeFor,
    updateUser,
    isAuthed,
    requireAuth,
    baseUrl: BASE_URL,
    // WebSocket base derived from the API base (strip /api suffix).
    wsBaseUrl: BASE_URL.replace(/\/api\/?$/, ''),
  };
})();

// Top-level `const` in a classic script does NOT become a window property -
// only `var` and function declarations do that automatically. Without this
// explicit assignment, every page's `window.VTrackAPI.xxx` call fails with
// "Cannot read properties of undefined" even though this file loads and
// executes with no errors, which is exactly what made this bug so easy to
// miss with syntax-only checks.
window.VTrackAPI = VTrackAPI;
