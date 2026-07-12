import {
  DisplayLabelContext,
  formatCharacterShortNameFromContext,
  formatListingIpDisplayNameFromContext,
  isCharacterRedundantWithIpDisplay,
} from './displayLabels';
import { ListingDraftInput } from './types';

function joinLabels(values: string[], fallback: string): string {
  return values.length > 0 ? values.join('、') : fallback;
}

/**
 * Rule-engine description for test mode / LLM fallback.
 * fix(B10): emits PLAIN TEXT (same contract as the LLM path / A23), not HTML.
 * Shopify conversion happens only in payload.ts via formatPlainTextAsHtml.
 */
export function generateDescriptionHtml(draft: ListingDraftInput, context: DisplayLabelContext = {}): string {
  const ipDisplayName = formatListingIpDisplayNameFromContext(draft.ip, context);
  const ip = ipDisplayName;
  const productName = draft.product_name;
  const characterLabels = draft.characters
    .map((character) => formatCharacterShortNameFromContext(character, draft.ip, context))
    .filter((character) => !isCharacterRedundantWithIpDisplay(character, ipDisplayName));
  const characters = joinLabels(characterLabels, '\u559c\u611b\u6b64\u7cfb\u5217\u7684\u6536\u85cf\u8005');
  const useCases = joinLabels(draft.use_cases, '收藏展示、日常佈置');

  if (draft.product_status === 'secondhand') {
    const intro = draft.intro?.trim()
      ? draft.intro.trim()
      : `這是一件 ${ip} 相關的二手收藏品，適合想入手 ${characters} 相關商品，且可接受二手品況差異的收藏者。`;
    const usageScene = draft.usage_scene?.trim()
      ? draft.usage_scene.trim()
      : '適合放在收藏櫃、展示層架或角色主題角落中，作為補齊系列收藏的一員。';

    return ['商品介紹', intro, '', '收藏情境', usageScene].join('\n');
  }

  const intro = draft.intro?.trim()
    ? draft.intro.trim()
    : `${ip}「${productName}」適合 ${characters} 的粉絲收藏，也很適合放在 ${useCases} 等日常空間中，替桌面、房間或收藏櫃增加一點角色陪伴感。`;
  const usageScene = draft.usage_scene?.trim()
    ? draft.usage_scene.trim()
    : `可以依照角色、系列或商品類型一起陳列，搭配其他 ${ip} 周邊打造更完整的收藏角落。`;

  return ['商品介紹', intro, '', '收藏情境', usageScene].join('\n');
}
