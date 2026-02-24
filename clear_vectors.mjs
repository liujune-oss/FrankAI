import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrlLine = envFile.split('\n').find(line => line.includes('NEXT_PUBLIC_SUPABASE_URL'));
const supabaseKeyLine = envFile.split('\n').find(line => line.includes('SUPABASE_SERVICE_ROLE_KEY'));

const SUPABASE_URL = supabaseUrlLine.split('=')[1].trim();
const SUPABASE_KEY = supabaseKeyLine.split('=')[1].trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function clearTest() {
    console.log("Clearing all user_vectors entries where content includes 'undefined'...");
    const { data: usersInfo } = await supabase.from('user_vectors').select('id');
    const { error } = await supabase.from('user_vectors').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    console.log("Deleted old user_vectors entries");
}

clearTest();
