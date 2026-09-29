CREATE INDEX "admin_action_log_created_idx" ON "admin_action_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_action_log_admin_action_idx" ON "admin_action_log" USING btree ("admin_id","action","created_at");--> statement-breakpoint
CREATE INDEX "batches_hub_state_idx" ON "batches" USING btree ("hub_id","custody_state");--> statement-breakpoint
CREATE INDEX "ledger_events_created_idx" ON "ledger_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_kind_state_idx" ON "orders" USING btree ("kind","state");--> statement-breakpoint
CREATE INDEX "orders_hub_state_idx" ON "orders" USING btree ("hub_id","state");--> statement-breakpoint
CREATE INDEX "payment_intents_status_confirmed_idx" ON "payment_intents" USING btree ("status","confirmed_at");--> statement-breakpoint
CREATE INDEX "security_events_created_idx" ON "security_event_log" USING btree ("created_at");