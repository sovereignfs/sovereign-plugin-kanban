CREATE INDEX `kanban_comments_author_idx` ON `kanban_comments` (`author_id`);--> statement-breakpoint
CREATE INDEX `kanban_comments_parent_idx` ON `kanban_comments` (`parent_id`);