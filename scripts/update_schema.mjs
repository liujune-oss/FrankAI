import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
    const { error } = await supabase.rpc('execute_sql_query', {
        query: `
            ALTER TABLE public.activities DROP CONSTRAINT activities_type_check;
            ALTER TABLE public.activities ADD CONSTRAINT activities_type_check CHECK (type IN ('task', 'event', 'reminder', 'log'));
        `
    });

    // Supabase RPC execute_sql_query isn't standard, usually you can't run DDL commands from the client.
    // If it fails, I will use a different approach.
    console.log("RPC Method Result Error:", error);
}

run();
