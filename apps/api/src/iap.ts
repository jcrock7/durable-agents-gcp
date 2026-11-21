// Identity-Aware Proxy tokens. IAP signs every request it lets through (header
// x-goog-iap-jwt-assertion, ES256). Checking that signature here means the portal does not rely
// on the load balancer alone: a request that reaches the pod some other way, or after IAP is
// switched off by mistake, carries no valid token and is refused.
// https://cloud.google.com/iap/docs/signed-headers-howto
import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from "node:crypto";

export const IAP_JWT_HEADER = "x-goog-iap-jwt-assertion";
const IAP_ISSUER = "https://cloud.google.com/iap";
const IAP_KEYS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
const KEYS_MAX_AGE_MS = 60 * 60 * 1000;
const KEYS_MIN_REFETCH_MS = 60 * 1000;
const CLOCK_SKEW_S = 30;

export interface IapIdentity {
  email: string;
}

export interface IapVerifier {
  /** The signed-in user, or an error saying why the token is not acceptable. */
  verify(token: string): Promise<IapIdentity>;
}

type Jwk = JsonWebKey & { kid?: string };

export interface IapVerifierOptions {
  /** Google Cloud project number. Tokens must be for a backend service of this project. */
  projectNumber: string;
  /** Where the public keys come from; replaced in tests. */
  fetchKeys?: () => Promise<Jwk[]>;
  now?: () => number;
}

async function fetchGoogleKeys(): Promise<Jwk[]> {
  const res = await fetch(IAP_KEYS_URL, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`IAP public keys: HTTP ${res.status}`);
  return ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
}

const decode = (part: string): unknown => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

export function iapVerifier(options: IapVerifierOptions): IapVerifier {
  if (!/^\d+$/.test(options.projectNumber)) throw new Error("IAP project number must be numeric");
  const audiencePrefix = `/projects/${options.projectNumber}/global/backendServices/`;
  const fetchKeys = options.fetchKeys ?? fetchGoogleKeys;
  const now = options.now ?? Date.now;

  let keys = new Map<string, KeyObject>();
  let fetchedAt = 0;
  async function keyFor(kid: string): Promise<KeyObject | undefined> {
    const age = now() - fetchedAt;
    // Refresh hourly, and at once for a key ID we have not seen (Google rotates keys), but not
    // more than once a minute so made-up key IDs cannot make us hammer the key server.
    if (age > KEYS_MAX_AGE_MS || (!keys.has(kid) && age > KEYS_MIN_REFETCH_MS)) {
      const fresh = new Map<string, KeyObject>();
      for (const jwk of await fetchKeys()) if (jwk.kid) fresh.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
      keys = fresh;
      fetchedAt = now();
    }
    return keys.get(kid);
  }

  return {
    async verify(token) {
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("malformed token");
      const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
      let header: { alg?: unknown; kid?: unknown };
      let claims: { iss?: unknown; aud?: unknown; exp?: unknown; iat?: unknown; email?: unknown };
      try {
        header = decode(headerPart) as typeof header;
        claims = decode(payloadPart) as typeof claims;
      } catch {
        throw new Error("malformed token");
      }
      // Only the algorithm IAP uses: never "none", never a symmetric one.
      if (header.alg !== "ES256" || typeof header.kid !== "string") throw new Error("unexpected algorithm or key");
      const key = await keyFor(header.kid);
      if (!key) throw new Error("unknown signing key");
      const signed = Buffer.from(`${headerPart}.${payloadPart}`);
      const signature = Buffer.from(signaturePart, "base64url");
      if (!verifySignature("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, signature)) throw new Error("bad signature");

      const seconds = now() / 1000;
      if (claims.iss !== IAP_ISSUER) throw new Error("wrong issuer");
      if (typeof claims.aud !== "string" || !claims.aud.startsWith(audiencePrefix)) throw new Error("wrong audience");
      if (typeof claims.exp !== "number" || claims.exp < seconds - CLOCK_SKEW_S) throw new Error("expired");
      if (typeof claims.iat !== "number" || claims.iat > seconds + CLOCK_SKEW_S) throw new Error("issued in the future");
      if (typeof claims.email !== "string" || !claims.email) throw new Error("no email");
      return { email: claims.email };
    },
  };
}

/**
 * Whether a state-changing request may have been sent by another website using the visitor's
 * session (cross-site request forgery). Browsers say where a request came from (Sec-Fetch-Site,
 * or Origin on older ones); clients that are not browsers send neither and are not at risk.
 */
export function isCrossSite(headers: Record<string, string | string[] | undefined>): boolean {
  const site = headers["sec-fetch-site"];
  if (typeof site === "string" && site) return site !== "same-origin" && site !== "none";
  const origin = headers.origin;
  if (typeof origin !== "string" || !origin) return false;
  try {
    return new URL(origin).host !== headers.host;
  } catch {
    return true;
  }
}
