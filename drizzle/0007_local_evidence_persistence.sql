CREATE TABLE "achievement_evidence_headers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"queue" text NOT NULL,
	"season" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"version" text NOT NULL,
	"operation_key" text NOT NULL,
	"parent_id" uuid,
	"from_at" timestamp with time zone,
	"to_at" timestamp with time zone,
	"input_revision" bigint,
	"sealed_at_revision" bigint,
	"fingerprint" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_header_operation_unique" UNIQUE("player_id","operation_key"),
	CONSTRAINT "evidence_header_owner_scope_unique" UNIQUE("player_id","id","platform","queue","season"),
	CONSTRAINT "evidence_header_kind" CHECK ("achievement_evidence_headers"."kind" IN ('rank_capture', 'match_scan', 'structural_receipt')),
	CONSTRAINT "evidence_header_source" CHECK ("achievement_evidence_headers"."source" IN ('unknown', 'synthetic')),
	CONSTRAINT "evidence_header_queue" CHECK ("achievement_evidence_headers"."queue" IN ('RANKED_SOLO_5x5', 'RANKED_FLEX_SR')),
	CONSTRAINT "evidence_header_keys" CHECK (length("achievement_evidence_headers"."operation_key") BETWEEN 1 AND 128 AND length("achievement_evidence_headers"."season") BETWEEN 1 AND 64 AND length("achievement_evidence_headers"."version") BETWEEN 1 AND 128),
	CONSTRAINT "evidence_header_interval" CHECK (("achievement_evidence_headers"."from_at" IS NULL AND "achievement_evidence_headers"."to_at" IS NULL) OR ("achievement_evidence_headers"."from_at" IS NOT NULL AND "achievement_evidence_headers"."to_at" IS NOT NULL AND "achievement_evidence_headers"."from_at" < "achievement_evidence_headers"."to_at")),
	CONSTRAINT "evidence_header_seal" CHECK (("achievement_evidence_headers"."status" = 'collecting' AND "achievement_evidence_headers"."kind" <> 'structural_receipt' AND "achievement_evidence_headers"."input_revision" IS NULL AND "achievement_evidence_headers"."sealed_at_revision" IS NULL AND "achievement_evidence_headers"."fingerprint" IS NULL) OR ("achievement_evidence_headers"."status" = 'sealed' AND "achievement_evidence_headers"."kind" = 'structural_receipt' AND "achievement_evidence_headers"."parent_id" IS NOT NULL AND "achievement_evidence_headers"."input_revision" IS NOT NULL AND "achievement_evidence_headers"."sealed_at_revision" IS NOT NULL AND "achievement_evidence_headers"."fingerprint" IS NOT NULL AND "achievement_evidence_headers"."input_revision" >= 0 AND "achievement_evidence_headers"."sealed_at_revision" = "achievement_evidence_headers"."input_revision" + 1 AND "achievement_evidence_headers"."fingerprint" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "evidence_header_data_limit" CHECK (jsonb_typeof("achievement_evidence_headers"."data") = 'object' AND octet_length("achievement_evidence_headers"."data"::text) <= 65536),
	CONSTRAINT "evidence_header_no_self_parent" CHECK ("achievement_evidence_headers"."parent_id" IS NULL OR "achievement_evidence_headers"."parent_id" <> "achievement_evidence_headers"."id")
);
--> statement-breakpoint
ALTER TABLE "achievement_evidence_headers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "achievement_evidence_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"header_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"queue" text NOT NULL,
	"season" text NOT NULL,
	"kind" text NOT NULL,
	"unit_key" text NOT NULL,
	"ordinal" integer NOT NULL,
	"offset" integer,
	"attempt" integer,
	"entity_key" text,
	"previous_unit_id" uuid,
	"reference_unit_id" uuid,
	"revision" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "evidence_unit_key_unique" UNIQUE("header_id","unit_key"),
	CONSTRAINT "evidence_unit_order_unique" UNIQUE("header_id","ordinal"),
	CONSTRAINT "evidence_unit_owner_scope_unique" UNIQUE("player_id","id","platform","queue","season"),
	CONSTRAINT "evidence_unit_kind" CHECK ("achievement_evidence_units"."kind" IN ('page', 'disposition', 'snapshot', 'reference')),
	CONSTRAINT "evidence_unit_revision" CHECK ("achievement_evidence_units"."revision" >= 0 AND "achievement_evidence_units"."ordinal" >= 0),
	CONSTRAINT "evidence_unit_keys" CHECK (length("achievement_evidence_units"."unit_key") BETWEEN 1 AND 128 AND ("achievement_evidence_units"."entity_key" IS NULL OR length("achievement_evidence_units"."entity_key") BETWEEN 1 AND 256)),
	CONSTRAINT "evidence_unit_fingerprint" CHECK ("achievement_evidence_units"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "evidence_unit_page" CHECK (("achievement_evidence_units"."kind" = 'page' AND "achievement_evidence_units"."offset" IS NOT NULL AND "achievement_evidence_units"."offset" >= 0 AND "achievement_evidence_units"."attempt" IS NOT NULL AND "achievement_evidence_units"."attempt" > 0) OR ("achievement_evidence_units"."kind" <> 'page' AND "achievement_evidence_units"."offset" IS NULL AND "achievement_evidence_units"."attempt" IS NULL)),
	CONSTRAINT "evidence_unit_reference" CHECK (("achievement_evidence_units"."kind" = 'reference' AND "achievement_evidence_units"."reference_unit_id" IS NOT NULL) OR ("achievement_evidence_units"."kind" <> 'reference' AND "achievement_evidence_units"."reference_unit_id" IS NULL)),
	CONSTRAINT "evidence_unit_transition" CHECK (("achievement_evidence_units"."kind" = 'disposition' AND "achievement_evidence_units"."entity_key" IS NOT NULL) OR ("achievement_evidence_units"."kind" <> 'disposition' AND "achievement_evidence_units"."previous_unit_id" IS NULL)),
	CONSTRAINT "evidence_unit_no_self_reference" CHECK (("achievement_evidence_units"."previous_unit_id" IS NULL OR "achievement_evidence_units"."previous_unit_id" <> "achievement_evidence_units"."id") AND ("achievement_evidence_units"."reference_unit_id" IS NULL OR "achievement_evidence_units"."reference_unit_id" <> "achievement_evidence_units"."id")),
	CONSTRAINT "evidence_unit_data_limit" CHECK (jsonb_typeof("achievement_evidence_units"."data") = 'object' AND octet_length("achievement_evidence_units"."data"::text) <= 16384)
);
--> statement-breakpoint
ALTER TABLE "achievement_evidence_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "source_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "achievement_evidence_headers" ADD CONSTRAINT "achievement_evidence_headers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_evidence_headers" ADD CONSTRAINT "evidence_header_parent_scope_fk" FOREIGN KEY ("player_id","parent_id","platform","queue","season") REFERENCES "public"."achievement_evidence_headers"("player_id","id","platform","queue","season") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_evidence_units" ADD CONSTRAINT "achievement_evidence_units_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_evidence_units" ADD CONSTRAINT "evidence_unit_header_scope_fk" FOREIGN KEY ("player_id","header_id","platform","queue","season") REFERENCES "public"."achievement_evidence_headers"("player_id","id","platform","queue","season") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_evidence_units" ADD CONSTRAINT "evidence_unit_previous_scope_fk" FOREIGN KEY ("player_id","previous_unit_id","platform","queue","season") REFERENCES "public"."achievement_evidence_units"("player_id","id","platform","queue","season") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_evidence_units" ADD CONSTRAINT "evidence_unit_reference_scope_fk" FOREIGN KEY ("player_id","reference_unit_id","platform","queue","season") REFERENCES "public"."achievement_evidence_units"("player_id","id","platform","queue","season") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_source_revision_nonnegative" CHECK ("players"."source_revision" >= 0);