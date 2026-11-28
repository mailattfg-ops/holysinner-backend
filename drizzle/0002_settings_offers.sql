CREATE TABLE "offers" (
	"code" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"min_bill" numeric(12, 2) DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "offers_percent_max" CHECK ("offers"."type" <> 'percent' or "offers"."value" <= 100)
);
--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"shop_name" text NOT NULL,
	"tagline" text NOT NULL,
	"address" text NOT NULL,
	"state" text NOT NULL,
	"gstin" text NOT NULL,
	"phone" text NOT NULL,
	"receipt_footer" text NOT NULL,
	"points_per100" integer NOT NULL,
	"point_value" numeric(6, 2) NOT NULL,
	"dead_stock_days" integer NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;