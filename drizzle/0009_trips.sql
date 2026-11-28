CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"purpose" text NOT NULL,
	"allowance_per_day" numeric(12, 2) NOT NULL,
	"advance" numeric(12, 2) NOT NULL,
	"trip_payment" numeric(12, 2) NOT NULL,
	"expenses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"settled" jsonb,
	"settled_at" timestamp with time zone,
	CONSTRAINT "trips_dates" CHECK ("trips"."end_date" >= "trips"."start_date")
);
--> statement-breakpoint
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NOT VALID: databases seeded before step 10 hold demo bills that point at trips the seed inserts next.
-- New and changed rows are still checked.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action NOT VALID;