export type Archetype = "角色收藏" | "機能用品" | "生活日用" | "穿搭配件";
export const ARCHETYPES: readonly Archetype[] = ["角色收藏", "機能用品", "生活日用", "穿搭配件"];

/** COPY-A2: 型態（tag 引擎的 類型_ 值，同 taxonomyCategory.ts 的 key）→ 商品原型。 */
export const ARCHETYPE_BY_TYPE: Readonly<Record<string, Archetype>> = {
  公仔模型: "角色收藏", 景品: "角色收藏", PVC: "角色收藏", 一番賞大賞: "角色收藏", 一番賞小賞: "角色收藏",
  盲盒: "角色收藏", 扭蛋: "角色收藏", 黏土人: "角色收藏", 可動模型: "角色收藏", 盒玩: "角色收藏", 食玩: "角色收藏",
  模型套組: "角色收藏", 娃娃抱枕: "角色收藏", 絨毛娃娃: "角色收藏", 大型娃娃: "角色收藏", 吊飾徽章: "角色收藏",
  壓克力立牌: "角色收藏", 立牌: "角色收藏", 桌面擺件: "角色收藏", 複製畫海報: "角色收藏", 掛畫裝飾: "角色收藏",
  卡片票卡: "角色收藏", 貼紙: "角色收藏",
  展示收納: "生活日用", 燈具小物: "生活日用", 杯具餐具: "生活日用", 毛巾毯子: "生活日用", 生活雜貨: "生活日用",
  文具: "生活日用", 筆記本: "生活日用", 印章: "生活日用", 保溫杯瓶: "生活日用",
  手機殼: "機能用品", 手機支架: "機能用品", 藍牙耳機: "機能用品", 藍牙音響: "機能用品", 滑鼠墊: "機能用品",
  滑鼠: "機能用品", 鍵盤: "機能用品", 鍵帽: "機能用品", 手把控制器: "機能用品", 充電周邊: "機能用品",
  服飾: "穿搭配件", 包包: "穿搭配件", 帽子: "穿搭配件", 襪子: "穿搭配件", 飾品配件: "穿搭配件",
};

export function resolveArchetype(briefArchetype: string | null | undefined, productType: string | null | undefined): Archetype | "" {
  const fromBrief = (briefArchetype ?? "").trim();
  if ((ARCHETYPES as readonly string[]).includes(fromBrief)) return fromBrief as Archetype;
  const type = (productType ?? "").trim();
  return Object.prototype.hasOwnProperty.call(ARCHETYPE_BY_TYPE, type) ? ARCHETYPE_BY_TYPE[type] : "";
}
