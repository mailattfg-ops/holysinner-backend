CREATE TABLE "credit_notes" (
	"no" text PRIMARY KEY NOT NULL,
	"customer_id" text,
	"amount" numeric(12, 2) NOT NULL,
	"balance" numeric(12, 2) NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_balance" CHECK ("credit_notes"."balance" >= 0 and "credit_notes"."balance" <= "credit_notes"."amount")
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"size" text NOT NULL,
	"color" text NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"cost" numeric(12, 2) NOT NULL,
	"gst_rate" integer NOT NULL,
	"returned_qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sale_items_qty" CHECK ("sale_items"."qty" > 0 and "sale_items"."returned_qty" between 0 and "sale_items"."qty")
);
--> statement-breakpoint
ALTER TABLE "sale_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_no" text NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"customer_id" text,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) NOT NULL,
	"offer_code" text,
	"points_redeemed" numeric(12, 2) DEFAULT 0 NOT NULL,
	"tax_total" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"payments" jsonb NOT NULL,
	"cashier_id" text NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	CONSTRAINT "sales_invoiceNo_unique" UNIQUE("invoice_no")
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");