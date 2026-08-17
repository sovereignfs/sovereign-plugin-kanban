CREATE TABLE `kanban_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`card_id` text,
	`board_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `kanban_cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`board_id`) REFERENCES `kanban_boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_activity_board_created_idx` ON `kanban_activity` (`board_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `kanban_activity_card_idx` ON `kanban_activity` (`card_id`);--> statement-breakpoint
CREATE TABLE `kanban_board_members` (
	`board_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`board_id`, `user_id`),
	FOREIGN KEY (`board_id`) REFERENCES `kanban_boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_board_members_user_idx` ON `kanban_board_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `kanban_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `kanban_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_boards_project_idx` ON `kanban_boards` (`project_id`);--> statement-breakpoint
CREATE TABLE `kanban_card_assignees` (
	`card_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`assigned_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `user_id`),
	FOREIGN KEY (`card_id`) REFERENCES `kanban_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_card_assignees_user_idx` ON `kanban_card_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `kanban_card_labels` (
	`card_id` text NOT NULL,
	`label_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `label_id`),
	FOREIGN KEY (`card_id`) REFERENCES `kanban_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `kanban_labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kanban_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`board_id` text NOT NULL,
	`list_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_date` integer,
	`position` real NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `kanban_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `kanban_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_cards_board_idx` ON `kanban_cards` (`board_id`);--> statement-breakpoint
CREATE INDEX `kanban_cards_list_position_idx` ON `kanban_cards` (`list_id`,`position`);--> statement-breakpoint
CREATE TABLE `kanban_checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`card_id` text NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`position` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `kanban_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_checklist_items_card_position_idx` ON `kanban_checklist_items` (`card_id`,`position`);--> statement-breakpoint
CREATE TABLE `kanban_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`card_id` text NOT NULL,
	`parent_id` text,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `kanban_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `kanban_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_comments_card_idx` ON `kanban_comments` (`card_id`);--> statement-breakpoint
CREATE TABLE `kanban_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `kanban_boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_labels_board_idx` ON `kanban_labels` (`board_id`);--> statement-breakpoint
CREATE TABLE `kanban_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`position` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `kanban_boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_lists_board_position_idx` ON `kanban_lists` (`board_id`,`position`);--> statement-breakpoint
CREATE TABLE `kanban_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kanban_projects_tenant_idx` ON `kanban_projects` (`tenant_id`);