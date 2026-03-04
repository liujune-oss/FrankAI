import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkRecentActivities() {
    console.log("=== Checking 5 Most Recent Activities ===");

    const { data: acts, error: err } = await supabase
        .from('activities')
        .select(`id, title, type, user_id, created_at`)
        .order('created_at', { ascending: false })
        .limit(5);

    if (err) {
        console.error("Error fetching activities:", err);
        return;
    }

    console.table(acts);

    // Let's also get the most recent logged-in user to see if IDs match
    const { data: latestUsers, error: usersErr } = await supabase.auth.admin.listUsers();

    if (usersErr) {
        console.error("Error fetching users:", usersErr);
        return;
    }

    if (latestUsers && latestUsers.users.length > 0) {
        // Find the user who most recently logged in
        const recentUser = latestUsers.users.sort((a, b) => {
            const dateA = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0;
            const dateB = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0;
            return dateB - dateA; // descending
        })[0];

        console.log(`\nMost recently active user details:`);
        console.log(`- Email: ${recentUser.email}`);
        console.log(`- ID: ${recentUser.id}`);
        console.log(`- Last login: ${recentUser.last_sign_in_at || 'Never'}`);
    }
}

checkRecentActivities();
