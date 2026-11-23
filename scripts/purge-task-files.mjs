#!/usr/bin/env node
// Keeps the task-files bucket tidy. Run it on a schedule (see docs/RUNBOOK.md, "Task files: clean-up").
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/purge-task-files.mjs [--dry-run] [--days 30] [--stray-hours 24] [--max 1000]
// 1. Makes removals older than --days final (ops.purge_task_attachments) and deletes their objects.
// 2. Deletes objects older than --stray-hours that were uploaded but never registered.
// Before every delete it asks the database (ops.task_files_deletable) and keeps anything that still backs a file.
// Safe to run twice: deleting an object that is already gone is not an error. --dry-run deletes and changes nothing.
// The secret key is read from the environment only. Never put it in the repo or in NEXT_PUBLIC_ variables.
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const BUCKET = "task-files";
const CHUNK = 100;

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** @param client a supabase-js client created with the secret key */
export async function purge(client, { dryRun = false, days = 30, strayHours = 24, max = 1000, log = () => {} } = {}) {
  const ops = client.schema("ops");
  const rpc = async (name, args) => {
    const { data, error } = await ops.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  };
  const summary = { dryRun, finalised: 0, orphans: 0, stray: 0, deleted: 0, kept: 0, failedBatches: 0 };

  const orphans = dryRun ? [] : ((await rpc("purge_task_attachments", { p_days: days })) ?? []);
  summary.orphans = orphans.length;
  const stray = ((await rpc("list_unregistered_task_objects", { p_older_than: `${strayHours} hours`, p_limit: Math.min(max, 1000) })) ?? [])
    .filter((p) => !orphans.includes(p));
  summary.stray = stray.length;
  log({ event: "found", orphans: orphans.length, stray: stray.length });

  const candidates = [...new Set([...orphans, ...stray])].slice(0, max);
  const deletable = new Set();
  for (const part of chunks(candidates, 500)) for (const p of (await rpc("task_files_deletable", { p_paths: part })) ?? []) deletable.add(p);
  const kept = candidates.filter((p) => !deletable.has(p));
  summary.kept = kept.length;
  for (const p of kept) log({ event: "kept", path: p, why: "a file row still points at it" });

  const done = [];
  for (const part of chunks([...deletable], CHUNK)) {
    if (dryRun) {
      for (const p of part) log({ event: "would-delete", path: p });
      continue;
    }
    const { error } = await client.storage.from(BUCKET).remove(part);
    if (error) {
      summary.failedBatches += 1;
      log({ event: "delete-failed", count: part.length, error: error.message });
      continue;
    }
    summary.deleted += part.length;
    done.push(...part);
    for (const p of part) log({ event: "deleted", path: p });
  }

  const acknowledge = [...done, ...kept].filter((p) => orphans.includes(p));
  if (!dryRun && acknowledge.length > 0) await rpc("ack_task_file_orphans", { p_paths: acknowledge });
  return summary;
}

function flag(args, name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a number`);
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const log = (o) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));
  const summary = await purge(client, {
    dryRun: args.includes("--dry-run"),
    days: flag(args, "--days", 30),
    strayHours: flag(args, "--stray-hours", 24),
    max: flag(args, "--max", 1000),
    log,
  });
  log({ event: "summary", ...summary });
  if (summary.failedBatches > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), event: "error", error: e.message }));
    process.exit(1);
  });
}
