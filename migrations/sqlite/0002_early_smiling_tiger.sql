CREATE TABLE `kanban_project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `kanban_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_project_members_user_idx` ON `kanban_project_members` (`user_id`);--> statement-breakpoint
ALTER TABLE `kanban_boards` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `kanban_projects` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
-- Hand-written (K.17): seed one owner row per existing project so K.18's
-- authz layer can resolve ownership for projects created before this table
-- existed. Not a data-preservation backfill for other users' board access
-- (see SPEC.md's K.17 entry) — just makes the new table non-empty for data
-- that already exists.
INSERT INTO `kanban_project_members` (`project_id`, `user_id`, `tenant_id`, `role`, `added_by`, `created_at`)
SELECT `id`, `created_by`, `tenant_id`, 'owner', `created_by`, `created_at`
FROM `kanban_projects`;