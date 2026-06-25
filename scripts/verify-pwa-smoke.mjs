const baseUrl = (process.argv[2] || process.env.PWA_SMOKE_URL || "http://127.0.0.1:3018").replace(/\/$/, "");

const checks = [
  {
    route: "/",
    expected: ["Nestory Listing Admin", "mock-safe"]
  },
  {
    route: "/login",
    expected: ["團隊登入", "Email", "Password"]
  },
  {
    route: "/drafts",
    expected: ["請先", "登入", "商品佇列"]
  },
  {
    route: "/drafts/new",
    expected: ["請先", "登入", "新增商品草稿"]
  },
  {
    route: "/review",
    expected: ["請先", "登入", "待審核商品"]
  }
];

function textFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const failures = [];

for (const check of checks) {
  const url = `${baseUrl}${check.route}`;

  try {
    const response = await fetch(url);
    const html = await response.text();
    const pageText = textFromHtml(html);
    const normalized = pageText.toLowerCase();
    const missing = check.expected.filter((fragment) => !normalized.includes(fragment.toLowerCase()));

    if (response.status !== 200 || missing.length) {
      failures.push(`${check.route} returned ${response.status}; missing: ${missing.join(", ") || "none"}`);
      continue;
    }

    console.log(`PASS ${check.route} ${response.status} ${html.length} bytes`);
  } catch (error) {
    failures.push(`${check.route} failed: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`PWA smoke checks passed for ${baseUrl}`);
