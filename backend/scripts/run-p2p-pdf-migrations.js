import pkg from 'pg';
const { Client } = pkg;

const connectionString = "postgresql://supabase_admin:4Y4ndClhovK4G0@127.0.0.1:5432/postgres";

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
