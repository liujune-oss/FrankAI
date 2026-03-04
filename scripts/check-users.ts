import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function findUserIdAndReassign() {
    console.log('Fetching users to find the active one...');

    // In Supabase auth, we'll try to find the actual user ID.
    // Since we don't have direct access to auth admin here without more setup, 
    // let's look at the most recent real activities or users table if possible.

    // We know the test script inserted items between a certain timeframe.
    // Let's first just print distinct user IDs in the activities table.
    const { data: users, error } = await supabase.from('activities').select('user_id');

    if (error) {
        console.error('Error fetching activities:', error);
        return;
    }

    const uniqueUsers = [...new Set(users.map(u => u.user_id))];
    console.log('Unique User IDs found in activities:', uniqueUsers);

    if (uniqueUsers.length <= 1) {
        console.log("Only one user ID exists in the DB, so it should be visible if logged in with that user.");
    } else {
        console.log("Multiple user IDs exist. The test script used the first one.");
        console.log("If you are logged in as a different user, you won't see them.");
    }
}

findUserIdAndReassign();
