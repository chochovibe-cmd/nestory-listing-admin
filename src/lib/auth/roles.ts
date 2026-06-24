import type { UserRole } from "@/types/domain";

export function canReview(role?: UserRole | null) {
  return role === "admin" || role === "reviewer";
}

export function canPublish(role?: UserRole | null) {
  return role === "admin" || role === "reviewer";
}

export function canOperate(role?: UserRole | null) {
  return role === "admin" || role === "operator" || role === "reviewer";
}
