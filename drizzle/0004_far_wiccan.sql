ALTER TABLE "sync_locks" ADD COLUMN "last_successful_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_locks" ADD COLUMN "last_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_locks" ADD COLUMN "last_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_locks" ADD COLUMN "last_outcome" text;