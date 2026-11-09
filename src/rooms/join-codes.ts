/**
 * Room credentials on the client (docs/specs/interview-platform.md §3.2).
 *
 * A join code is 8 characters of Crockford base-32, shown as `K7QM-2XRD`.
 * The participant link is `{site}#join=K7QM-2XRD`, the host link is
 * `{site}#host={secret}`. Fragments never reach a server log, and they work
 * on a static host without SPA fallback.
 */

export const JOIN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const JOIN_CODE_LENGTH = 8;

/**
 * Canonical 8-character code from whatever the user typed or pasted: the
 * displayed form, lowercase, with spaces, a whole participant link, or a code
 * read aloud with O for 0 and I or L for 1. Null when it cannot be a code.
 */
export function normalizeJoinCode(input: string | null | undefined): string | null {
  if (!input) return null;
  let text = input.trim();
  const fromLink = text.match(/[#&?]join=([^&\s]+)/i);
  if (fromLink) text = decodeURIComponent(fromLink[1]);

  let out = '';
  for (const raw of text) {
    if (raw === ' ' || raw === '-' || raw === '\t' || raw === '\n' || raw === '\r') continue;
    let c = raw.toUpperCase();
    if (c === 'O') c = '0';
    else if (c === 'I' || c === 'L') c = '1';
    if (!JOIN_CODE_ALPHABET.includes(c)) return null;
    if (out.length === JOIN_CODE_LENGTH) return null;
    out += c;
  }
  return out.length === JOIN_CODE_LENGTH ? out : null;
}

/** `K7QM2XRD` → `K7QM-2XRD`. Already-formatted input passes through. */
export function formatJoinCode(code: string): string {
  const canonical = normalizeJoinCode(code);
  if (!canonical) return code;
  return `${canonical.slice(0, 4)}-${canonical.slice(4)}`;
}

export type RoomCredential =
  | { kind: 'join'; code: string }
  | { kind: 'host'; secret: string };

/** Read `#join=` or `#host=` from a URL fragment. */
export function parseRoomFragment(hash: string | null | undefined): RoomCredential | null {
  if (!hash) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const join = params.get('join');
  if (join) {
    const code = normalizeJoinCode(join);
    return code ? { kind: 'join', code } : null;
  }
  const host = params.get('host');
  if (host && /^[A-Za-z0-9_-]{16,64}$/.test(host)) {
    return { kind: 'host', secret: host };
  }
  return null;
}

export function roomFragment(credential: RoomCredential): string {
  return credential.kind === 'join'
    ? `#join=${formatJoinCode(credential.code)}`
    : `#host=${credential.secret}`;
}

/** Where links point: the site root including Vite's base path, with a trailing slash. */
export function siteBase(): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${window.location.origin}${base.endsWith('/') ? base : `${base}/`}`;
}

export function participantLink(code: string, base = siteBase()): string {
  return `${base}${roomFragment({ kind: 'join', code })}`;
}

export function hostLink(secret: string, base = siteBase()): string {
  return `${base}${roomFragment({ kind: 'host', secret })}`;
}
