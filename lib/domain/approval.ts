/**
 * Dual approval rules (invariant §3.14). Pure.
 *
 * The requester's request counts as their signature. Approval needs
 * `threshold` DISTINCT admins in total, the requester included, and the
 * requester can never add an approval to their own request. Any rejection
 * by another admin rejects the request.
 */

export const MIN_APPROVAL_THRESHOLD = 2;

export interface ApprovalDecision {
  adminId: string;
  decision: "APPROVE" | "REJECT";
}

export interface ApprovalEvaluationInput {
  requesterId: string;
  decisions: readonly ApprovalDecision[];
  threshold: number;
}

export type ApprovalEvaluation =
  | { status: "PENDING"; signatures: number; needed: number }
  | { status: "APPROVED"; signatures: number; approverIds: string[] }
  | { status: "REJECTED"; rejectedBy: string }
  | { status: "INVALID"; reason: string };

export function effectiveThreshold(configured: number): number {
  return Math.max(MIN_APPROVAL_THRESHOLD, Math.floor(configured));
}

export function evaluateApproval(input: ApprovalEvaluationInput): ApprovalEvaluation {
  const threshold = effectiveThreshold(input.threshold);
  if (input.decisions.some((d) => d.adminId === input.requesterId)) {
    return { status: "INVALID", reason: "self_approval" };
  }
  const seen = new Set<string>();
  for (const d of input.decisions) {
    if (seen.has(d.adminId)) return { status: "INVALID", reason: "duplicate_decision" };
    seen.add(d.adminId);
  }
  const rejection = input.decisions.find((d) => d.decision === "REJECT");
  if (rejection) return { status: "REJECTED", rejectedBy: rejection.adminId };
  const approverIds = input.decisions.filter((d) => d.decision === "APPROVE").map((d) => d.adminId);
  const signatures = 1 + approverIds.length;
  if (signatures >= threshold) return { status: "APPROVED", signatures, approverIds };
  return { status: "PENDING", signatures, needed: threshold };
}

/** Can this admin add a decision to this request? */
export function canDecide(requesterId: string, adminId: string, existing: readonly ApprovalDecision[]): string | null {
  if (adminId === requesterId) return "self_approval";
  if (existing.some((d) => d.adminId === adminId)) return "already_decided";
  return null;
}

/** Proof object passed into state machine guards by the approvals executor. */
export interface DualApprovalProof {
  requesterId: string;
  approverIds: readonly string[];
  threshold: number;
}

export function isDualApproved(p: DualApprovalProof | undefined): boolean {
  if (!p) return false;
  const ev = evaluateApproval({
    requesterId: p.requesterId,
    threshold: p.threshold,
    decisions: p.approverIds.map((adminId) => ({ adminId, decision: "APPROVE" as const })),
  });
  return ev.status === "APPROVED";
}
