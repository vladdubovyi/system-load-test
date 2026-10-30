import { test as base, expect, type BrowserContext, type Route } from '@playwright/test';
import {
  CHALLENGES,
  COMPONENT_DEFINITIONS,
  TEST_PASSWORD,
  TEST_TOKEN,
  TEST_USER,
  type ApiChallenge,
  type ApiComponentDefinition,
} from './api-data';

export interface ApiMockOptions {
  challenges?: ApiChallenge[];
  components?: ApiComponentDefinition[];
  /** Token that `GET /api/auth/me` accepts. Defaults to TEST_TOKEN. */
  validToken?: string | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * In-browser mock of the BreakIT API. Routes are installed on the browser
 * context so they also apply to pages opened via `window.open` (the challenge
 * "Launch" links). Later `route()` registrations win, so a test can call
 * `api.unavailable()` after the default mock to simulate a dead backend.
 */
export class ApiMock {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly context: BrowserContext) {}

  async install(options: ApiMockOptions = {}): Promise<void> {
    const challenges = options.challenges ?? CHALLENGES;
    const components = options.components ?? COMPONENT_DEFINITIONS;
    const validToken = options.validToken === undefined ? TEST_TOKEN : options.validToken;

    await this.context.route(isApiUrl, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const path = url.pathname;
      this.requests.push({
        method,
        path,
        headers: request.headers(),
        body: safeJson(request.postData()),
      });

      const json = (status: number, body: unknown) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

      if (method === 'GET' && path === '/api/challenges') return json(200, challenges);
      if (method === 'GET' && path === '/api/components') return json(200, components);

      const slugMatch = path.match(/^\/api\/challenges\/slug\/([^/]+)$/);
      if (method === 'GET' && slugMatch) {
        const found = challenges.find((c) => c.slug === slugMatch[1]);
        return found ? json(200, found) : json(404, { error: 'Challenge not found' });
      }

      if (method === 'GET' && path === '/api/auth/me') {
        const auth = request.headers()['authorization'];
        if (validToken && auth === `Bearer ${validToken}`) return json(200, TEST_USER);
        return json(401, { error: 'Unauthorized' });
      }

      if (method === 'POST' && path === '/api/auth/login') {
        const body = safeJson(request.postData()) as { email?: string; password?: string } | null;
        if (body?.email === TEST_USER.email && body?.password === TEST_PASSWORD) {
          return json(200, { token: TEST_TOKEN, user: TEST_USER });
        }
        return json(401, { error: 'Invalid email or password' });
      }

      if (method === 'POST' && path === '/api/auth/register') {
        const body = safeJson(request.postData()) as
          | { email?: string; password?: string; displayName?: string }
          | null;
        if (!body?.email || !body?.password) return json(400, { error: 'Email and password are required' });
        if (body.email === TEST_USER.email) return json(409, { error: 'Email already registered' });
        return json(200, {
          token: TEST_TOKEN,
          user: { id: 'user-new', email: body.email, displayName: body.displayName || body.email, avatarUrl: null },
        });
      }

      return json(404, { error: `Unmocked API route: ${method} ${path}` });
    });
  }

  /** Simulate the backend being down: every API call fails at the network level. */
  async unavailable(): Promise<void> {
    await this.context.route(isApiUrl, (route: Route) => route.abort('connectionrefused'));
  }

  calls(path: string, method?: string): RecordedRequest[] {
    return this.requests.filter((r) => r.path === path && (!method || r.method === method));
  }
}

/**
 * Match only real API calls. A plain `**\/api/**` glob would also catch the
 * app's own module `/src/api/client.ts` served by Vite and break the bundle.
 */
function isApiUrl(url: URL): boolean {
  return url.pathname.startsWith('/api/');
}

function safeJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Third-party hosts the app references (Google Fonts, YouTube embeds, Google
 * Sign-In). Blocking them keeps the suite hermetic and fast.
 */
const EXTERNAL_HOSTS = [
  'https://fonts.googleapis.com/**',
  'https://fonts.gstatic.com/**',
  'https://www.youtube.com/**',
  'https://accounts.google.com/**',
];

type Fixtures = {
  api: ApiMock;
};

export const test = base.extend<Fixtures>({
  api: [
    async ({ context }, use) => {
      for (const pattern of EXTERNAL_HOSTS) {
        await context.route(pattern, (route) => route.abort('blockedbyclient'));
      }
      const api = new ApiMock(context);
      await api.install();
      await use(api);
    },
    { auto: true },
  ],
});

export { expect };
