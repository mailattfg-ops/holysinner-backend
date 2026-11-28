CREATE TABLE "purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"bill_no" text NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"supplier_id" text NOT NULL,
	"items" jsonb NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"paid" numeric(12, 2) DEFAULT 0 NOT NULL,
	"trip_id" text,
	"channel" text NOT NULL,
	CONSTRAINT "purchases_paid" CHECK ("purchases"."paid" >= 0 and "purchases"."paid" <= "purchases"."total")
);
--> statement-breakpoint
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"allocations" jsonb NOT NULL,
	"user_id" text,
	CONSTRAINT "supplier_payments_amount" CHECK ("supplier_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_supplier_bill_uq" ON "purchases" USING btree ("supplier_id","bill_no");--> statement-breakpoint
CREATE INDEX "supplier_payments_supplier_idx" ON "supplier_payments" USING btree ("supplier_id");