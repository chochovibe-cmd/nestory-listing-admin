const ANTHROPIC_VERSION = '2023-06-01';

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith('/api/')) {
        return json({ error: 'Not found' }, 404, cors);
      }

      requireAccessToken(request, env);

      if (url.pathname === '/api/ping' && request.method === 'GET') {
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === '/api/upload' && request.method === 'POST') {
        return await uploadToCloudinary(request, env, cors);
      }

      if (url.pathname === '/api/generate' && request.method === 'POST') {
        return await generateCopy(request, env, cors);
      }

      if (url.pathname === '/api/recognize' && request.method === 'POST') {
        return await recognizeSpec(request, env, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: { message: error.message || 'Worker error' } }, status, cors);
    }
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Access-Token',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function requireAccessToken(request, env) {
  const expected = env.ACCESS_TOKEN;
  if (!expected) throw httpError(500, 'ACCESS_TOKEN secret is not configured');
  const actual = request.headers.get('X-Access-Token') || '';
  if (actual !== expected) throw httpError(401, 'Invalid access token');
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function uploadToCloudinary(request, env, cors) {
  requireEnv(env, ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') throw httpError(400, 'Missing image file');

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = env.CLOUDINARY_FOLDER || 'chochonest/listing-v5';
  const signature = await signCloudinary({ folder, timestamp }, env.CLOUDINARY_API_SECRET);

  const uploadForm = new FormData();
  uploadForm.append('file', file);
  uploadForm.append('api_key', env.CLOUDINARY_API_KEY);
  uploadForm.append('timestamp', timestamp);
  uploadForm.append('folder', folder);
  uploadForm.append('signature', signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const response = await fetch(endpoint, { method: 'POST', body: uploadForm });
  const data = await response.json();
  if (!response.ok) {
    throw httpError(response.status, data?.error?.message || 'Cloudinary upload failed');
  }

  return json({
    public_id: data.public_id,
    secure_url: data.secure_url,
    width: data.width,
    height: data.height,
    format: data.format,
  }, 200, cors);
}

async function generateCopy(request, env, cors) {
  requireEnv(env, ['ANTHROPIC_API_KEY']);
  const body = await request.json();
  const payload = {
    model: env.ANTHROPIC_MODEL || body.model,
    max_tokens: body.max_tokens || 1500,
    system: body.system,
    messages: body.messages || [],
  };
  if (!payload.model) throw httpError(500, 'ANTHROPIC_MODEL is not configured');
  return await callAnthropic(payload, env, cors);
}

async function recognizeSpec(request, env, cors) {
  requireEnv(env, ['ANTHROPIC_API_KEY']);
  const body = await request.json();
  if (!body.image_b64 || !body.media_type) throw httpError(400, 'image_b64 and media_type are required');

  const payload = {
    model: env.ANTHROPIC_MODEL || body.model,
    max_tokens: 800,
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
          text: '請辨識這張商品規格圖，將簡體中文轉成繁體中文，保留尺寸、材質、品牌、比例、注意事項等重點。只輸出可用於商品資料的純文字。',
        },
      ],
    }],
  };
  if (!payload.model) throw httpError(500, 'ANTHROPIC_MODEL is not configured');
  return await callAnthropic(payload, env, cors);
}

async function callAnthropic(payload, env, cors) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw httpError(response.status, data?.error?.message || 'Anthropic request failed');
  }
  return json(data, 200, cors);
}

async function signCloudinary(params, apiSecret) {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const input = new TextEncoder().encode(canonical + apiSecret);
  const digest = await crypto.subtle.digest('SHA-1', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) throw httpError(500, `Missing Worker secret or var: ${missing.join(', ')}`);
}
