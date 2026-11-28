CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text NOT NULL,
	"user_id" text,
	CONSTRAINT "expenses_amount" CHECK ("expenses"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"month" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_on" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salary_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_payments_user_month_uq" ON "salary_payments" USING btree ("user_id","month");