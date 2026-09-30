import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { FieldShell } from "@/components/shell";
import { DemoBanner } from "@/components/demo-banner";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { requireField } from "@/lib/auth/current";
import { logoutField } from "@/app/actions/session";

export const dynamic = "force-dynamic";

export default async function FieldLayout({ children }: { children: ReactNode }) {
  const { session } = await requireField();
  const t = await getTranslations("roles");
  const h = await headers();
  const path = h.get("x-invoke-path") ?? "/home";
  return (
    <FieldShell roleLabel={t(session.user.role)} name={session.user.displayName} path={path} logout={logoutField} switchRole={session.via === "OPEN_DEMO"}>
      <DemoBanner />
      <ServiceWorkerRegister />
      {children}
    </FieldShell>
  );
}
