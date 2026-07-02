export const CHARM_ACCESSORY_DISPLAY_LABEL = '吊飾掛件';
export const CHARM_ACCESSORY_TAG_LABEL = '吊飾徽章';

const COTTON_DOLL_LABEL_PATTERN = /^(類型_)?(棉花娃娃|棉娃)$/i;
const CHARM_ACCESSORY_LABEL_PATTERN = /^(類型_)?(吊飾掛件|吊飾徽章|吊飾|掛件|鑰匙圈|鑰匙扣|徽章|別針|包包掛飾|包包掛件|包包吊飾|手機掛飾|娃娃吊飾|keychain|charm|badge|pin)$/i;

function stripTypePrefix(value: string): string {
  return value.trim().replace(/^類型_/, '');
}

export function normalizeProductTypeForDisplay(value: string): string {
  const label = stripTypePrefix(value);

  if (COTTON_DOLL_LABEL_PATTERN.test(label)) {
    return '絨毛娃娃';
  }

  if (CHARM_ACCESSORY_LABEL_PATTERN.test(label)) {
    return CHARM_ACCESSORY_DISPLAY_LABEL;
  }

  return label;
}

export function normalizeProductTypeForTags(value: string): string {
  const label = stripTypePrefix(value);

  if (COTTON_DOLL_LABEL_PATTERN.test(label)) {
    return '絨毛娃娃';
  }

  if (CHARM_ACCESSORY_LABEL_PATTERN.test(label)) {
    return CHARM_ACCESSORY_TAG_LABEL;
  }

  return label;
}

export function formatProductTypeLabel(value: string): string {
  return normalizeProductTypeForDisplay(value);
}
