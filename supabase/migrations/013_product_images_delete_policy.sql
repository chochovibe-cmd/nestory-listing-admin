-- Allow removing a mis-uploaded image without an admin's help. Mirrors the
-- existing "reviewers can update product images" policy's ownership+status
-- check for the table row, and the existing insert/update policies'
-- folder-ownership check for the storage object itself (no delete policy
-- existed for either before this migration).

create policy "reviewers or owners can delete product images"
on public.product_images for delete
using (
  public.is_reviewer()
  or exists (
    select 1 from public.product_drafts d
    where d.id = draft_id
    and d.created_by = auth.uid()
    and d.status in ('pending_input', 'pending_copy', 'needs_revision', 'ready_for_review')
  )
);

create policy "owners can delete own product image objects"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
