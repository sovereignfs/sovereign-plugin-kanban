ALTER TABLE "kanban_boards" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "kanban_boards" ADD COLUMN "archived_at" bigint;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD COLUMN "archived_at" bigint;