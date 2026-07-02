import {
  DisplayLabelContext,
  formatCharacterShortNameFromContext,
  formatListingIpDisplayNameFromContext,
  isCharacterRedundantWithIpDisplay,
} from './displayLabels';
import { ListingDraftInput } from './types';
import { normalizeProductTypeForDisplay } from '../productTypeLabels';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function joinLabels(values: string[], fallback: string): string {
  return values.length > 0 ? values.join('、') : fallback;
}

function getCollectionFitText(productTypes: string, useCases: string): string {
  return '重點在於它能不能補上你收藏裡缺的角色、款式或使用情境。若你已經有同角色常規款，這類 ' + productTypes + ' 更適合作為不同造型或不同場景的補充。';
}

export function generateFaqHtml(draft: ListingDraftInput, context: DisplayLabelContext = {}): string {
  const ipDisplayName = formatListingIpDisplayNameFromContext(draft.ip, context);
  const characterLabels = draft.characters
    .map((character) => formatCharacterShortNameFromContext(character, draft.ip, context))
    .filter((character) => !isCharacterRedundantWithIpDisplay(character, ipDisplayName));
  const characterText = escapeHtml(joinLabels(characterLabels, '\u89d2\u8272\u6536\u85cf\u8005'));
  const productTypeText = escapeHtml(joinLabels(draft.product_types.map(normalizeProductTypeForDisplay), '周邊商品'));
  const useCaseText = escapeHtml(joinLabels(draft.use_cases, '收藏展示、日常佈置'));
  if (draft.product_status === 'secondhand') {
    return [
      '<h2>問與答 FAQ</h2>',
      '<h3><strong>這件二手收藏品的判斷重點是什麼？</strong></h3>',
      '<p>重點在於二手等級、品況描述、保存備註與實拍圖是否符合自己的收藏標準，不建議只看角色或價格就下單。</p>',
      '<h3><strong>二手等級要怎麼搭配品況理解？</strong></h3>',
      '<p>目前等級為 ' + escapeHtml(draft.secondhand_grade ?? '未標示') + '，仍需搭配盒況、展示痕跡、保存狀態與照片細節一起判斷。</p>',
      '<h3><strong>哪些品況差異最影響收藏判斷？</strong></h3>',
      '<p>請把盒損、缺件、刮傷、色移、泛黃、污漬或其他保存痕跡放在同一個標準裡評估，不建議只看角色或價格就決定。</p>',
      '<h3><strong>哪些收藏者比較適合入手？</strong></h3>',
      '<p>適合想補齊系列收藏、能接受二手品況差異，並願意逐件確認狀態的收藏玩家。若你偏好全新品況，建議改看新品或未拆封品項。</p>',
    ].join('\n');
  }

  return [
    '<h2>問與答 FAQ</h2>',
    '<h3><strong>這款商品的收藏重點是什麼？</strong></h3>',
    '<p>這款商品以 ' + productTypeText + ' 為主，適合喜歡 ' + characterText + '、想補充角色周邊或建立同系列收藏的人。</p>',
    '<h3><strong>跟一般角色周邊相比，這款適合補哪一塊？</strong></h3>',
    '<p>' + escapeHtml(getCollectionFitText(productTypeText, useCaseText)) + '</p>',
    '<h3><strong>適合和哪些收藏一起搭配？</strong></h3>',
    '<p>可依照 ' + useCaseText + ' 的方向，搭配同 IP、同角色或同類型周邊一起整理成收藏主題。若你想做角色主題角落，這類品項比單純收大件更容易調整陳列密度。</p>',
    '<h3><strong>哪些人可以先不用急著入手？</strong></h3>',
    '<p>如果你只想收主線造型或大型展示品，這類小物型周邊可以先排在後面。若你正在補角色日常陪伴感或外出搭配感，入手優先度會更高。</p>',
  ].join('\n');
}
