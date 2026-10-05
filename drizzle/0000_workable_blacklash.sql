CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"resets_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"queue_id" integer NOT NULL,
	"map_id" integer NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"duration" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_matches" (
	"player_id" uuid NOT NULL,
	"match_id" text NOT NULL,
	"champion" text NOT NULL,
	"champion_id" integer NOT NULL,
	"position" text NOT NULL,
	"kills" integer NOT NULL,
	"deaths" integer NOT NULL,
	"assists" integer NOT NULL,
	"cs" integer NOT NULL,
	"damage" integer NOT NULL,
	"win" boolean NOT NULL,
	"kill_participation" real,
	CONSTRAINT "player_matches_player_id_match_id_pk" PRIMARY KEY("player_id","match_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"puuid" text NOT NULL,
	"platform" text NOT NULL,
	"profile_icon_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"sync_error" text,
	"scan_start" timestamp with time zone NOT NULL,
	"scan_end" timestamp with time zone,
	"scan_offset" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "players_puuid_unique" UNIQUE("puuid")
);
--> statement-breakpoint
CREATE TABLE "ranked_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"queue" text NOT NULL,
	"tier" text NOT NULL,
	"division" text NOT NULL,
	"league_points" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"owner" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_matches" ADD CONSTRAINT "player_matches_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_matches" ADD CONSTRAINT "player_matches_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_snapshots" ADD CONSTRAINT "ranked_snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_match_match_idx" ON "player_matches" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "snapshot_player_queue_time_idx" ON "ranked_snapshots" USING btree ("player_id","queue","timestamp");