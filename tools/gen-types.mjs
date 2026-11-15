// Generates lib/db.types.ts (supabase-js `Database` shape) for the `ops` schema by applying the
// migrations to an in-memory Postgres (PGlite). Same output contract as
// `supabase gen types typescript --schema ops`, so either can overwrite the file.
// Usage: node tools/gen-types.mjs [--check]   (--check fails if the committed file is stale; used in CI)
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'lib', 'db.types.ts');
const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create schema extensions; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`);
const dir = join(root, 'supabase', 'migrations');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(dir, f), 'utf8'));
}
const q = async (sql) => (await db.query(sql)).rows;

const enums = await q(`
  select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'ops' group by t.typname order by t.typname`);
const enumNames = new Set(enums.map((e) => e.name));

const cols = await q(`
  select c.relname as rel, c.relkind as kind, a.attname as col, a.attnum as num, a.attnotnull as notnull,
         (a.atthasdef or a.attidentity <> '' or a.attgenerated <> '') as hasdef,
         t.typname as typ, t.typcategory as cat, et.typname as elem, tn.nspname as typschema
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid join pg_namespace tn on tn.oid = t.typnamespace
  left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
  where n.nspname = 'ops' and c.relkind in ('r','v','m')
  order by c.relname, a.attnum`);

const fks = await q(`
  select c.conname, cl.relname as rel, rcl.relname as ref, rn.nspname as refschema,
         array(select a.attname from unnest(c.conkey) with ordinality k(n, o)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as cols,
         array(select a.attname from unnest(c.confkey) with ordinality k(n, o)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as refcols,
         exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisunique
                 and string_to_array(i.indkey::text, ' ')::int2[] @> c.conkey
                 and string_to_array(i.indkey::text, ' ')::int2[] <@ c.conkey) as one_to_one
  from pg_constraint c join pg_class cl on cl.oid = c.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join pg_class rcl on rcl.oid = c.confrelid join pg_namespace rn on rn.oid = rcl.relnamespace
  where c.contype = 'f' and n.nspname = 'ops'
  order by cl.relname, c.conname`);

const fns = await q(`
  select p.proname as name, p.proretset as setof, rt.typname as ret, rt.typtype as rettype,
         rtn.nspname as retschema, rt.typcategory as retcat, ret_elem.typname as retelem,
         coalesce((select array_agg(a.n order by a.ord)
                     from unnest(coalesce(p.proargnames, '{}'::text[]),
                                      coalesce(p.proargmodes, array_fill('i'::"char", array[coalesce(cardinality(p.proargnames), 0)])))
                          with ordinality as a(n, m, ord) where a.m in ('i','b','v')), '{}') as argnames,
         p.pronargdefaults as ndef,
         array(select t.typname from unnest(p.proargtypes::oid[]) with ordinality x(oid, o)
               join pg_type t on t.oid = x.oid order by x.o) as argtypes,
         array(select coalesce(et.typname, '') from unnest(p.proargtypes::oid[]) with ordinality x(oid, o)
               join pg_type t on t.oid = x.oid left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
               order by x.o) as argelems,
         case when p.proargmodes is not null then
           (select jsonb_agg(jsonb_build_object('name', a.n, 'type', t.typname, 'elem', et.typname) order by a.ord)
              from unnest(p.proargnames, p.proargmodes, p.proallargtypes) with ordinality as a(n, m, ty, ord)
              join pg_type t on t.oid = a.ty left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
             where a.m in ('t','o')) end as outs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join pg_type rt on rt.oid = p.prorettype join pg_namespace rtn on rtn.oid = rt.typnamespace
  left join pg_type ret_elem on ret_elem.oid = rt.typelem and rt.typcategory = 'A'
  where n.nspname = 'ops' and rt.typname <> 'trigger'
    and has_function_privilege('authenticated', p.oid, 'execute')
  order by p.proname`);

const scalar = (typ) => {
  if (enumNames.has(typ)) return `Database["ops"]["Enums"]["${typ}"]`;
  if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'oid'].includes(typ)) return 'number';
  if (typ === 'bool') return 'boolean';
  if (typ === 'json' || typ === 'jsonb') return 'Json';
  if (typ === 'void') return 'undefined';
  return 'string'; // uuid, text, date, timestamptz, ranges, ...
};
const tsType = (typ, elem) => (elem ? `${scalar(elem)}[]` : scalar(typ));
const relations = [...new Set(cols.map((c) => c.rel))];
const tables = relations.filter((r) => cols.find((c) => c.rel === r).kind === 'r');
const views = relations.filter((r) => cols.find((c) => c.rel === r).kind !== 'r');

const relBlock = (rel) => {
  const list = fks.filter((f) => f.rel === rel && f.refschema === 'ops');
  if (!list.length) return '        Relationships: []';
  return `        Relationships: [\n${list.map((f) => `          {
            foreignKeyName: "${f.conname}"
            columns: [${f.cols.map((c) => `"${c}"`).join(', ')}]
            isOneToOne: ${f.one_to_one}
            referencedRelation: "${f.ref}"
            referencedColumns: [${f.refcols.map((c) => `"${c}"`).join(', ')}]
          },`).join('\n')}\n        ]`;
};

let s = `// Generated by tools/gen-types.mjs from supabase/migrations. Do not edit by hand.
// Regenerate: npm run gen:types  (or: supabase gen types typescript --schema ops > lib/db.types.ts)
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  ops: {
    Tables: {\n`;
for (const t of tables) {
  const cs = cols.filter((c) => c.rel === t);
  const row = cs.map((c) => `          ${c.col}: ${tsType(c.typ, c.elem)}${c.notnull ? '' : ' | null'}`).join('\n');
  const ins = cs.map((c) => `          ${c.col}${c.notnull && !c.hasdef ? '' : '?'}: ${tsType(c.typ, c.elem)}${c.notnull ? '' : ' | null'}`).join('\n');
  const upd = cs.map((c) => `          ${c.col}?: ${tsType(c.typ, c.elem)}${c.notnull ? '' : ' | null'}`).join('\n');
  s += `      ${t}: {\n        Row: {\n${row}\n        }\n        Insert: {\n${ins}\n        }\n        Update: {\n${upd}\n        }\n${relBlock(t)}\n      }\n`;
}
s += `    }\n    Views: {\n`;
for (const v of views) {
  const cs = cols.filter((c) => c.rel === v);
  s += `      ${v}: {\n        Row: {\n${cs.map((c) => `          ${c.col}: ${tsType(c.typ, c.elem)} | null`).join('\n')}\n        }\n        Relationships: []\n      }\n`;
}
s += `    }\n    Functions: {\n`;
for (const f of fns) {
  const n = f.argtypes.length;
  const args = f.argtypes.map((t, i) => {
    const name = f.argnames[i] || `arg${i}`;
    const optional = i >= n - f.ndef;
    return `          ${name}${optional ? '?' : ''}: ${tsType(t, f.argelems[i] || null)}`;
  });
  let ret;
  if (f.outs) {
    const fields = f.outs.map((o) => `${o.name}: ${tsType(o.type, o.elem)}`).join('; ');
    ret = `{ ${fields} }`;
  } else if (f.retschema === 'ops' && tables.includes(f.ret)) ret = `Database["ops"]["Tables"]["${f.ret}"]["Row"]`;
  else ret = tsType(f.ret, f.retelem);
  if (f.setof) ret = `${ret}[]`;
  s += `      ${f.name}: {\n        Args: ${n ? `{\n${args.join('\n')}\n        }` : 'never'}\n        Returns: ${ret}\n      }\n`;
}
s += `    }\n    Enums: {\n`;
for (const e of enums) s += `      ${e.name}: ${e.labels.map((l) => `"${l}"`).join(' | ')}\n`;
s += `    }\n    CompositeTypes: {\n      [_ in never]: never\n    }\n  }\n}

type OpsSchema = Database["ops"]
export type Tables<T extends keyof OpsSchema["Tables"]> = OpsSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof OpsSchema["Tables"]> = OpsSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof OpsSchema["Tables"]> = OpsSchema["Tables"][T]["Update"]
export type Views<T extends keyof OpsSchema["Views"]> = OpsSchema["Views"][T]["Row"]
export type Enums<T extends keyof OpsSchema["Enums"]> = OpsSchema["Enums"][T]

export const Constants = {
  ops: {
    Enums: {
${enums.map((e) => `      ${e.name}: [${e.labels.map((l) => `"${l}"`).join(', ')}],`).join('\n')}
    },
  },
} as const
`;

if (process.argv.includes('--check')) {
  const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (cur !== s) { console.error('lib/db.types.ts is stale: run npm run gen:types'); process.exit(1); }
  console.log('lib/db.types.ts is up to date');
} else {
  writeFileSync(out, s);
  console.log(`wrote ${out}: ${tables.length} tables, ${views.length} views, ${fns.length} functions, ${enums.length} enums`);
}
