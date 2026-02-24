import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrlLine = envFile.split('\n').find(line => line.includes('NEXT_PUBLIC_SUPABASE_URL'));
const supabaseKeyLine = envFile.split('\n').find(line => line.includes('SUPABASE_SERVICE_ROLE_KEY'));

const SUPABASE_URL = supabaseUrlLine.split('=')[1].trim();
const SUPABASE_KEY = supabaseKeyLine.split('=')[1].trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testQuery() {
    console.log("Checking user_vectors table...");
    const { data, error } = await supabase.from('user_vectors').select('id, user_id, content').limit(5);
    console.log("Vectors found:", data?.length);
    console.log("Data:", data);
    if (error) console.error("Error:", error);
}

testQuery();
