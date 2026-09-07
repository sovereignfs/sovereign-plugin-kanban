ALTER TABLE `kanban_boards` ADD `description` text;--> statement-breakpoint
ALTER TABLE `kanban_boards` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `kanban_cards` ADD `archived_at` integer;