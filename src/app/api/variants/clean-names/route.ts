/**
 * VARIANT-CLEAN: 整理款式名稱 preview. Rule layer always, AI polish only when the operator
 * pressed the button (useAi). Writes nothing: the dialog shows the comparison and the
 * operator applies it through the normal card save.
 */
import { NextRequest } from "next/server";
import { canOperate } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { polishVariantNamesWithOpenAI } from "@/lib/variants/variantNameAiPolish";
import { buildVariantNamePreview } from "@/lib/variants/variantNamePreview";
import type { VariantOptionFields } from "@/lib/variants/variantNameRules";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 50;

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function POST(request: NextRequest) {
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rawRows = Array.isArray(body?.rows) ? (body?.rows as unknown[]) : null;
  if (!rawRows || rawRows.length === 0 || rawRows.length > MAX_ROWS) {
    return Response.json({ error: `rows must have 1-${MAX_ROWS} items` }, { status: 400 });
  }
  const rows: VariantOptionFields[] = rawRows.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      option1_name: asText(row.option1_name),
      option1_value: asText(row.option1_value),
      option2_name: asText(row.option2_name),
      option2_value: asText(row.option2_value),
      option3_name: asText(row.option3_name),
      option3_value: asText(row.option3_value)
    };
  });

  const preview = await buildVariantNamePreview({
    rows,
    useAi: body?.useAi === true,
    productName: asText(body?.productName),
    protectNames: [asText(body?.ip), asText(body?.character), asText(body?.brand)],
    polish: polishVariantNamesWithOpenAI
  });
  return Response.json({ ok: true, ...preview });
}
