CREATE TABLE "bank_transfer_vouchers" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"remittance_code" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payer_name" text,
	"voucher_url" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"reject_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transfer_vouchers_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "bank_transfer_vouchers_remittance_code_unique" UNIQUE("remittance_code")
);
--> statement-breakpoint
DROP INDEX "balances_user_idx";--> statement-breakpoint
ALTER TABLE "bank_transfer_vouchers" ADD CONSTRAINT "bank_transfer_vouchers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bankTransferVouchers_userId_idx" ON "bank_transfer_vouchers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bankTransferVouchers_status_idx" ON "bank_transfer_vouchers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bankTransferVouchers_remittanceCode_idx" ON "bank_transfer_vouchers" USING btree ("remittance_code");--> statement-breakpoint
CREATE UNIQUE INDEX "balances_user_id_unique" ON "balances" USING btree ("user_id");