CREATE TABLE "app_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb
);
--> statement-breakpoint
ALTER TABLE "app_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"entity" text,
	"entity_id" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counters" ENABLE ROW LEVEL SECURITY;