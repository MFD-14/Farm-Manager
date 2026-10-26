-- Manual acceptance (owner decision, Oct 2026): evidence photos are not
-- machine-checked. They upload and are logged with the task, and an owner or
-- task manager accepts the task as complete (or sends it back).

-- Task manager: runs the acceptance queue and sees the owner console, without
-- account, WhatsApp or farm-settings administration.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','manager','caretaker','admin'));

ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_actor_type_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_actor_type_check
  CHECK (actor_type IN ('caretaker','owner','manager','system','vim','whatsapp'));

-- Photo-check jobs no longer run; tasks they were holding are picked up by the
-- acceptance sweep and moved to the acceptance queue.
UPDATE vim_jobs SET status = 'done', last_error = 'superseded by manual acceptance', updated_at = now()
WHERE status IN ('queued', 'running');
