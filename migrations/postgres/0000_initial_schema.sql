CREATE TABLE "kanban_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"card_id" text,
	"board_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_board_members" (
	"board_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" integer NOT NULL,
	CONSTRAINT "kanban_board_members_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "kanban_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_card_assignees" (
	"card_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" integer NOT NULL,
	CONSTRAINT "kanban_card_assignees_card_id_user_id_pk" PRIMARY KEY("card_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "kanban_card_labels" (
	"card_id" text NOT NULL,
	"label_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	CONSTRAINT "kanban_card_labels_card_id_label_id_pk" PRIMARY KEY("card_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "kanban_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"board_id" text NOT NULL,
	"list_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" integer,
	"position" double precision NOT NULL,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_checklist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"card_id" text NOT NULL,
	"text" text NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"position" double precision NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"card_id" text NOT NULL,
	"parent_id" text,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"position" double precision NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kanban_activity" ADD CONSTRAINT "kanban_activity_card_id_kanban_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "kanban_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_activity" ADD CONSTRAINT "kanban_activity_board_id_kanban_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "kanban_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_board_members" ADD CONSTRAINT "kanban_board_members_board_id_kanban_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "kanban_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_boards" ADD CONSTRAINT "kanban_boards_project_id_kanban_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "kanban_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_card_assignees" ADD CONSTRAINT "kanban_card_assignees_card_id_kanban_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "kanban_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_card_labels" ADD CONSTRAINT "kanban_card_labels_card_id_kanban_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "kanban_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_card_labels" ADD CONSTRAINT "kanban_card_labels_label_id_kanban_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "kanban_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_board_id_kanban_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "kanban_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_list_id_kanban_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "kanban_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_checklist_items" ADD CONSTRAINT "kanban_checklist_items_card_id_kanban_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "kanban_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_comments" ADD CONSTRAINT "kanban_comments_card_id_kanban_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "kanban_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_comments" ADD CONSTRAINT "kanban_comments_parent_id_kanban_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "kanban_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_labels" ADD CONSTRAINT "kanban_labels_board_id_kanban_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "kanban_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_lists" ADD CONSTRAINT "kanban_lists_board_id_kanban_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "kanban_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kanban_activity_board_created_idx" ON "kanban_activity" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "kanban_activity_card_idx" ON "kanban_activity" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "kanban_board_members_user_idx" ON "kanban_board_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kanban_boards_project_idx" ON "kanban_boards" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "kanban_card_assignees_user_idx" ON "kanban_card_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kanban_cards_board_idx" ON "kanban_cards" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "kanban_cards_list_position_idx" ON "kanban_cards" USING btree ("list_id","position");--> statement-breakpoint
CREATE INDEX "kanban_checklist_items_card_position_idx" ON "kanban_checklist_items" USING btree ("card_id","position");--> statement-breakpoint
CREATE INDEX "kanban_comments_card_idx" ON "kanban_comments" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "kanban_labels_board_idx" ON "kanban_labels" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "kanban_lists_board_position_idx" ON "kanban_lists" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "kanban_projects_tenant_idx" ON "kanban_projects" USING btree ("tenant_id");