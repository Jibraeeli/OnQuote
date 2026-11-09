#!/usr/bin/env node
// supabase/tests/rls.mjs - OnQuote RLS isolation test
//
// RUN:
//   node supabase/tests/rls.mjs
//
// REQUIRED ENV VARS:
//   SUPABASE_URL                e.g. https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   service-role key (NEVER commit; NEVER point at prod)
//   SUPABASE_ANON_KEY           project anon key
//
// PREREQUISITE:
//   Migration 20260417120000_init_schema.sql has been applied to the target project.
//   The job-media bucket is created by this script (idempotent). Storage RLS
//   policies on storage.objects come from §2's migration - until that lands,
//   the storage block will fail. That's expected: this test exists to gate §2.
//
// EXIT CODES:
//   0 - all assertions passed
//   1 - one or more assertions failed (isolation broken somewhere)
//   2 - setup / infra error (missing env, network, missing migration, etc.)
//
// SAFETY:
//   This script creates real users and writes real rows. Only run against a
//   STAGING Supabase project. Do not point SUPABASE_URL at production.

import { createClient } from '@supabase/supabase-js';

// ---------- Env ----------
const URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANK = process.env.SUPABASE_ANON_KEY;
if (!URL || !SRK || !ANK) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY all required.');
  process.exit(2);
}

// ---------- Constants ----------
const EMAIL_A = 'rls-test-a@test.onquote.local';
const EMAIL_B = 'rls-test-b@test.onquote.local';
const PASSWORD = 'rls-test-only-not-a-secret-00000000';
const BUCKET = 'job-media';

// ---------- Admin client (service role; bypasses RLS) ----------
const admin = createClient(URL, SRK, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- Assertion tracking ----------
const failures = [];
function assert(name, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    const suffix = detail ? ` - ${detail}` : '';
    console.log(`  FAIL  ${name}${suffix}`);
    failures.push(name);
  }
}

// ---------- Helpers ----------
async function findUserByEmail(email) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data?.users?.find((u) => u.email === email);
    if (found) return found;
    if (!data?.users?.length || data.users.length < 100) return null;
  }
  return null;
}

async function removeAllObjectsUnder(userId) {
  const { data: topLevel } = await admin.storage.from(BUCKET).list(userId, { limit: 1000 });
  if (!topLevel?.length) return;
  const paths = [];
  for (const entry of topLevel) {
    const sub = `${userId}/${entry.name}`;
    const { data: children } = await admin.storage.from(BUCKET).list(sub, { limit: 1000 });
    if (children?.length) {
      for (const c of children) paths.push(`${sub}/${c.name}`);
    } else {
      paths.push(sub);
    }
  }
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
}

async function cleanup() {
  for (const email of [EMAIL_A, EMAIL_B]) {
    const existing = await findUserByEmail(email);
    if (!existing) continue;
    // Remove storage first - auth.users delete doesn't cascade into storage objects.
    await removeAllObjectsUnder(existing.id);
    // Deleting the auth user cascades to profiles → quote_jobs → usage_daily.
    const { error } = await admin.auth.admin.deleteUser(existing.id);
    if (error) throw new Error(`deleteUser(${email}): ${error.message}`);
  }
}

async function ensureBucket() {
  const { data, error } = await admin.storage.listBuckets();
  if (error) throw error;
  if (!data.some((b) => b.name === BUCKET)) {
    const { error: cErr } = await admin.storage.createBucket(BUCKET, { public: false });
    if (cErr) throw cErr;
  }
}

async function createTestUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);

  const anon = createClient(URL, ANK, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signErr) throw new Error(`signIn(${email}): ${signErr.message}`);

  const client = createClient(URL, ANK, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });

  return { id: data.user.id, email, client };
}

// ---------- Tests ----------

async function testProfiles(A, B) {
  console.log('\nprofiles');

  {
    const { data, error } = await A.client.from('profiles').select('*').eq('id', A.id);
    assert('A can read own profile', !error && data?.length === 1, error?.message ?? `rows=${data?.length}`);
  }
  {
    const { data, error } = await A.client
      .from('profiles').update({ business_name: 'A corp' }).eq('id', A.id).select();
    assert('A can update own profile', !error && data?.length === 1, error?.message ?? `rows=${data?.length}`);
  }
  {
    const { data, error } = await A.client.from('profiles').select('*').eq('id', B.id);
    assert("A cannot read B's profile", !error && data?.length === 0, `rows=${data?.length} err=${error?.message}`);
  }
  {
    const { data, error } = await A.client
      .from('profiles').update({ business_name: 'hacked' }).eq('id', B.id).select();
    assert("A cannot update B's profile (rows=0)", !error && data?.length === 0, `rows=${data?.length} err=${error?.message}`);

    const { data: bCheck } = await admin.from('profiles').select('business_name').eq('id', B.id).single();
    assert("B's profile was not actually mutated", bCheck?.business_name !== 'hacked', `actual=${bCheck?.business_name}`);
  }
}

async function testQuoteJobs(A, B) {
  console.log('\nquote_jobs');

  let aJobId;
  {
    const { data, error } = await A.client.from('quote_jobs').insert({ user_id: A.id }).select().single();
    assert('A can insert own job', !error && !!data?.id, error?.message);
    aJobId = data?.id;
  }
  {
    const { data, error } = await A.client.from('quote_jobs').select('id').eq('id', aJobId);
    assert('A can read own job', !error && data?.length === 1, error?.message ?? `rows=${data?.length}`);
  }

  const { data: bJob, error: seedErr } = await admin
    .from('quote_jobs').insert({ user_id: B.id }).select().single();
  if (seedErr) throw new Error(`seed B job: ${seedErr.message}`);

  {
    const { data, error } = await A.client.from('quote_jobs').select('*').eq('user_id', B.id);
    assert("A cannot read B's jobs", !error && data?.length === 0, `rows=${data?.length} err=${error?.message}`);
  }
  {
    const { error } = await A.client.from('quote_jobs').insert({ user_id: B.id }).select();
    assert("A cannot insert a job with user_id=B (with_check blocks)", !!error, 'insert succeeded, should have failed');
  }
  {
    const { data, error } = await A.client
      .from('quote_jobs').update({ status: 'done' }).eq('id', bJob.id).select();
    assert("A cannot update B's job (rows=0)", !error && data?.length === 0, `rows=${data?.length} err=${error?.message}`);

    const { data: bState } = await admin.from('quote_jobs').select('status').eq('id', bJob.id).single();
    assert("B's job was not actually mutated", bState?.status !== 'done', `actual=${bState?.status}`);
  }
  {
    const { error, count } = await A.client
      .from('quote_jobs').delete({ count: 'exact' }).eq('id', bJob.id);
    assert("A cannot delete B's job", !error && count === 0, `deleted=${count} err=${error?.message}`);

    const { data: stillThere } = await admin.from('quote_jobs').select('id').eq('id', bJob.id);
    assert("B's job still exists after A's delete attempt", stillThere?.length === 1, `rows=${stillThere?.length}`);
  }
}

async function testUsageDaily(A, B) {
  console.log('\nusage_daily');

  const today = new Date().toISOString().slice(0, 10);
  const { error: seedErr } = await admin.from('usage_daily').upsert([
    { user_id: A.id, day: today, quotes_count: 1 },
    { user_id: B.id, day: today, quotes_count: 1 },
  ]);
  if (seedErr) throw new Error(`seed usage_daily: ${seedErr.message}`);

  {
    const { data, error } = await A.client.from('usage_daily').select('*').eq('user_id', A.id);
    assert('A can read own usage', !error && data?.length >= 1, error?.message ?? `rows=${data?.length}`);
  }
  {
    // No write policy exists on usage_daily for clients - ALL writes should fail.
    const { error: insErr } = await A.client
      .from('usage_daily').insert({ user_id: A.id, day: today, quotes_count: 99 });
    assert('A cannot insert own usage (no write policy exists)', !!insErr, 'insert succeeded, should have failed');

    const { data: upData, error: upErr } = await A.client
      .from('usage_daily').update({ quotes_count: 999 }).eq('user_id', A.id).eq('day', today).select();
    assert('A cannot update own usage (no write policy exists)',
      !upErr && upData?.length === 0,
      `rows=${upData?.length} err=${upErr?.message}`);

    const { data: aRow } = await admin
      .from('usage_daily').select('quotes_count').eq('user_id', A.id).eq('day', today).single();
    assert("A's usage row was not actually mutated", aRow?.quotes_count === 1, `actual=${aRow?.quotes_count}`);
  }
  {
    const { data, error } = await A.client.from('usage_daily').select('*').eq('user_id', B.id);
    assert("A cannot read B's usage", !error && data?.length === 0, `rows=${data?.length} err=${error?.message}`);
  }
  {
    const { data, error } = await A.client
      .from('usage_daily').update({ quotes_count: 999 }).eq('user_id', B.id).select();
    assert("A cannot update B's usage", !error && data?.length === 0, `rows=${data?.length} err=${error?.message}`);
  }
}

async function testStorage(A, B) {
  console.log('\nstorage (job-media bucket)');

  const aPath = `${A.id}/test-job/photo.jpg`;
  const bPath = `${B.id}/test-job/photo.jpg`;
  const attackPath = `${B.id}/attack/photo.jpg`;
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // content doesn't matter

  // Seed a file in B's namespace via admin (service role bypasses storage RLS).
  {
    const { error } = await admin.storage.from(BUCKET)
      .upload(bPath, bytes, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw new Error(`seed B file: ${error.message}`);
  }

  {
    const { error } = await A.client.storage.from(BUCKET)
      .upload(aPath, bytes, { upsert: true, contentType: 'image/jpeg' });
    assert('A can upload to own path', !error, error?.message);
  }
  {
    const { data, error } = await A.client.storage.from(BUCKET).download(aPath);
    assert('A can download own file', !error && !!data, error?.message);
  }
  {
    const { error } = await A.client.storage.from(BUCKET)
      .upload(attackPath, bytes, { contentType: 'image/jpeg' });
    assert("A cannot upload into B's namespace", !!error, 'upload succeeded, should have failed');
  }
  {
    const { data, error } = await A.client.storage.from(BUCKET).download(bPath);
    assert("A cannot download B's file",
      !!error || !data,
      !error ? 'download returned data' : error.message);
  }
  {
    const { data, error } = await A.client.storage.from(BUCKET).createSignedUrl(bPath, 60);
    assert("A cannot create a signed URL for B's path",
      !!error || !data?.signedUrl,
      'signed URL was issued');
  }
  {
    const { data, error } = await A.client.storage.from(BUCKET).list(B.id);
    assert("A cannot list B's directory",
      !error && (!data || data.length === 0),
      `entries=${data?.length} err=${error?.message}`);
  }

  // Post-test: make sure our "attack upload" above didn't actually land.
  {
    const { data } = await admin.storage.from(BUCKET).list(`${B.id}/attack`);
    assert("The attack upload did not land in B's namespace", !data || data.length === 0, `entries=${data?.length}`);
  }
}

// ---------- Main ----------
async function main() {
  console.log('setup: pre-run cleanup (idempotent)');
  await cleanup();
  await ensureBucket();

  console.log('setup: creating test users');
  const A = await createTestUser(EMAIL_A);
  const B = await createTestUser(EMAIL_B);
  console.log(`  A = ${A.id}`);
  console.log(`  B = ${B.id}`);

  try {
    await testProfiles(A, B);
    await testQuoteJobs(A, B);
    await testUsageDaily(A, B);
    await testStorage(A, B);
  } finally {
    console.log('\nteardown: cleanup');
    await cleanup();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`FAIL - ${failures.length} assertion(s) failed:`);
    for (const name of failures) console.error(`  - ${name}`);
    process.exit(1);
  }
  console.log('PASS - all RLS assertions held');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFATAL - setup/infra error (not a failed assertion):');
  console.error(err?.stack ?? err);
  process.exit(2);
});
