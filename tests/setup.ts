process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://tremly:tremly@localhost:5432/tremly_test";
process.env.APP_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.SMS_PROVIDER = "none";
process.env.MOYASAR_SECRET_KEY = "sk_test_fake";
process.env.MOYASAR_WEBHOOK_SECRET = "whsec_test";
process.env.APP_URL = "http://localhost:3000";
