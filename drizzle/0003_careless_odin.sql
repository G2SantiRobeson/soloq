ALTER TABLE "players" ADD COLUMN "scan_pending" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "scan_exhausted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "backfill_season" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "backfill_status" text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "backfill_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "backfill_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_backfill_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "backfill_discovered" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "backfill_processed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "backfill_unavailable" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "match_queue_time_idx" ON "matches" USING btree ("queue_id","timestamp");