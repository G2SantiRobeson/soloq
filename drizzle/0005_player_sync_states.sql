ALTER TABLE "players" ADD COLUMN "rank_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "rank_error" jsonb;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "recent_error" jsonb;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "backfill_error" jsonb;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_sync_attempt" jsonb;