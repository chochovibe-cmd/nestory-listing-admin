/**
 * P2-79: resolve a free-form character label to dictionary canonical character_name.
 * Storage prefers English/canonical (e.g. Miffy); UI short names stay in displayLabels.
 */
import { lookupCharacterAliasPatch } from "./characterAliasMap";
import { normalizeCharacterIdentity } from "./normalizeCharacterIdentity";

export type CharacterResolveEntry = {
  ip_name: string;
  character_name: string;
  aliases?: string[] | null;
};

export type IpCatalogResolveEntry = {
  ip_name: string;
  aliases?: string[] | null;
};

function normKey(value: string | null | undefined): string {
  return normalizeCharacterIdentity(value ?? "").toLowerCase();
}

function entryTerms(entry: CharacterResolveEntry): string[] {
  return [entry.character_name, ...(entry.aliases ?? [])].filter(Boolean);
}

function findInCatalog(
  surface: string,
  ipName: string | null | undefined,
  characters: CharacterResolveEntry[],
): CharacterResolveEntry | null {
  const target = normKey(surface);
  if (!target || characters.length === 0) return null;

  const targetIp = normKey(ipName ?? "");

  const matchTerms = (entry: CharacterResolveEntry) =>
    entryTerms(entry).some((term) => normKey(term) === target);

  if (targetIp) {
    const inIp = characters.find(
      (entry) => normKey(entry.ip_name) === targetIp && matchTerms(entry),
    );
    if (inIp) return inIp;
  }

  return characters.find(matchTerms) ?? null;
}

/**
 * When the IP has exactly one active character and the surface matches that IP's
 * name/aliases (e.g. 「米飛」 on IP row only), resolve to that sole character.
 */
function soleCharacterViaIpAlias(
  surface: string,
  ipName: string | null | undefined,
  characters: CharacterResolveEntry[],
  ipCatalog: IpCatalogResolveEntry[] = [],
): CharacterResolveEntry | null {
  const target = normKey(surface);
  if (!target) return null;

  let resolvedIpName = ipName ?? "";
  if (!resolvedIpName && ipCatalog.length > 0) {
    const ipHit = ipCatalog.find((entry) => {
      const terms = [entry.ip_name, ...(entry.aliases ?? [])];
      return terms.some((term) => normKey(term) === target);
    });
    if (ipHit) resolvedIpName = ipHit.ip_name;
  }

  if (!resolvedIpName) return null;

  const inIp = characters.filter((entry) => normKey(entry.ip_name) === normKey(resolvedIpName));
  if (inIp.length !== 1) return null;

  const ipEntry = ipCatalog.find((entry) => normKey(entry.ip_name) === normKey(resolvedIpName));
  const ipTerms = ipEntry
    ? [ipEntry.ip_name, ...(ipEntry.aliases ?? [])]
    : [resolvedIpName];
  if (!ipTerms.some((term) => normKey(term) === target)) return null;

  return inIp[0];
}

/**
 * Resolve free-form character text to canonical character_name.
 * Returns null when nothing matches (caller keeps raw or clears).
 */
export function resolveCanonicalCharacterName(
  surface: string | null | undefined,
  options: {
    ipName?: string | null;
    ipCharacters?: CharacterResolveEntry[];
    ipCatalog?: IpCatalogResolveEntry[];
  } = {},
): string | null {
  const raw = normalizeCharacterIdentity(surface ?? "");
  if (!raw) return null;

  const characters = options.ipCharacters ?? [];
  const ipName = options.ipName ?? null;

  const catalogHit = findInCatalog(raw, ipName, characters);
  if (catalogHit) return catalogHit.character_name;

  const patch = lookupCharacterAliasPatch(raw);
  if (patch) {
    if (ipName && normKey(ipName) && normKey(ipName) !== normKey(patch.ip_name)) {
      // Prefer not to cross-map when a conflicting IP is already known
    } else {
      // Prefer live catalog row when present (canonical spelling)
      const patched = findInCatalog(patch.character_name, patch.ip_name, characters);
      return patched?.character_name ?? patch.character_name;
    }
  }

  const sole = soleCharacterViaIpAlias(raw, ipName, characters, options.ipCatalog ?? []);
  if (sole) return sole.character_name;

  // patch with IP constraint after catalog miss
  if (patch) {
    const patched = findInCatalog(patch.character_name, patch.ip_name, characters);
    return patched?.character_name ?? patch.character_name;
  }

  return null;
}
