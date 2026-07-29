DROP INDEX "messages_conversation_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_visitor_session_unique" ON "conversations" USING btree ("agent_id","external_user_id","session_id");--> statement-breakpoint
CREATE INDEX "conversations_visitor_history_idx" ON "conversations" USING btree ("agent_id","external_user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");