-- Откат 20261029010000_voice_tickets.sql. Перед откатом на сервере голоса
-- поставьте REQUIRE_TICKET=0 (иначе разговоры без билета будут отклоняться),
-- а приложение гостя без билета работает и со старым сервером голоса.
BEGIN;

DROP FUNCTION IF EXISTS public.voice_ticket_issue(uuid, text, text);
DROP FUNCTION IF EXISTS public.voice_ticket_consume(text);
DROP TABLE IF EXISTS public.voice_tickets;

COMMIT;
NOTIFY pgrst, 'reload schema';
