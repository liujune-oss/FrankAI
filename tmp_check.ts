import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("\n--- Latest Messages ---");
    const { data: acts, error: actErr } = await supabase.from('chat_messages').select('role, content, created_at').order('created_at', { ascending: false }).limit(3);
    if (actErr) console.error("Error fetching messages:", actErr);
    else require('fs').writeFileSync('tmp_msg.json', JSON.stringify(acts, null, 2));
}

check();
