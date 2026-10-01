"use server";

import { redirect } from "next/navigation";
import { act, bool, str, withParam } from "@/lib/actions";
import { clearCustomerCookie, clientIp, currentCustomer, deviceId, setCustomerCookie } from "@/lib/auth/current";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/crypto/random";
import { openDemoEnabled } from "@/lib/demo/open";
import { idempotent } from "@/lib/services/core";
import { cancelShopRequest, finishShopSignIn, joinShop, reportShopProblem, requestOrder, setShopPlace, startShopSignIn } from "@/lib/services/shop";

/** Joining and signing in are rate-limited per network as well as per phone (the code itself allows 3 per 15 minutes). */
async function limited(kind: string, back: string, max: number): Promise<void> {
  const ip = await clientIp();
  const rl = await hitRateLimit(`shop-${kind}:${sha256Hex(ip).slice(0, 16)}`, max, 300);
  if (!rl.allowed) redirect(withParam(back, "error", "rate_limited"));
}

async function opts() {
  return { deviceId: await deviceId(), ip: await clientIp(), openDemo: await openDemoEnabled() };
}

const verifyPath = (challengeId: string) => `/shop/verify?c=${encodeURIComponent(challengeId)}`;

export async function joinShopAction(fd: FormData): Promise<void> {
  await limited("join", "/shop/join", 20);
  const o = await opts();
  await act(
    "/shop/join",
    () =>
      joinShop(
        {
          displayName: str(fd, "displayName"),
          phone: str(fd, "phone"),
          meetingPointId: str(fd, "meetingPointId"),
          consentMessages: bool(fd, "consentMessages") as true,
          consentReminders: bool(fd, "consentReminders"),
        },
        o,
      ),
    (r) => verifyPath(r.challengeId),
    "codeSent",
  );
}

export async function signInShopAction(fd: FormData): Promise<void> {
  await limited("signin", "/shop/sign-in", 20);
  const o = await opts();
  await act("/shop/sign-in", () => startShopSignIn(str(fd, "phone"), o), (r) => verifyPath(r.challengeId), "codeSent");
}

export async function verifyShopAction(fd: FormData): Promise<void> {
  const challengeId = str(fd, "challengeId");
  await limited("verify", verifyPath(challengeId), 30);
  await act(
    verifyPath(challengeId),
    async () => {
      const r = await finishShopSignIn(challengeId, str(fd, "code"));
      await setCustomerCookie(r.token, r.expiresAt);
      return r;
    },
    "/shop",
    "signedIn",
  );
}

export async function signOutShopAction(): Promise<void> {
  await clearCustomerCookie();
  redirect(withParam("/shop", "ok", "signedOut"));
}

async function customerOrSignIn() {
  const c = await currentCustomer();
  if (!c) redirect("/shop/sign-in?expired=1");
  return c;
}

/** A double tap or a retried request on a slow network applies once (keyed to the customer, like staff actions). */
async function once<T extends object | null>(customerId: string, fd: FormData, action: string, fn: () => Promise<T>): Promise<T> {
  return (await idempotent(customerId, str(fd, "idem"), action, fn)).result;
}

export async function requestOrderAction(fd: FormData): Promise<void> {
  const c = await customerOrSignIn();
  await act("/shop", () => once(c.id, fd, "shop.requestOrder", () => requestOrder(c, { productId: str(fd, "productId"), meetingPointId: str(fd, "meetingPointId"), womenOnly: bool(fd, "womenOnly") })), "/shop", "requested");
}

export async function cancelRequestAction(fd: FormData): Promise<void> {
  const c = await customerOrSignIn();
  await act("/shop", () => once(c.id, fd, "shop.cancelRequest", () => cancelShopRequest(c, str(fd, "requestId")).then(() => ({}))), "/shop", "cancelled");
}

export async function setShopPlaceAction(fd: FormData): Promise<void> {
  const c = await customerOrSignIn();
  await act("/shop", () => once(c.id, fd, "shop.setPlace", () => setShopPlace(c, str(fd, "meetingPointId")).then(() => ({}))), "/shop", "placeSaved");
}

/** "Report a problem" on an accepted order: to the admins, never to the seller (Prompt L §3). */
export async function reportProblemAction(fd: FormData): Promise<void> {
  const c = await customerOrSignIn();
  const category = str(fd, "category") as "unsafe" | "money" | "other";
  await act("/shop", () => once(c.id, fd, "shop.report", () => reportShopProblem(c, { requestId: str(fd, "requestId"), category, note: str(fd, "note") })), "/shop", "reported");
}
