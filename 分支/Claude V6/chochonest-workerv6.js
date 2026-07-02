/**
 * CHOCHONEST Cloudflare Worker
 * 代理 Anthropic API 和 Cloudinary 上傳，讓前端不需要持有任何 secret
 *
 * 環境變數（在 Cloudflare Dashboard → Worker → Settings → Variables 設定）：
 *   ANTHROPIC_API_KEY      你的 Anthropic API Key (sk-ant-...)
 *   CLOUDINARY_CLOUD_NAME  你的 Cloudinary Cloud Name (dlcu13xnn)
 *   CLOUDINARY_PRESET      你的 Cloudinary Upload Preset (chochonest)
 *   ACCESS_TOKEN           自訂存取密碼，工具開啟時要求輸入 (例如 chochonest2025)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Access-Token',
};

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    // ── 存取驗證 ──────────────────────────────────────────
    // 如果有設定 ACCESS_TOKEN，檢查 header 裡的 token
    if (env.ACCESS_TOKEN) {
      const token = request.headers.get('X-Access-Token');
      if (token !== env.ACCESS_TOKEN) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    // ── 路由 ─────────────────────────────────────────────
    const path = url.pathname;

    // POST /api/generate  →  呼叫 Anthropic，產生文案
    if (path === '/api/generate' && request.method === 'POST') {
      return handleGenerate(request, env);
    }

    // POST /api/recognize  →  呼叫 Anthropic Vision，辨識規格圖
    if (path === '/api/recognize' && request.method === 'POST') {
      return handleRecognize(request, env);
    }

    // POST /api/upload  →  把圖片轉發到 Cloudinary
    if (path === '/api/upload' && request.method === 'POST') {
      return handleUpload(request, env);
    }

    // POST /api/search  →  用 Claude web_search 工具搜尋商品資訊，回傳摘要
    if (path === '/api/search' && request.method === 'POST') {
      return handleSearch(request, env);
    }

    // Health check
    if (path === '/api/ping') {
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};

// ── Web Search 摘要 ──────────────────────────────────────
async function handleSearch(request, env) {
  try {
    const { query } = await request.json();
    if (!query) return json({ summary: '' });

    // 用 Claude 的 web_search tool 搜尋商品資訊
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `請搜尋這個動漫周邊商品的相關資訊：「${query}」
搜尋後，用繁體中文（台灣用語）整理出：
1. 這個 IP 或角色是什麼（如果不知道就跳過）
2. 商品的實際規格（尺寸、材質、品牌）如果有找到的話
3. 其他有助於撰寫商品文案的補充資訊
只回傳整理後的重點，不要說明你做了什麼。`
        }],
      }),
    });

    const data = await res.json();
    // 取 text 類型的回應
    const summary = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return json({ summary });
  } catch (e) {
    // Search 失敗不阻斷流程，回傳空摘要
    return json({ summary: '' });
  }
}

// ── 文案生成 ─────────────────────────────────────────────
async function handleGenerate(request, env) {
  try {
    const body = await request.json();
    // body 格式：{ system, messages, max_tokens }
    // 直接由前端組好 payload，Worker 只加上 key 轉發

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-6',
        max_tokens: body.max_tokens || 1500,
        system: body.system,
        messages: body.messages,
      }),
    });

    const data = await res.json();
    return json(data, res.status);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ── 規格圖辨識 ───────────────────────────────────────────
async function handleRecognize(request, env) {
  try {
    const body = await request.json();
    // body 格式：{ image_b64, media_type }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: body.media_type,
                data: body.image_b64,
              },
            },
            {
              type: 'text',
              text: '請辨識此規格圖中所有文字，簡體中文轉繁體中文（台灣用語），整理成清單格式，直接輸出規格內容，不要說明文字。',
            },
          ],
        }],
      }),
    });

    const data = await res.json();
    return json(data, res.status);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ── Cloudinary 圖片上傳 ──────────────────────────────────
async function handleUpload(request, env) {
  try {
    // 前端送來 FormData（含 file + transformation 參數）
    const incoming = await request.formData();
    const file = incoming.get('file');
    const transformation = incoming.get('transformation') || '';

    if (!file) return json({ error: 'No file' }, 400);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', env.CLOUDINARY_PRESET);
    formData.append('folder', 'chochonest');
    if (transformation) formData.append('transformation', transformation);

    const cloudUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;
    const res = await fetch(cloudUrl, { method: 'POST', body: formData });
    const data = await res.json();
    return json(data, res.status);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ── 工具函數 ─────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
