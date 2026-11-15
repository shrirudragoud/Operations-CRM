# End-to-end tests

Run against a local Supabase stack and a production build. They reset the local `ops` data and auth users,
so never point them at a hosted project (the helpers only use `127.0.0.1` URLs by default).

```bash
npx supabase start -x studio,imgproxy,vector,logflare,edge-runtime,realtime,storage-api,postgres-meta,supavisor
```
```bash
npx playwright test --trace off
```

The tests build their own copy of the app against the local stack (ignoring `.env.local`, which may point at a hosted project) and refuse non-local URLs. Magic links are read from
Mailpit (`http://127.0.0.1:54324`). Screenshots land in `test-results/`.
