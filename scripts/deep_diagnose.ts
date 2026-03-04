import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Must use service role key to access auth admin
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

async function diagnose() {
    console.log("=== 1. Checking auth.users ===");
    const { data: users, error: usersErr } = await supabase.auth.admin.listUsers();

    if (usersErr) {
        console.error("Failed to list users:", usersErr);
    } else {
        console.log(`Found ${users.users.length} registered users:`);
        users.users.forEach(u => {
            console.log(` - ID: ${u.id}, Email: ${u.email}, Created: ${u.created_at}, Last Sign In: ${u.last_sign_in_at}`);
        });

        if (users.users.length === 1) {
            const correctUserId = users.users[0].id;
            console.log(`\n=== 2. Only 1 user exists. Enforcing all activities to this user ID: ${correctUserId} ===`);

            const { data: updated, error: updateErr } = await supabase
                .from('activities')
                .update({ user_id: correctUserId })
                .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to update all

            if (updateErr) {
                console.error("Update failed:", updateErr);
            } else {
                console.log("Update executed successfully. Now fetching sample data...");
                const { data: acts } = await supabase.from('activities').select('title, user_id').limit(5);
                console.log(acts);
            }
        } else {
            console.log("\nMultiple users found. You must be logged into one of these.");
            // Print top 5 activities and their user IDs
            const { data: acts } = await supabase.from('activities').select('id, title, user_id, created_at').order('created_at', { ascending: false }).limit(20);
            console.log("\n=== 3. Most recent 20 activities in DB ===");
            acts?.forEach(a => {
                console.log(`- [${a.user_id}] ${a.title} (${a.created_at})`);
            });
        }
    }
}

diagnose();
