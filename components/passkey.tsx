"use client";

/** Passkey login / registration using the browser WebAuthn API. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { passkeyAuthOptionsAction, passkeyAuthVerifyAction, passkeyRegisterOptionsAction, passkeyRegisterVerifyAction } from "@/app/admin/login/actions";

export function PasskeyLogin({ label, next }: { label: string; next: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      if (!browserSupportsWebAuthn()) throw new Error("unsupported");
      const options = (await passkeyAuthOptionsAction()) as PublicKeyCredentialRequestOptionsJSON | null;
      if (!options) throw new Error("no_passkey");
      const response = await startAuthentication({ optionsJSON: options });
      const r = await passkeyAuthVerifyAction(response);
      if (!r.ok) throw new Error("failed");
      router.push(next);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn btn-primary" onClick={go} disabled={busy} data-testid="passkey-login">
        {label}
      </button>
      {msg ? <p className="text-sm text-red-700">{msg}</p> : null}
    </div>
  );
}

export function PasskeyRegister({ label, done }: { label: string; done: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      if (!browserSupportsWebAuthn()) throw new Error("unsupported");
      const options = (await passkeyRegisterOptionsAction()) as PublicKeyCredentialCreationOptionsJSON | null;
      if (!options) throw new Error("no_session");
      const response = await startRegistration({ optionsJSON: options });
      const r = await passkeyRegisterVerifyAction(response);
      setMsg(r.ok ? done : "failed");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn btn-primary" onClick={go} disabled={busy} data-testid="passkey-register">
        {label}
      </button>
      {msg ? <p className="text-sm">{msg}</p> : null}
    </div>
  );
}
