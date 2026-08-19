# Role / Permission / RLS Consistency Audit — 2026-08-18

> 範圍：目前程式角色型別、前端 helper、發布/審核 API、新使用者預設角色、Supabase RLS / sensitive-field guard、設定與個人 capture token。
> 本檔先做事實盤點與建議模型；除已明確屬於越權漏洞的 API 外，不在角色產品裁決前擴權。

## 快速結論

### 建議保留目前 3 角色，不新增 viewer

目前 source + DB 的實際 canonical role 都是：
- `admin`
- `operator`
- `reviewer`

`viewer` 只出現在部分後期文件語意，沒有進 `UserRole` 或 Postgres `user_role` enum。若現在硬加 viewer，會新增 migration / RLS / UI / API 的整套成本，且目前沒有明確產品需求支撐。

### 建議能力模型（最貼近現有設計）

| 能力 | operator | reviewer | admin |
|---|---:|---:|---:|
| 建立商品 / 編輯自己的未發布草稿 | ✅ | ✅ | ✅ |
| 讀取其他人的草稿 | ❌ | ✅ | ✅ |
| 審核 / 退回 | ❌ | ✅ | ✅ |
| Shopify publish | ❌ | ✅ | ✅ |
| 封存自己的草稿 | ✅ | ✅ | ✅ |
| 跨成員封存 / 解封 | ❌ | ✅ | ✅ |
| 一般裝置設定 / 個人 prefs | ✅ | ✅ | ✅ |
| team_settings 敏感寫入 | ❌ | ❌ | ✅ |
| profiles / 成員角色管理 | ❌ | ❌ | ✅ |

這個模型與現有 DB / publish / approve 路徑最接近，因此是最低風險的 canonical model。

---

## 1. Canonical role：code 與 DB 目前一致

### TypeScript
`src/types/domain.ts`：
```ts
export type UserRole = "admin" | "operator" | "reviewer";
```

### Supabase
`001_initial_schema.sql`：
```sql
create type public.user_role as enum ('admin', 'operator', 'reviewer');
```

判定：**viewer 目前不是正式角色。不要只因文件出現 viewer 就加進 code。**

---

## 2. 新使用者預設 operator — code/DB 明確

`profiles.role` default = `operator`；`handle_new_user()` 也顯式寫入 `operator`。

這代表目前 onboarding 的安全模型是：
1. 新使用者先能建立/操作自己的商品。
2. 不自動取得 review / publish 權限。
3. admin 再升級角色。

判定：這是合理的 least-privilege default，**目前不建議改成 reviewer**。

---

## 3. Frontend/helper 實際能力

`src/lib/auth/roles.ts`：
- `canReview` → admin / reviewer
- `canPublish` → admin / reviewer
- `canOperate` → admin / operator / reviewer
- `isAdmin` → admin only
- `canAccessSettings` → 呼叫 `canOperate()`，所以實際上三個角色都可以進設定頁

### 文字漂移
`canAccessSettings` 上方註解仍寫「admin + operator」，但實際 function 包含 reviewer。

判定：**實作本身不一定錯，但註解已 stale。** 後續修角色文件時應改成「authenticated operating roles」或明列三角色。

---

## 4. Review / Publish API 與 helper 一致

### Approve
`/api/drafts/[id]/approve` 顯式要求：
- admin
- reviewer

operator → 403。

### Single publish / Batch publish
兩條 route 都呼叫 `canPublish()`；目前只有 admin/reviewer。

判定：**reviewer = reviewer + publisher** 是現有正式行為，不是只有名稱上的 reviewer。

如果產品未來想把「審核」與「上架」拆成不同權限，不應偷偷改 operator；應新增 capability 或重新設計 role model。

---

## 5. Supabase RLS / sensitive-field guard 也支持上述模型

### Draft visibility
- admin/reviewer 可讀全隊 drafts。
- operator 主要只能讀自己的 draft。

### Draft writes
- authenticated operating roles 可建立 draft，但 `created_by` 必須是自己。
- operator 更新路徑設計為自己的 unpublished draft。
- sensitive-field trigger 對非 admin/reviewer 限制 generation/review/publish system fields。

### Profiles
- 一般使用者只能讀自己 profile。
- admin 可讀/管理全部 profiles。

判定：**DB 並沒有把 operator 當 publisher。** 因此只改前端 `canPublish()` 會造成 API / DB / UI 半套不一致。

---

## 6. team_settings：進設定頁 ≠ 可寫敏感 team setting

`006_team_settings.sql`：
- authenticated 可讀 team_settings。
- 寫入 policy 是 `public.is_admin()` only。

`SettingsPanel` 也區分：
- 一般裝置/個人設定可由 operating roles 使用。
- automation 等敏感 client prefs 另外用 `admin` gate。

判定：目前「三種角色可進設定頁，但敏感團隊設定 admin-only」是合理模型。

---

## 7. 文字／語意 drift：capture token

`/api/settings/capture-token` 使用 `canOperate()`，所以實際允許：
- admin
- operator
- reviewer

但 route 註解寫「operator+admin」，403 message 也寫「需要 operator 或 admin 角色」。

判定：**權限實作與文字不一致。**

建議：若 capture token 本質是「個人擷取工具 token」，reviewer 也可能需要建立商品來源，則保留三角色可用、修正文字；不要為了配合舊註解把 reviewer 硬擋掉。

---

## 8. P0 Authorization bug：batch archive 使用 service role 繞過 owner scope

`/api/drafts/batch/archive`：
1. 只檢查 `canOperate(role)`。
2. `canOperate` 三角色皆 true。
3. 接著建立 `createServiceSupabaseClient()`。
4. 直接用 request 的 `draftIds` 讀取所有 rows。
5. 再用 service role 更新 archive/unarchive。
6. route 沒有檢查 operator 是否為 `created_by`。

### 風險
在目前 canonical model 下，operator 應只能改自己的 unpublished drafts；但此 API 會 bypass RLS，所以知道/取得別人的 draft id 後，operator 可跨 owner 封存／解封。

route 還支援 archived published rows，因此影響不只草稿 UI。

判定：**P0 server-side authorization bug。**

### 建議修法
在 service-role read/write 前建立明確 allowed set：
- admin/reviewer：可處理 requested IDs。
- operator：只允許 `created_by === user.id` 的 IDs。
- 對 unauthorized IDs：不可 silent success；回 skipped/forbidden 或整包 403，依既有 batch UX 決定。

最低風險做法：保留 batch partial semantics，但把 unauthorized IDs 列入 `forbiddenIds` / skipped，且沒有任何 DB update。

並新增 source-contract verifier，鎖定 service client 前/後的 owner authorization。

---

## 9. 目前不建議做的事

- 不新增 `viewer`，除非先有明確 read-only 成員需求。
- 不把 operator 加進 `canPublish()`。
- 不把新使用者預設改成 reviewer。
- 不只改 UI 隱藏/顯示按鈕，卻不改 API + RLS。
- 不因 service-role route 方便就信任前端已經過濾 draft IDs。

---

## 10. 建議執行順序

1. **先修 P0 batch archive owner authorization**（不需要產品角色裁決）。
2. 修 capture-token / settings stale role wording，不改實際能力。
3. 把上述 3-role capability matrix 寫成 canonical decision (`docs/DECISIONS.md` 或 CURRENT_STATUS)。
4. 再做 production Supabase RLS/migration reconcile，確認 live DB 真的等於 repo migration。
5. 若老闆之後明確希望「一般 operator 也能直接發布」，再開一個獨立 role-model change，整體調整 helper + API + DB/RLS + UI + tests。

## 建議產品裁決

以目前用途與安全邊界，建議直接採用：

> **operator = 製作自己的商品；reviewer = 全隊審核＋發布；admin = reviewer 能力＋成員/敏感設定管理。**

這是現有 source/DB 最一致、改動最少且最安全的模型。
