-- Phone login is enabled (better-auth `phoneNumber` plugin), and that plugin
-- treats `phone_number` as the account identity key. Without a unique
-- constraint two accounts could claim the same number, breaking sign-in
-- resolution and the synthetic `<number>@phone.openmcp.cn` email derived from
-- it. `NULL`s are exempt from unique indexes, so existing email-only accounts
-- are unaffected.
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number");
