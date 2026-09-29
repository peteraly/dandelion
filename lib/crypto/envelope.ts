/**
 * Application-level envelope encryption for personal data (phone numbers,
 * payout accounts). Each value gets its own random data key (DEK), which is
 * wrapped by a key-encryption key (KEK) held by a KeyProvider.
 *
 * - LocalKeyProvider: KEK from the DATA_KEK env var. Development/preview only;
 *   production needs ALLOW_ENV_DATA_KEY=true explicitly (reported as gate G5 not met).
 * - KmsKeyProvider: KEK lives in a cloud KMS. The client is an interface;
 *   which cloud is an open decision (see docs/DECISIONS.md).
 *
 * Format: "v1.<kid>.<wrappedDek>.<iv>.<ciphertext>.<tag>" (base64url parts).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appEnv, secret } from "@/lib/env";

export interface KeyProvider {
  readonly kid: string;
  wrap(dek: Buffer): Promise<string>;
  unwrap(wrapped: string): Promise<Buffer>;
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; ct: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv, ct, tag: c.getAuthTag() };
}

function aesGcmDecrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export class LocalKeyProvider implements KeyProvider {
  readonly kid: string;
  private readonly kek: Buffer;
  constructor(kekBase64: string, kid = "local1") {
    const kek = Buffer.from(kekBase64, "base64");
    if (kek.length !== 32) throw new Error("DATA_KEK must be 32 bytes, base64");
    this.kek = kek;
    this.kid = kid;
  }
  async wrap(dek: Buffer): Promise<string> {
    const { iv, ct, tag } = aesGcmEncrypt(this.kek, dek);
    return [iv, ct, tag].map((b) => b.toString("base64url")).join("~");
  }
  async unwrap(wrapped: string): Promise<Buffer> {
    const [iv, ct, tag] = wrapped.split("~").map((s) => Buffer.from(s, "base64url"));
    if (!iv || !ct || !tag) throw new Error("Malformed wrapped key");
    return aesGcmDecrypt(this.kek, iv, ct, tag);
  }
}

/** Minimal KMS surface we need; implement for AWS KMS or GCP KMS once chosen. */
export interface KmsEncryptClient {
  encrypt(keyId: string, plaintext: Buffer): Promise<Buffer>;
  decrypt(keyId: string, ciphertext: Buffer): Promise<Buffer>;
}

export class KmsKeyProvider implements KeyProvider {
  constructor(
    private readonly client: KmsEncryptClient,
    private readonly keyId: string,
    readonly kid = "kms1",
  ) {}
  async wrap(dek: Buffer): Promise<string> {
    return (await this.client.encrypt(this.keyId, dek)).toString("base64url");
  }
  async unwrap(wrapped: string): Promise<Buffer> {
    return this.client.decrypt(this.keyId, Buffer.from(wrapped, "base64url"));
  }
}

class UnconfiguredKmsClient implements KmsEncryptClient {
  async encrypt(): Promise<Buffer> {
    throw new Error("KMS client not implemented yet — choose a cloud KMS (see docs/DECISIONS.md, gate G5)");
  }
  async decrypt(): Promise<Buffer> {
    throw new Error("KMS client not implemented yet — choose a cloud KMS (see docs/DECISIONS.md, gate G5)");
  }
}

const DEV_KEK = Buffer.alloc(32, 7).toString("base64"); // clearly fake, dev only

let provider: KeyProvider | null = null;

export function dataKeyStatus(): "kms" | "env" | "env-dev" {
  if (process.env.KMS_DATA_KEY_ID) return "kms";
  return appEnv() === "development" ? "env-dev" : "env";
}

export function getKeyProvider(): KeyProvider {
  if (provider) return provider;
  if (process.env.KMS_DATA_KEY_ID) {
    provider = new KmsKeyProvider(new UnconfiguredKmsClient(), process.env.KMS_DATA_KEY_ID);
    return provider;
  }
  if (appEnv() === "production" && process.env.ALLOW_ENV_DATA_KEY !== "true") {
    throw new Error("Production requires a KMS data key (KMS_DATA_KEY_ID) or explicit ALLOW_ENV_DATA_KEY=true (pre-launch only)");
  }
  provider = new LocalKeyProvider(secret("DATA_KEK", DEV_KEK));
  return provider;
}

/** For tests only. */
export function setKeyProviderForTests(p: KeyProvider | null): void {
  provider = p;
}

const dekCache = new Map<string, Buffer>();

export async function encryptString(plaintext: string): Promise<string> {
  const kp = getKeyProvider();
  const dek = randomBytes(32);
  const wrapped = await kp.wrap(dek);
  const { iv, ct, tag } = aesGcmEncrypt(dek, Buffer.from(plaintext, "utf8"));
  return ["v1", kp.kid, wrapped, iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

export async function decryptString(blob: string): Promise<string> {
  const parts = blob.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") throw new Error("Unsupported ciphertext format");
  const [, , wrapped, iv, ct, tag] = parts as [string, string, string, string, string, string];
  let dek = dekCache.get(wrapped);
  if (!dek) {
    dek = await getKeyProvider().unwrap(wrapped);
    if (dekCache.size > 5000) dekCache.clear();
    dekCache.set(wrapped, dek);
  }
  return aesGcmDecrypt(dek, Buffer.from(iv, "base64url"), Buffer.from(ct, "base64url"), Buffer.from(tag, "base64url")).toString("utf8");
}
