import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    const { data, error } = await supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(20);

    if (error) {
        console.error("Database Error:", error);
    } else {
        fs.writeFileSync('chat_debug.json', JSON.stringify(data, null, 2));
    }
}

test();
