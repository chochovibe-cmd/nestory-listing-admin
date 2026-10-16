-- HOTFIX-1: repair FAQ headings copied from the prompt placeholder ("問題")
-- and spec lines prefixed with the placeholder label ("項目:").
-- Data-only; idempotent (a second run matches nothing).
begin;

update public.product_drafts
set generated_faq_html = regexp_replace(
      generated_faq_html,
      '<h3>\s*<strong>\s*問題\s*[:：]?\s*</strong>\s*</h3>\s*<p>([^<]*)</p>',
      '<h3><strong>\1</strong></h3>',
      'g')
where generated_faq_html ~ '<strong>\s*問題\s*[:：]?\s*</strong>';

update public.product_drafts
set spec_text = regexp_replace(spec_text, '^[ \t]*項目[ \t]*[:：][ \t]*', '', 'gn')
where spec_text ~ '(^|\n)\s*項目\s*[:：]';

commit;
