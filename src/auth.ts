import crypto from "crypto";

// ──────────────────────────────────────────
// HTML Escaping (Fix XSS)
// ──────────────────────────────────────────
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ──────────────────────────────────────────
// JWT Helper Functions
// ──────────────────────────────────────────
function base64url(buffer: Buffer): string {
  return buffer.toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

export function signJwt(payload: object, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac("sha256", secret).update(signatureInput).digest();
  const encodedSignature = base64url(signature);

  return `${signatureInput}.${encodedSignature}`;
}

export function verifyJwt(token: string, secret: string): any {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = base64url(
      crypto.createHmac("sha256", secret).update(signatureInput).digest()
    );

    // Timing-safe comparison to prevent signature brute-force attacks
    const sigBuffer = Buffer.from(encodedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return null;
    }

    const payload = JSON.parse(base64urlDecode(encodedPayload));
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null; // expired
    }
    return payload;
  } catch (error) {
    return null;
  }
}

// ──────────────────────────────────────────
// AES-256-CBC Encryption/Decryption
// ──────────────────────────────────────────
const ALGORITHM = "aes-256-cbc";

export function encrypt(text: string, secret: string): string {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decrypt(encryptedText: string, secret: string): string {
  const key = crypto.createHash("sha256").update(secret).digest();
  const [ivHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !encrypted) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ──────────────────────────────────────────
// PKCE Helper Functions
// ──────────────────────────────────────────
export function hashSha256(text: string): Buffer {
  return crypto.createHash("sha256").update(text).digest();
}

export function generateCodeChallenge(verifier: string): string {
  return base64url(hashSha256(verifier));
}

// ──────────────────────────────────────────
// CSRF Token Helpers (stateless, HMAC-signed)
// ──────────────────────────────────────────
export function generateCsrfToken(secret: string): string {
  const timestamp = Date.now().toString();
  const sig = crypto.createHmac("sha256", `csrf:${secret}`).update(timestamp).digest("hex");
  return `${timestamp}.${sig}`;
}

export function verifyCsrfToken(token: string, secret: string, maxAgeMs = 600_000): boolean {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return false;
  const timestamp = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  if (!timestamp || !sig) return false;

  const expectedSig = crypto.createHmac("sha256", `csrf:${secret}`).update(timestamp).digest("hex");

  // Timing-safe comparison
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return false;
  }

  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age < 0 || age > maxAgeMs) return false;

  return true;
}

// ──────────────────────────────────────────
// Token Store Interface and Implementations
// ──────────────────────────────────────────
export interface AuthCodeData {
  encryptedApiKey: string; // Always stored encrypted
  codeChallenge: string;
  clientId: string;
  redirectUri: string;
}

export interface ITokenStore {
  setAuthCode(code: string, data: AuthCodeData, ttlSeconds: number): Promise<void>;
  getAndRemoveAuthCode(code: string): Promise<AuthCodeData | null>;
}

export class MemoryTokenStore implements ITokenStore {
  private store = new Map<string, { data: AuthCodeData; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Periodically clean up expired entries to prevent memory leaks
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000); // every 5 minutes
    // Allow the process to exit even if the timer is running
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [code, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(code);
      }
    }
  }

  async setAuthCode(code: string, data: AuthCodeData, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(code, { data, expiresAt });
  }

  async getAndRemoveAuthCode(code: string): Promise<AuthCodeData | null> {
    const entry = this.store.get(code);
    if (!entry) return null;
    this.store.delete(code);
    if (Date.now() > entry.expiresAt) {
      return null;
    }
    return entry.data;
  }
}

/**
 * Redis-backed token store.
 * ioredis is loaded dynamically to avoid bloating stdio-mode installs.
 */
export class RedisTokenStore implements ITokenStore {
  private redis: any; // Typed as any since ioredis is dynamically imported
  private ready: Promise<void>;

  constructor(redisUrl: string) {
    this.ready = this.init(redisUrl);
  }

  private async init(redisUrl: string): Promise<void> {
    const { Redis } = await import("ioredis");
    this.redis = new Redis(redisUrl);
  }

  async setAuthCode(code: string, data: AuthCodeData, ttlSeconds: number): Promise<void> {
    await this.ready;
    const key = `auth_code:${code}`;
    await this.redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  }

  async getAndRemoveAuthCode(code: string): Promise<AuthCodeData | null> {
    await this.ready;
    const key = `auth_code:${code}`;

    // Atomic get-and-delete via Lua script to prevent race conditions
    // where the same auth code could be exchanged twice
    const lua = `
      local val = redis.call('GET', KEYS[1])
      if val then
        redis.call('DEL', KEYS[1])
      end
      return val
    `;
    const dataStr: string | null = await this.redis.eval(lua, 1, key);
    if (!dataStr) return null;

    try {
      return JSON.parse(dataStr) as AuthCodeData;
    } catch {
      return null;
    }
  }
}
