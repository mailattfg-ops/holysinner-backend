CREATE TABLE "returns" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"items" jsonb NOT NULL,
	"mode" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"credit_note_no" text,
	"reason" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_credit_note_no_credit_notes_no_fk" FOREIGN KEY ("credit_note_no") REFERENCES "public"."credit_notes"("no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "returns_sale_idx" ON "returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "returns_date_idx" ON "returns" USING btree ("date");