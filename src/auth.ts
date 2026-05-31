import crypto from "crypto";
import { Redis } from "ioredis";

// JWT Helper Functions
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
    const expectedSignature = base64url(crypto.createHmac("sha256", secret).update(signatureInput).digest());
    
    if (encodedSignature !== expectedSignature) return null;
    
    const payload = JSON.parse(base64urlDecode(encodedPayload));
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null; // expired
    }
    return payload;
  } catch (error) {
    return null;
  }
}

// AES-256-CBC Encryption/Decryption helper
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

// PKCE Helper Functions
export function hashSha256(text: string): Buffer {
  return crypto.createHash("sha256").update(text).digest();
}

export function generateCodeChallenge(verifier: string): string {
  return base64url(hashSha256(verifier));
}

// Token Store Interface and Implementations
export interface AuthCodeData {
  apiKey: string;
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

export class RedisTokenStore implements ITokenStore {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async setAuthCode(code: string, data: AuthCodeData, ttlSeconds: number): Promise<void> {
    const key = `auth_code:${code}`;
    await this.redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  }

  async getAndRemoveAuthCode(code: string): Promise<AuthCodeData | null> {
    const key = `auth_code:${code}`;
    const dataStr = await this.redis.get(key);
    if (!dataStr) return null;
    await this.redis.del(key);
    try {
      return JSON.parse(dataStr) as AuthCodeData;
    } catch {
      return null;
    }
  }
}
