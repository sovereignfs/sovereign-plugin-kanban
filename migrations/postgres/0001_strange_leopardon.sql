CREATE TABLE "kanban_inbox_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"last_seen_at" integer
);
