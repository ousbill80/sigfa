CREATE TYPE "public"."agent_language" AS ENUM('FR', 'DIOULA', 'BAOULE', 'EN');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('AVAILABLE', 'SERVING', 'PAUSED', 'ABSENT', 'OFFLINE');--> statement-breakpoint
CREATE TYPE "public"."counter_status" AS ENUM('OPEN', 'PAUSED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."printer_status" AS ENUM('OK', 'PAPER_LOW', 'ERROR', 'OFFLINE');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('OPEN', 'PAUSED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'BANK_ADMIN', 'AGENCY_DIRECTOR', 'MANAGER', 'AGENT', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "public"."ticket_channel" AS ENUM('KIOSK', 'QR', 'MOBILE', 'WHATSAPP');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('STANDARD', 'PRIORITY', 'VIP', 'PMR', 'SENIOR');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('WAITING', 'CALLED', 'SERVING', 'DONE', 'NO_SHOW', 'ABANDONED', 'TRANSFERRED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"queue_critical_threshold" integer DEFAULT 50 NOT NULL,
	"agent_inactivity_minutes" integer DEFAULT 15 NOT NULL,
	"no_show_timeout_minutes" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "banks_slug_unique" UNIQUE("slug"),
	CONSTRAINT "banks_queue_critical_threshold_bounds" CHECK ("banks"."queue_critical_threshold" >= 1 AND "banks"."queue_critical_threshold" <= 500),
	CONSTRAINT "banks_agent_inactivity_minutes_bounds" CHECK ("banks"."agent_inactivity_minutes" >= 1 AND "banks"."agent_inactivity_minutes" <= 60),
	CONSTRAINT "banks_no_show_timeout_minutes_bounds" CHECK ("banks"."no_show_timeout_minutes" >= 1 AND "banks"."no_show_timeout_minutes" <= 30)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"address" text,
	"phone" text,
	"timezone" text DEFAULT 'Africa/Abidjan' NOT NULL,
	"weekly_schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency_exceptional_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"code" varchar(4) NOT NULL,
	"name" text NOT NULL,
	"sla_minutes" integer DEFAULT 10 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "services_agency_id_code_key" UNIQUE("agency_id","code"),
	CONSTRAINT "services_code_format" CHECK ("services"."code" ~ '^[A-Z]{2,4}$'),
	CONSTRAINT "services_sla_minutes_positive" CHECK ("services"."sla_minutes" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"current_ticket_number" integer DEFAULT 0 NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"status" "queue_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queues_current_ticket_number_non_negative" CHECK ("queues"."current_ticket_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counter_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"counter_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counter_services_counter_id_service_id_key" UNIQUE("counter_id","service_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"label" text NOT NULL,
	"status" "counter_status" DEFAULT 'CLOSED' NOT NULL,
	"agent_id" uuid,
	"current_ticket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counters_agency_id_number_key" UNIQUE("agency_id","number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kiosks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"label" text NOT NULL,
	"credentials_hash" text NOT NULL,
	"last_seen" timestamp with time zone,
	"printer_status" "printer_status" DEFAULT 'OFFLINE' NOT NULL,
	"app_version" text,
	"current_session_id" uuid,
	"session_expires_at" timestamp with time zone,
	"session_revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_users_agency_id_user_id_key" UNIQUE("agency_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"from_status" "agent_status",
	"to_status" "agent_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_services_user_id_service_id_key" UNIQUE("user_id","service_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" "role" NOT NULL,
	"languages" agent_language[] DEFAULT '{"FR"}' NOT NULL,
	"work_schedule" jsonb,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"phone_encrypted" text,
	"phone_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_super_admin_bank_id_check" CHECK (("users"."role" = 'SUPER_ADMIN') = ("users"."bank_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"from_counter_id" uuid,
	"from_service_id" uuid NOT NULL,
	"to_service_id" uuid NOT NULL,
	"to_counter_id" uuid,
	"reason" text,
	"transferred_by" uuid NOT NULL,
	"transferred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"counter_id" uuid,
	"agent_id" uuid,
	"number" integer NOT NULL,
	"display_number" text,
	"tracking_id" char(21) NOT NULL,
	"local_uuid" uuid,
	"channel" "ticket_channel" NOT NULL,
	"status" "ticket_status" DEFAULT 'WAITING' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'STANDARD' NOT NULL,
	"phone_encrypted" text,
	"phone_hash" text,
	"sms_consent" boolean DEFAULT false NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"wait_time_seconds" integer,
	"service_time_seconds" integer,
	"feedback_score" integer,
	"feedback_comment" text,
	"feedback_at" timestamp with time zone,
	"issued_day" date GENERATED ALWAYS AS (((issued_at AT TIME ZONE 'Africa/Abidjan')::date)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_tracking_id_unique" UNIQUE("tracking_id"),
	CONSTRAINT "tickets_local_uuid_unique" UNIQUE("local_uuid"),
	CONSTRAINT "tickets_queue_id_number_issued_day_key" UNIQUE("queue_id","number","issued_day"),
	CONSTRAINT "tickets_feedback_score_range" CHECK ("tickets"."feedback_score" IS NULL OR ("tickets"."feedback_score" >= 1 AND "tickets"."feedback_score" <= 5)),
	CONSTRAINT "tickets_feedback_comment_length" CHECK ("tickets"."feedback_comment" IS NULL OR char_length("tickets"."feedback_comment") <= 500)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agencies" ADD CONSTRAINT "agencies_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_exceptional_closures" ADD CONSTRAINT "agency_exceptional_closures_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_exceptional_closures" ADD CONSTRAINT "agency_exceptional_closures_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "services" ADD CONSTRAINT "services_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "services" ADD CONSTRAINT "services_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queues" ADD CONSTRAINT "queues_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queues" ADD CONSTRAINT "queues_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "queues" ADD CONSTRAINT "queues_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_services" ADD CONSTRAINT "counter_services_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_services" ADD CONSTRAINT "counter_services_counter_id_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."counters"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_services" ADD CONSTRAINT "counter_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counters" ADD CONSTRAINT "counters_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counters" ADD CONSTRAINT "counters_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counters" ADD CONSTRAINT "counters_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosks" ADD CONSTRAINT "kiosks_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosks" ADD CONSTRAINT "kiosks_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_status_history" ADD CONSTRAINT "agent_status_history_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_status_history" ADD CONSTRAINT "agent_status_history_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_status_history" ADD CONSTRAINT "agent_status_history_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_services" ADD CONSTRAINT "user_services_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_services" ADD CONSTRAINT "user_services_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_services" ADD CONSTRAINT "user_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_from_counter_id_counters_id_fk" FOREIGN KEY ("from_counter_id") REFERENCES "public"."counters"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_from_service_id_services_id_fk" FOREIGN KEY ("from_service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_to_service_id_services_id_fk" FOREIGN KEY ("to_service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_to_counter_id_counters_id_fk" FOREIGN KEY ("to_counter_id") REFERENCES "public"."counters"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_transferred_by_users_id_fk" FOREIGN KEY ("transferred_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_counter_id_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."counters"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agencies_bank_id_idx" ON "agencies" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_exceptional_closures_bank_id_agency_id_date_idx" ON "agency_exceptional_closures" USING btree ("bank_id","agency_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_bank_id_agency_id_idx" ON "services" USING btree ("bank_id","agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queues_bank_id_agency_id_idx" ON "queues" USING btree ("bank_id","agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "counter_services_bank_id_counter_id_idx" ON "counter_services" USING btree ("bank_id","counter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "counters_bank_id_agency_id_idx" ON "counters" USING btree ("bank_id","agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosks_bank_id_agency_id_idx" ON "kiosks" USING btree ("bank_id","agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_users_bank_id_agency_id_idx" ON "agency_users" USING btree ("bank_id","agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_status_history_bank_id_agent_id_changed_at_idx" ON "agent_status_history" USING btree ("bank_id","agent_id","changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_services_bank_id_user_id_idx" ON "user_services" USING btree ("bank_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_bank_id_email_idx" ON "users" USING btree ("bank_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_transfers_bank_id_ticket_id_idx" ON "ticket_transfers" USING btree ("bank_id","ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_bank_id_agency_id_idx" ON "tickets" USING btree ("bank_id","agency_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_bank_id_phone_hash_idx" ON "tickets" USING btree ("bank_id","phone_hash");