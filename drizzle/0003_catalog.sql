CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"category" text NOT NULL,
	"gender" text NOT NULL,
	"hsn" text NOT NULL,
	"cost" numeric(12, 2) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"mrp" numeric(12, 2) NOT NULL,
	"supplier_id" text NOT NULL,
	"hue" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "variants" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"size" text NOT NULL,
	"color" text NOT NULL,
	"barcode" text NOT NULL,
	"stock_offline" integer DEFAULT 0 NOT NULL,
	"stock_online" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 3 NOT NULL,
	CONSTRAINT "variants_barcode_unique" UNIQUE("barcode"),
	CONSTRAINT "variants_stock_not_negative" CHECK ("variants"."stock_offline" >= 0 and "variants"."stock_online" >= 0)
);
--> statement-breakpoint
ALTER TABLE "variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "variants" USING btree ("product_id");