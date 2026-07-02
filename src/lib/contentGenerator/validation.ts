import { ListingDraftInput } from './types';

const SECONDHAND_GRADES = ['SS級', 'S級', 'A級', 'B級', 'C級', 'D級'];

function textLength(value: string): number {
  return Array.from(value).length;
}

export function validateGeneratedContent(
  draft: ListingDraftInput,
  displayTitle: string | null,
  metaDescription: string,
  errors: string[],
  warnings: string[],
) {
  if (!draft.product_name.trim()) {
    errors.push('缺少商品名稱，無法產生上架內容。');
  }

  if (!draft.ip.trim()) {
    errors.push('缺少 IP，無法產生標題與 IP 標籤。');
  }

  if (!draft.sale_status.trim()) {
    errors.push('缺少銷售狀態。');
  }

  if (draft.product_types.length === 0) {
    errors.push('缺少商品類型，無法產生完整上架標籤。');
  }

  if (draft.characters.length === 0) {
    warnings.push('缺少角色資料，SEO 與角色標籤會比較不完整。');
  }

  if (draft.use_cases.length === 0) {
    warnings.push('缺少使用情境，商品描述與情境標籤會比較不完整。');
  }

  if (draft.product_status === 'general' && draft.recommend_tags.length === 0) {
    warnings.push('缺少推薦標籤，商品不會產生推薦類 Shopify tag。');
  }

  if (draft.product_status === 'secondhand') {
    if (!draft.secondhand_grade) {
      errors.push('二手商品缺少二手等級。');
    } else if (!SECONDHAND_GRADES.includes(draft.secondhand_grade)) {
      errors.push('二手商品等級必須是 SS級、S級、A級、B級、C級 或 D級。');
    }

    if (!draft.secondhand_condition?.trim()) {
      warnings.push('二手商品尚未填寫品況描述。');
    }

    if (!draft.secondhand_notes?.trim()) {
      warnings.push('二手商品尚未填寫保存 / 瑕疵備註。');
    }
  }

  if (!displayTitle) {
    errors.push('無法產生商品標題，請確認 IP、商品名稱與二手等級。');
  } else {
    const titleLength = textLength(displayTitle);

    if (titleLength > 45) {
      warnings.push(`商品標題約 ${titleLength} 字，已超過 45 字，建議縮短。`);
    } else if (titleLength > 36) {
      warnings.push(`商品標題約 ${titleLength} 字，已超過 36 字，建議留意前台顯示長度。`);
    }
  }

  const metaLength = textLength(metaDescription);

  if (metaLength < 55) {
    warnings.push('Meta Description 稍短，建議補充款式亮點或適合情境。');
  }

  if (metaLength > 120) {
    warnings.push(`Meta Description 約 ${metaLength} 字，建議控制在 120 字以內。`);
  }
}
