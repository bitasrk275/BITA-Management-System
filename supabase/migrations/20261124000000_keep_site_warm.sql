-- Keeps the live website and phone-app API awake during BITA's working day.
-- The free Vercel plan puts the server to sleep when idle, and the first click after a pause
-- then waits 2-5 seconds. GitHub's scheduled ping runs only about once an hour, so instead the
-- database (pg_cron + pg_net, both built into Supabase) pings the site every 3 minutes,
-- about 6:30 AM to 9:30 PM IST (01:00-15:59 UTC), every day. Public URLs only; no data is sent.
-- Skipped where the extensions do not exist (the local test database).
do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''keep-site-warm''';
    execute $sql$
      select cron.schedule(
        'keep-site-warm',
        '*/3 1-15 * * *',
        $job$
          select net.http_get('https://bita-management-system.vercel.app/login');
          select net.http_get('https://bita-management-system.vercel.app/api/field/leave');
        $job$
      )
    $sql$;
  end if;
end
$outer$;
