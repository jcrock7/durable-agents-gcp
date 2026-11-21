import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../dist/app.js";
import { iapVerifier, isCrossSite } from "../dist/iap.js";
import type { KubernetesSource, LiteLLMSource, TemporalSource } from "../dist/sources.js";

const PROJECT = "123456789";
const AUD = `/projects/${PROJECT}/global/backendServices/42`;
const google = generateKeyPairSync("ec", { namedCurve: "P-256" });
const stranger = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwks = [{ ...google.publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256" }];
const nowS = () => Math.floor(Date.now() / 1000);

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function token(claims: Record<string, unknown> = {}, opts: { key?: KeyObject; header?: Record<string, unknown> } = {}): string {
  const body = `${b64({ alg: "ES256", typ: "JWT", kid: "k1", ...opts.header })}.${b64({
    iss: "https://cloud.google.com/iap",
    aud: AUD,
    email: "me@example.com",
    iat: nowS() - 5,
    exp: nowS() + 600,
    ...claims,
  })}`;
  const signature = sign("sha256", Buffer.from(body), { key: opts.key ?? google.privateKey, dsaEncoding: "ieee-p1363" });
  return `${body}.${signature.toString("base64url")}`;
}

const fetchKeys = vi.fn(async () => jwks);
const verifier = iapVerifier({ projectNumber: PROJECT, fetchKeys });

describe("IAP token verification", () => {
  it("accepts a token IAP signed for this project", async () => {
    await expect(verifier.verify(token())).resolves.toEqual({ email: "me@example.com" });
  });

  it("refuses tokens that are forged, for someone else, or out of date", async () => {
    const refused: Array<[string, string]> = [
      ["signed by another key", token({}, { key: stranger.privateKey })],
      ["unsigned (alg none)", `${b64({ alg: "none", kid: "k1" })}.${b64({ iss: "https://cloud.google.com/iap", aud: AUD, email: "a@b.c", iat: nowS(), exp: nowS() + 60 })}.`],
      ["symmetric algorithm", token({}, { header: { alg: "HS256" } })],
      ["another project's backend", token({ aud: "/projects/999/global/backendServices/42" })],
      ["another issuer", token({ iss: "https://accounts.google.com" })],
      ["expired", token({ exp: nowS() - 3600 })],
      ["no email", token({ email: undefined })],
      ["not a token", "abc"],
    ];
    for (const [why, t] of refused) await expect(verifier.verify(t), why).rejects.toThrow();
    // A claim changed after signing.
    const [h, , s] = token().split(".");
    await expect(verifier.verify(`${h}.${b64({ iss: "https://cloud.google.com/iap", aud: AUD, email: "evil@example.com", iat: nowS(), exp: nowS() + 60 })}.${s}`)).rejects.toThrow("bad signature");
  });

  it("does not refetch keys for every unknown key ID", async () => {
    fetchKeys.mockClear();
    await expect(verifier.verify(token({}, { header: { kid: "made-up-1" } }))).rejects.toThrow("unknown signing key");
    await expect(verifier.verify(token({}, { header: { kid: "made-up-2" } }))).rejects.toThrow("unknown signing key");
    expect(fetchKeys).not.toHaveBeenCalled();
  });

  it("needs a numeric project number", () => {
    expect(() => iapVerifier({ projectNumber: "PROJECT_NUMBER" })).toThrow();
  });
});

describe("portal API behind IAP", () => {
  const temporal = {
    listRuns: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    query: vi.fn(async () => undefined),
    update: vi.fn(async () => ({ accepted: true }) as never),
    signal: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    healthy: vi.fn(async () => true),
  } satisfies TemporalSource;
  const litellm: LiteLLMSource = { keys: vi.fn(async () => []), healthy: vi.fn(async () => true) };
  const kubernetes: KubernetesSource = { deployments: vi.fn(async () => []), postgresReady: vi.fn(async () => true) };
  const app = buildApp({ temporal, litellm, kubernetes, iap: verifier });
  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it("refuses requests without a valid token, even with the identity header set", async () => {
    const spoofed = { "x-goog-authenticated-user-email": "accounts.google.com:attacker@example.com" };
    expect((await app.inject({ url: "/api/me", headers: spoofed })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/me", headers: { ...spoofed, "x-goog-iap-jwt-assertion": token({}, { key: stranger.privateKey }) } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/cases/inv-20931/review", headers: spoofed, payload: { approved: true } })).statusCode).toBe(401);
    expect(temporal.update).not.toHaveBeenCalled();
  });

  it("takes the user from the token, not from the header", async () => {
    const res = await app.inject({
      url: "/api/me",
      headers: { "x-goog-authenticated-user-email": "accounts.google.com:attacker@example.com", "x-goog-iap-jwt-assertion": token() },
    });
    expect(res.json()).toMatchObject({ user: "me@example.com", source: "iap" });
  });

  it("keeps /healthz open for load balancer health checks", async () => {
    expect((await app.inject("/healthz")).statusCode).toBe(200);
  });

  it("refuses state-changing requests sent from another site", async () => {
    const signedIn = { "x-goog-iap-jwt-assertion": token(), host: "agents.example.com" };
    const post = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/api/agents/invoice-exception-resolver/queue", headers: { ...signedIn, ...headers } });
    expect((await post({ "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
    expect((await post({ "sec-fetch-site": "same-site" })).statusCode).toBe(403);
    expect((await post({ origin: "https://evil.example" })).statusCode).toBe(403);
    expect(temporal.start).not.toHaveBeenCalled();
    expect((await post({ "sec-fetch-site": "same-origin", origin: "https://agents.example.com" })).statusCode).toBe(200);
    expect((await post({ origin: "https://agents.example.com" })).statusCode).toBe(200);
    expect((await post({})).statusCode).toBe(200); // not a browser
  });

  it("tells same-origin from cross-site", () => {
    expect(isCrossSite({ host: "a.example", origin: "https://a.example" })).toBe(false);
    expect(isCrossSite({ host: "a.example", origin: "null" })).toBe(true);
    expect(isCrossSite({ host: "a.example" })).toBe(false);
  });
});
