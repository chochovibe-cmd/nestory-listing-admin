/**
 * CHOCHONEST Cloudflare Worker
 * 代理 Anthropic API 和 Cloudinary 上傳，讓前端不需要持有任何 secret
 *
 * 環境變數（在 Cloudflare Dashboard → Worker → Settings → Variables 設定）：
 *   ANTHROPIC_API_KEY      你的 Anthropic API Key (sk-ant-...)
 *   OPENAI_API_KEY         你的 OpenAI API Key (sk-...)
 *   LLM_PROVIDER           openai / anthropic / auto，未設定時自動選可用 provider
 *   OPENAI_MODEL           OpenAI 模型名稱，未設定時用 gpt-5.2
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

    if (path === '/api/status') {
      const provider = resolveProvider(env);
      return json({
        ok: true,
        cloudinary: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_PRESET),
        ai: provider === 'mock' ? 'mock' : 'real',
        provider,
        openai: Boolean(env.OPENAI_API_KEY),
        anthropic: Boolean(env.ANTHROPIC_API_KEY),
      });
    }

    return json({ error: 'Not found' }, 404);
  },
};

// ── Web Search 摘要 ──────────────────────────────────────
async function handleSearch(request, env) {
  try {
    const body = await request.json();
    const provider = resolveProvider(env, body.provider);
    if (provider === 'mock') {
      return json({ summary: '' });
    }

    const query = [body.title, body.category, body.note].filter(Boolean).join(' ');
    if (provider === 'openai') {
      const data = await callOpenAIResponses({
        model: env.OPENAI_MODEL || body.openai_model || 'gpt-5.2',
        tools: [{ type: 'web_search' }],
        input: `請搜尋並整理此商品可用於上架文案的資訊，輸出繁體中文摘要，包含 IP/角色、品項、可能尺寸材質、注意事項。不要編造不確定資訊：${query}`,
        max_output_tokens: 900,
      }, env);
      return json({ summary: extractOpenAIText(data) });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 900,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `請搜尋並整理此商品可用於上架文案的資訊，輸出繁體中文摘要，包含 IP/角色、品項、可能尺寸材質、注意事項。不要編造不確定資訊：${query}`,
        }],
      }),
    });
    const data = await res.json();
    if (!res.ok) return json({ summary: '' });
    const text = (data.content || []).map(part => part.text || '').join('\n').trim();
    return json({ summary: text });
  } catch (e) {
    return json({ summary: '' });
  }
}

// ── 文案生成 ─────────────────────────────────────────────
async function handleGenerate(request, env) {
  try {
    const body = await request.json();
    // body 格式：{ system, messages, max_tokens }
    // 直接由前端組好 payload，Worker 只加上 key 轉發

    const provider = resolveProvider(env, body.provider);
    if (provider === 'mock') {
      return json(mockAnthropicMessage(mockCopy(body)));
    }
    if (provider === 'openai') {
      return callOpenAIText(body, env);
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
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

    const provider = resolveProvider(env, body.provider);
    if (provider === 'mock') {
      return json(mockAnthropicMessage('尚未接上 LLM 規格辨識；目前可先測試圖片上傳、商品佇列與 Matrixify CSV。'));
    }
    if (provider === 'openai') {
      return callOpenAIVision(body, env);
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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

function resolveProvider(env, requested) {
  const wanted = (requested || env.LLM_PROVIDER || 'auto').toLowerCase();
  if (wanted === 'openai') return env.OPENAI_API_KEY ? 'openai' : 'mock';
  if (wanted === 'anthropic') return env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'mock';
}

async function callOpenAIText(body, env) {
  const input = [
    { role: 'system', content: [{ type: 'input_text', text: body.system || '' }] },
    ...((body.messages || []).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'input_text', text: String(m.content || '') }],
    }))),
  ];
  const data = await callOpenAIResponses({
    model: env.OPENAI_MODEL || body.openai_model || 'gpt-5.2',
    input,
    max_output_tokens: body.max_tokens || 1800,
    text: { format: { type: 'text' } },
  }, env);
  return json(openAIToAnthropicLike(data), data.__status || 200);
}

async function callOpenAIVision(body, env) {
  const dataUrl = `data:${body.media_type || 'image/jpeg'};base64,${body.image_b64}`;
  const data = await callOpenAIResponses({
    model: env.OPENAI_MODEL || body.openai_model || 'gpt-5.2',
    input: [{
      role: 'user',
      content: [
        { type: 'input_image', image_url: dataUrl, detail: 'auto' },
        { type: 'input_text', text: '請辨識此規格圖中所有文字，簡體中文轉繁體中文（台灣用語），整理成清單格式，直接輸出規格內容，不要說明文字。' },
      ],
    }],
    max_output_tokens: 900,
  }, env);
  return json(openAIToAnthropicLike(data), data.__status || 200);
}

async function callOpenAIResponses(payload, env) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  data.__status = res.status;
  if (!res.ok) {
    return { __status: res.status, content: [{ type: 'text', text: data?.error?.message || 'OpenAI request failed' }] };
  }
  return data;
}

function openAIToAnthropicLike(data) {
  if (data.content) return data;
  const text = extractOpenAIText(data);
  return {
    id: data.id || 'openai-response',
    type: 'message',
    role: 'assistant',
    model: data.model || 'openai',
    content: [{ type: 'text', text }],
    stop_reason: data.status || 'completed',
    usage: data.usage || {},
  };
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
      if (part.type === 'text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

function mockAnthropicMessage(text) {
  return {
    id: 'mock-msg',
    type: 'message',
    role: 'assistant',
    model: 'mock-no-llm',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function mockCopy(body) {
  const content = body?.messages?.[0]?.content || '';
  const titleMatch = String(content).match(/標題：(.+)/);
  const priceMatch = String(content).match(/台灣售價：NT\$(\d+)/);
  const title = (titleMatch?.[1] || '潮巢測試商品').trim().slice(0, 54);
  const price = priceMatch?.[1] || '0';
  return JSON.stringify({
    title: `【測試文案】${title}`,
    seo_title: `${title} | 潮巢玩居 CHOCHONEST`,
    description: `✦ 收藏亮點\n這是尚未接上 LLM 前的測試文案，用來驗證上架流程、圖片上傳與 CSV 匯出。\n\n✦ 商品規格\n售價：NT$${price}\n資料來源：前端商品佇列\n\n✦ 適合你如果\n你正在測試 ChochoNest 商品上架工具，確認 Matrixify CSV 欄位與圖片流程是否正常。`,
    seo_description: `潮巢玩居測試商品：${title}。此文案為未接 LLM 前的 mock 內容，用於驗證上架工具流程。`,
    faq: [
      { q: '這是正式 AI 文案嗎？', a: '目前尚未設定 Anthropic API key，因此這是用於測試流程的 mock 文案。' },
      { q: '可以先匯出 Matrixify CSV 嗎？', a: '可以，這份資料可用來測試欄位、圖片與匯入流程。' },
      { q: '之後接上 AI 需要改前端嗎？', a: '不用，只要在 Worker Variables 新增 ANTHROPIC_API_KEY。' },
    ],
    tags: ['IP_測試商品', '角色_未指定', '型態_測試商品', '用途_上架測試'],
    collections: { ip: ['測試商品'], type: ['上架測試'], theme: ['流程驗收'], promo: [] },
    status: 'need_review',
    status_reason: '尚未接上真實 LLM，需人工確認文案內容',
  });
}
