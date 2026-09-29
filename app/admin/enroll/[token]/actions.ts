"use server";

import { act, str } from "@/lib/actions";
import { completeAdminEnrollment } from "@/lib/services/users";

export async function adminEnrollAction(fd: FormData): Promise<void> {
  const token = str(fd, "token");
  await act(`/admin/enroll/${token}`, () => completeAdminEnrollment(token, str(fd, "passphrase"), str(fd, "totp")), "/admin/login", "enrolled");
}
