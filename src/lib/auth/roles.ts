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

/** C2 / 文案·四：System Prompt、自動化敏感項等僅 admin 可寫 */
export function isAdmin(role?: UserRole | null) {
  return role === "admin";
}

/** C2：admin + operator 可進設定頁 */
export function canAccessSettings(role?: UserRole | null) {
  return canOperate(role);
}
