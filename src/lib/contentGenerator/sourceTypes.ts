export type ProductStatus = "general" | "secondhand";

export type DraftState = "draft" | "ready" | "blocked";

export type RuleGroup =
  | "IP"
  | "角色"
  | "類型"
  | "情境"
  | "狀態"
  | "推薦"
  | "商品屬性"
  | "等級";

export type ProductVariant = {
  id: string;
  option1_name: string;
  option1_value: string;
  option2_name: string;
  option2_value: string;
  character_name: string | null;
  sku: string | null;
  cost_rmb: number | null;
  price: number | null;
  compare_at_price: number | null;
  image_url: string | null;
  barcode: string | null;
  inventory_quantity: number | null;
  price_overridden: boolean;
};

export type ProductDraftPayload = {
  draft_state?: DraftState;
  source_url: string | null;
  product_status: ProductStatus;
  ip: string;
  characters: string[];
  product_types: string[];
  use_cases: string[];
  sale_status: string;
  recommend_tags: string[];
  product_name: string;
  variant_feature: string | null;
  usage_scene: string | null;
  intro: string | null;
  notes: string | null;
  price: number | null;
  compare_at_price: number | null;
  image_urls?: string[];
  image_description?: string | null;
  variants?: ProductVariant[] | null;
  sku: string | null;
  secondhand_grade: string | null;
  secondhand_condition: string | null;
  secondhand_notes: string | null;
};

export type TagRule = {
  id: string;
  rule_group: RuleGroup;
  label: string;
  tag_value: string;
  is_secondhand: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type IpCharacter = {
  id: string;
  ip_name: string;
  character_name: string;
  aliases: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
