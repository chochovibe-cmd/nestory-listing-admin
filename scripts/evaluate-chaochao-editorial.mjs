/** Explicit, two-call editorial comparison. Never part of verify:all; no draft writes. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildCopySystemPrompt, buildCopyUserMessage } from '../src/lib/providers/systemPrompt.ts';
import { parseCopyProviderOutput, estimateCopyCostUsd } from '../src/lib/providers/copy.ts';

if (!process.argv.includes('--run')) {
  console.log('Explicit opt-in required: node --experimental-strip-types --import ./scripts/register-ts-loader.mjs scripts/evaluate-chaochao-editorial.mjs --run');
  process.exit(0);
}
process.loadEnvFile('.env.local');
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY unavailable');
const model = process.env.OPENAI_COPY_MODEL || 'gpt-4o';
const baseline = '14f27c4';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nestory-editorial-'));
const artifacts = 'docs/audits/fixtures/chaochao-editorial-comparison-2026-09-24.json';
const fixtures = JSON.parse(fs.readFileSync('docs/audits/fixtures/chaochao-copy-rewrite-2026-09-23.json', 'utf8'));
const product = fixtures.cases.find(item => item.id === 'plush-bread');
const input = { ...product.input, tone: '潮巢導購版', copyLength: '標準', saleStatus: '海外現貨', source: '淘寶', knownIpNames: ['三麗鷗'] };
const output = { kind: '真實模型對照；同一固定素材，無搜尋／草稿／發布寫入', baseline, model, input, runs: [] };
try {
  for (const file of ['chaochaoPrompt.ts', 'titlePrompt.ts']) {
    const text = execFileSync('git', ['show', `${baseline}:src/lib/providers/${file}`], { encoding: 'utf8' });
    fs.writeFileSync(path.join(temporary, file), text);
  }
  const old = await import(pathToFileURL(path.join(temporary, 'chaochaoPrompt.ts')).href);
  const suffix = '\n\n【顧客可見語言】\n所有顧客可見 AI 產出使用台灣繁中與台灣慣用詞；包含 enriched_title、generated_description_html、generated_faq_html、seo_title、meta_description、why_we_chose_it、product_highlights、provider-generated spec。原始 taobao_title、original_title、raw OCR、raw web cache 保留原文，不改寫來源資料。';
  const user = buildCopyUserMessage(input);
  const prompts = [
    ['CC-6 baseline', old.buildChaochaoCopySystemPrompt('標準') + suffix],
    ['current local', buildCopySystemPrompt('潮巢導購版', '標準')],
  ];
  for (const [label, system] of prompts) {
    const start = Date.now();
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!response.ok) throw new Error(`Model request failed: HTTP ${response.status}`);
    const data = await response.json();
    const choice = data.choices?.[0];
    if (typeof choice?.message?.content !== 'string') throw new Error('Missing model text');
    const usage = { inputTokens: (data.usage?.prompt_tokens || 0) - (data.usage?.prompt_tokens_details?.cached_tokens || 0), cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 };
    const result = { label, elapsedMs: Date.now() - start, promptChars: system.length, finishReason: choice.finish_reason, usage, estimatedCostUsd: estimateCopyCostUsd(model, usage), output: parseCopyProviderOutput(choice.message.content, 'openai', model) };
    output.runs.push(result);
    fs.writeFileSync(artifacts, JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ label, elapsedMs: result.elapsedMs, usage, estimatedCostUsd: result.estimatedCostUsd, finishReason: result.finishReason }));
  }
  console.log(`Saved ${artifacts}`);
} finally {
  // Remove only the two explicitly created files; no recursive filesystem operations.
  for (const file of ['chaochaoPrompt.ts', 'titlePrompt.ts']) {
    const target = path.join(temporary, file);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  fs.rmdirSync(temporary);
}
