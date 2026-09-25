/* Runtime regression checks against actual TS functions, not source-text regexes. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, 'src', request.slice(2));
  return resolve.call(this, request, parent, ...rest);
};
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  module._compile(outputText, filename);
};

const { mapCaptureToDraftFields } = require('../src/lib/import/mapCaptureFields.ts');
const { buildCaptureEvidence } = require('../src/lib/providers/captureEvidence.ts');
const { buildWebSearchQuery, isFreshWebSearchCache, resolveWebSearchForGenerate } = require('../src/lib/providers/webSearch/index.ts');
const { reviewChaochaoCopy } = require('../src/lib/providers/copyQuality.ts');
const choices = ['比克「拆盒確認款」', '克林「拆盒確認款」', '孫悟空「拆盒確認款」', '盲盒1個「隨機全新未拆」', '全新端盒「6個不重複機率隱藏」', '貝吉塔「拆盒確認款」', '弗利薩「拆盒確認款」', '超賽孫悟空「拆盒確認款」'];
const flats = choices.flatMap(choice => Array.from({ length: 8 }, () => ({
  option1_name: '款式描述', option1_value: choice,
  option2_name: '款式描述', option2_value: choice,
  option3_name: '大小', option3_value: '均碼',
})));
const body = { source_url: 'https://example.com/item', title: '【名創優品X龍珠聯名】Q版人物萌粒鍵帽盲盒擺件', variants_flat: flats };
const mapped = mapCaptureToDraftFields(body, { userId: 'example-user' });
assert.equal(mapped.variantRows.length, 8, '64 repeated marketplace rows retain 8 distinct choices');
assert.equal(mapped.rawCapture.payload.variants_flat.length, 64, 'immutable original capture is retained');
assert.match(buildCaptureEvidence(mapped.rawCapture), /全新端盒「6個不重複機率隱藏」/);
const conflicting = mapCaptureToDraftFields({ ...body, variants_flat: [...flats, { ...flats[0], cny_price: 99 }] }, { userId: 'example-user' });
assert.equal(conflicting.variantRows.length, 9, 'conflicting commercial data cannot be silently collapsed');
assert.match(buildWebSearchQuery({ rawTitle: body.title }), /名創優品X龍珠聯名/);
assert.equal(isFreshWebSearchCache(new Date().toISOString()), true);
assert.equal(isFreshWebSearchCache(new Date(Date.now() - 8 * 86400000).toISOString()), false);
const findings = reviewChaochaoCopy({ generatedDescriptionHtml: '11cm，為日常增添生活趣味。', whyWeChoseIt: '', generatedFaqHtml: '', metaDescription: '', productHighlights: [] }, '原始賣家規格：8cm');
assert.equal(findings.length, 2, 'generic filler and unsupported numeric spec trigger review');

(async () => {
  let searched = '';
  const provider = { name: 'tavily', isConfigured: () => true, search: async query => {
    searched = query;
    return { query, summary: '候選頁', sources: [], provider: 'tavily' };
  }};
  await resolveWebSearchForGenerate({
    useWebSearch: true, rawTitle: body.title, provider,
    // The caller never sends model-generated spec. Query builder independently ignores image AI.
    imageDescription: 'PVC 11cm',
  });
  assert.doesNotMatch(searched, /PVC|11cm/);
  const stale = await resolveWebSearchForGenerate({ useWebSearch: true, rawTitle: body.title, provider,
    existingCache: { query: searched, queryFingerprint: 'adv8:legacy', summary: 'PVC 11cm', fetchedAt: new Date().toISOString() },
  });
  assert.equal(stale.result.fromCache, false, 'legacy search cache must be invalidated');
  console.log('Copy evidence v2 runtime checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
