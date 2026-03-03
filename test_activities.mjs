import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    console.log("Fetching activities from database...");
    const { data, error } = await supabase.from('activities').select('*').order('created_at', { ascending: false }).limit(10);

    if (error) {
        console.error("Database Error:", error);
    } else {
        console.log(`Found ${data.length} activities.`);
        data.forEach(act => {
            console.log(`\nID: ${act.id}`);
            console.log(`Title: ${act.title}`);
            console.log(`Type: ${act.type}`);
            console.log(`Start: ${act.start_time}`);
            console.log(`End: ${act.end_time}`);
            console.log(`User ID: ${act.user_id}`);
        });
    }
}

test();
