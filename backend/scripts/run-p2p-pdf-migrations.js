import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('DATABASE_URL (or SUPABASE_DB_URL) env required. Load backend/.env first.');
  process.exit(1);
}

async function run() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log("Connected to PostgreSQL database successfully.");

    console.log("Applying migration: p2p_webhook_settings -> pdf_auto_confirm_enabled...");
    await client.query(`
      ALTER TABLE public.p2p_webhook_settings 
      ADD COLUMN IF NOT EXISTS pdf_auto_confirm_enabled boolean DEFAULT true;
    `);
    console.log("Successfully added pdf_auto_confirm_enabled to p2p_webhook_settings.");

    console.log("Applying migration: subscriptions -> expiry_reminder_sent...");
    await client.query(`
      ALTER TABLE public.subscriptions 
      ADD COLUMN IF NOT EXISTS expiry_reminder_sent boolean DEFAULT false;
    `);
    console.log("Successfully added expiry_reminder_sent to subscriptions.");

    console.log("Database migrations completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
