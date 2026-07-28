ALTER TABLE "sessions" ADD COLUMN "cc_session_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sessions_cc_session" ON "sessions" USING btree ("cc_session_id");