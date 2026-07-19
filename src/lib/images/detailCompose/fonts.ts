/**
 * SYN-1 B2: resolve CJK fonts for SVG→sharp render.
 * Prefer bundled assets/fonts, then OS fonts. Honest warning on fallback.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type FontResolveResult = {
  titleFamily: string;
  bodyFamily: string;
  titlePath: string | null;
  bodyPath: string | null;
  /** True when we could not find preferred Noto and fell back. */
  usedFallback: boolean;
  warnings: string[];
};

const BUNDLED_DIR_CANDIDATES = [
  join(process.cwd(), "assets", "fonts"),
  join(process.cwd(), "src", "lib", "images", "detailCompose", "fonts"),
  join(process.cwd(), "public", "fonts")
];

const WIN_FONTS = process.env.WINDIR
  ? join(process.env.WINDIR, "Fonts")
  : "C:\\Windows\\Fonts";

const TITLE_CANDIDATES: Array<{ family: string; files: string[] }> = [
  {
    family: "Noto Serif TC",
    files: [
      "NotoSerifTC-Regular.otf",
      "NotoSerifTC-VF.ttf",
      "NotoSerifCJKtc-Regular.otf",
      "SourceHanSerifTC-Regular.otf"
    ]
  }
];

const BODY_CANDIDATES: Array<{ family: string; files: string[] }> = [
  {
    family: "Noto Sans TC",
    files: [
      "NotoSansTC-Regular.otf",
      "NotoSansTC-VF.ttf",
      "NotoSansCJKtc-Regular.otf"
    ]
  },
  {
    family: "Microsoft JhengHei",
    files: ["msjh.ttc", "msjh.ttf", "msjhbd.ttc"]
  }
];

function searchDirs(): string[] {
  const extra = process.env.DETAIL_COMPOSE_FONT_DIR?.trim();
  const dirs = [
    ...(extra ? [extra] : []),
    ...BUNDLED_DIR_CANDIDATES,
    WIN_FONTS,
    "/usr/share/fonts",
    "/usr/share/fonts/truetype",
    "/usr/local/share/fonts"
  ];
  return dirs;
}

function findFontFile(fileNames: string[]): string | null {
  for (const dir of searchDirs()) {
    for (const name of fileNames) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Resolve font families for SVG font-family attribute.
 * librsvg/sharp uses OS fontconfig by family name; path is recorded for diagnostics.
 */
export function resolveDetailComposeFonts(): FontResolveResult {
  const warnings: string[] = [];
  let usedFallback = false;

  let titleFamily = "serif";
  let titlePath: string | null = null;
  let titleOk = false;
  for (const c of TITLE_CANDIDATES) {
    const p = findFontFile(c.files);
    if (p) {
      titleFamily = c.family;
      titlePath = p;
      titleOk = true;
      break;
    }
  }
  if (!titleOk) {
    // MSJH as last-resort title
    const ms = findFontFile(["msjh.ttc", "msjh.ttf"]);
    if (ms) {
      titleFamily = "Microsoft JhengHei";
      titlePath = ms;
      usedFallback = true;
      warnings.push(
        "詳情圖字體：找不到 Noto Serif TC，標題 fallback 微軟正黑（請於 assets/fonts 放置字型）"
      );
    } else {
      usedFallback = true;
      warnings.push(
        "詳情圖字體：找不到襯線中文字型，標題可能空白（請安裝 Noto Serif TC 或放入 assets/fonts）"
      );
    }
  }

  let bodyFamily = "sans-serif";
  let bodyPath: string | null = null;
  let bodyOk = false;
  for (const c of BODY_CANDIDATES) {
    const p = findFontFile(c.files);
    if (p) {
      bodyFamily = c.family;
      bodyPath = p;
      bodyOk = true;
      if (c.family !== "Noto Sans TC") {
        usedFallback = true;
        warnings.push(
          `詳情圖字體：內文使用 ${c.family}（非 Noto Sans TC）`
        );
      }
      break;
    }
  }
  if (!bodyOk) {
    usedFallback = true;
    warnings.push(
      "詳情圖字體：找不到內文中文字型，內文可能空白（請安裝 Noto Sans TC 或微軟正黑）"
    );
  }

  return {
    titleFamily,
    bodyFamily,
    titlePath,
    bodyPath,
    usedFallback,
    warnings
  };
}
