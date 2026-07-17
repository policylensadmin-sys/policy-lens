// One-off: ensure the private `policies` Storage bucket exists.
//
// Upload → analysis depends on a Supabase Storage bucket named `policies`.
// Run: npx tsx src/scripts/ensureBucket.ts  (from backend/)

import 'dotenv/config';
import { getSupabaseServiceRoleClient } from '../lib/supabase';

const BUCKET = 'policies';

async function main(): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();

  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`listBuckets failed: ${listErr.message}`);

  const exists = (buckets ?? []).some((b) => b.name === BUCKET);
  if (exists) {
    console.log(`[ensureBucket] "${BUCKET}" already exists ✔`);
    return;
  }

  const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: '20MB',
  });
  if (createErr) throw new Error(`createBucket failed: ${createErr.message}`);
  console.log(`[ensureBucket] created private bucket "${BUCKET}" ✔`);
}

main().catch((err: unknown) => {
  console.error(`[ensureBucket] ${(err as Error).message}`);
  process.exitCode = 1;
});
