/**
 * UX-BTN S4: 登入錯誤文案分級。
 * Supabase 回英文／error code，這裡轉成同事看得懂的中文，
 * 並區分「帳密錯」vs「帳號停用／未驗證」等，避免全混成同一句。
 */

export type LoginErrorKind =
  | "credentials"
  | "disabled"
  | "unconfirmed"
  | "rate_limit"
  | "config"
  | "unknown";

export type LoginErrorView = {
  kind: LoginErrorKind;
  /** 顯示給使用者的主文案 */
  message: string;
  /** 可選：下一行提示（怎麼辦） */
  hint?: string;
};

type AuthErrorLike = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
};

/** Exact English message → view (legacy / message-only path). */
const MESSAGE_MAP: Record<string, LoginErrorView> = {
  "Invalid login credentials": {
    kind: "credentials",
    message: "帳號或密碼不對",
    hint: "請再確認一次 Email 與密碼（大小寫有分）。"
  },
  "Invalid login credentials.": {
    kind: "credentials",
    message: "帳號或密碼不對",
    hint: "請再確認一次 Email 與密碼（大小寫有分）。"
  },
  "Email not confirmed": {
    kind: "unconfirmed",
    message: "此信箱還沒完成驗證",
    hint: "請到信箱收件匣（含垃圾郵件）點驗證連結；若沒收到請找管理員重發。"
  },
  "Email rate limit exceeded": {
    kind: "rate_limit",
    message: "嘗試次數太多，請稍後再試",
    hint: "連續失敗會暫時鎖住，等幾分鐘後再登入。"
  },
  "User not found": {
    // 不洩漏「有沒有這個帳號」——與帳密錯誤同一語氣
    kind: "credentials",
    message: "帳號或密碼不對",
    hint: "請再確認一次 Email 與密碼。"
  },
  "User is banned": {
    kind: "disabled",
    message: "此帳號已停用",
    hint: "請聯絡管理員確認權限，無法自行解除。"
  },
  "Email logins are disabled": {
    kind: "config",
    message: "目前無法用 Email 登入",
    hint: "系統登入方式可能調整中，請聯絡管理員。"
  }
};

/** Supabase Auth error `code` (newer clients) → view. */
const CODE_MAP: Record<string, LoginErrorView> = {
  invalid_credentials: MESSAGE_MAP["Invalid login credentials"],
  email_not_confirmed: MESSAGE_MAP["Email not confirmed"],
  user_banned: MESSAGE_MAP["User is banned"],
  user_not_found: MESSAGE_MAP["User not found"],
  over_request_rate_limit: {
    kind: "rate_limit",
    message: "請求太頻繁，請稍後再試",
    hint: "等一分鐘後再登入即可。"
  },
  over_email_send_rate_limit: MESSAGE_MAP["Email rate limit exceeded"]
};

/**
 * 把 Supabase Auth 錯誤轉成分級中文。
 * 優先看 `code`，再比對英文 message；對不上則給通用句。
 */
export function translateLoginError(error: AuthErrorLike | string | null | undefined): LoginErrorView {
  if (!error) {
    return {
      kind: "unknown",
      message: "登入失敗，請稍後再試",
      hint: "若一直失敗，請聯絡管理員。"
    };
  }

  if (typeof error === "string") {
    return lookupMessage(error);
  }

  const code = (error.code ?? "").trim().toLowerCase();
  if (code && CODE_MAP[code]) {
    return CODE_MAP[code];
  }

  const message = (error.message ?? "").trim();
  if (message) {
    const mapped = lookupMessage(message);
    if (mapped.kind !== "unknown" || MESSAGE_MAP[message]) {
      return mapped;
    }
    // Fuzzy: banned / disabled wording
    const lower = message.toLowerCase();
    if (lower.includes("banned") || lower.includes("disabled") || lower.includes("not allowed")) {
      return {
        kind: "disabled",
        message: "此帳號目前無法登入",
        hint: "可能已停用或被限制，請聯絡管理員。"
      };
    }
    if (lower.includes("rate") || lower.includes("too many")) {
      return {
        kind: "rate_limit",
        message: "嘗試次數太多，請稍後再試"
      };
    }
    if (lower.includes("confirm")) {
      return MESSAGE_MAP["Email not confirmed"];
    }
    if (lower.includes("credential") || lower.includes("password") || lower.includes("invalid")) {
      return MESSAGE_MAP["Invalid login credentials"];
    }
  }

  // HTTP 429
  if (error.status === 429) {
    return {
      kind: "rate_limit",
      message: "嘗試次數太多，請稍後再試"
    };
  }

  return {
    kind: "unknown",
    message: message || "登入失敗，請稍後再試",
    hint: "若一直失敗，請聯絡管理員。"
  };
}

function lookupMessage(message: string): LoginErrorView {
  if (MESSAGE_MAP[message]) return MESSAGE_MAP[message];
  // strip trailing period
  const stripped = message.replace(/\.$/, "");
  if (MESSAGE_MAP[stripped]) return MESSAGE_MAP[stripped];
  return {
    kind: "unknown",
    message,
    hint: "若看不懂這段英文，請截圖給管理員。"
  };
}
