CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"variant_id" text NOT NULL,
	"channel" text NOT NULL,
	"qty" integer NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text,
	"reason" text DEFAULT '' NOT NULL,
	"user_id" text,
	CONSTRAINT "stock_movements_qty_not_zero" CHECK ("stock_movements"."qty" <> 0)
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_variant_idx" ON "stock_movements" USING btree ("variant_id","at");