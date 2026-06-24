export const categoryOptions = [
  { value: "figure", label: "公仔 / 玩具" },
  { value: "plush", label: "娃娃 / 毛絨 / 抱枕" },
  { value: "keychain", label: "鑰匙圈 / 吊飾" },
  { value: "tableware", label: "餐廚用品" },
  { value: "lighting", label: "燈飾" },
  { value: "storage", label: "收納 / 層架 / 居家小物" },
  { value: "other", label: "其他 IP 商品" }
];

export function categoryLabel(value: string | null | undefined) {
  return categoryOptions.find((item) => item.value === value)?.label ?? value ?? "未分類";
}
