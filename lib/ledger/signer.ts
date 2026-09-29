/**
 * Signer interface (review correction §4.8).
 *  - EnvKeySigner: private key from ANCHOR_SIGNER_KEY. Testnet only; production refuses to start with it.
 *  - KmsSigner: secp256k1 signing in a cloud KMS. The client is an interface (cloud not chosen; gate G5).
 */
import { privateKeyToAccount, type Account } from "viem/accounts";
import { appEnv, optionalSecret } from "@/lib/env";
import type { Hex } from "viem";

export interface Signer {
  readonly kind: "env" | "kms";
  account(): Promise<Account>;
}

export class EnvKeySigner implements Signer {
  readonly kind = "env" as const;
  private readonly acct: Account;
  constructor(privateKey: Hex) {
    if (appEnv() === "production") throw new Error("Production refuses to start with an env private key (gate G5): configure a KMS signer");
    this.acct = privateKeyToAccount(privateKey);
  }
  async account(): Promise<Account> {
    return this.acct;
  }
}

/** Minimal KMS signing surface; implement for AWS KMS / GCP KMS once chosen. */
export interface KmsSignClient {
  publicKey(keyId: string): Promise<Hex>; // uncompressed secp256k1 public key
  signDigest(keyId: string, digest: Hex): Promise<{ r: Hex; s: Hex; v: number }>;
}

export class KmsSigner implements Signer {
  readonly kind = "kms" as const;
  constructor(
    private readonly client: KmsSignClient,
    private readonly keyId: string,
  ) {}
  async account(): Promise<Account> {
    void this.client;
    void this.keyId;
    throw new Error("KMS signer not implemented — choose a cloud KMS and implement KmsSignClient (docs/DECISIONS.md, gate G5)");
  }
}

/** Returns null when no signer is configured (anchoring disabled). */
export function getSigner(): Signer | null {
  const kmsKey = optionalSecret("ANCHOR_KMS_KEY_ID");
  if (kmsKey) {
    return new KmsSigner(
      {
        publicKey: async () => {
          throw new Error("KMS not implemented");
        },
        signDigest: async () => {
          throw new Error("KMS not implemented");
        },
      },
      kmsKey,
    );
  }
  const envKey = optionalSecret("ANCHOR_SIGNER_KEY");
  if (envKey && /^0x[0-9a-fA-F]{64}$/.test(envKey)) return new EnvKeySigner(envKey as Hex);
  return null;
}
