import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrlLine = envFile.split('\n').find(line => line.includes('NEXT_PUBLIC_SUPABASE_URL'));
const supabaseKeyLine = envFile.split('\n').find(line => line.includes('SUPABASE_SERVICE_ROLE_KEY'));

const SUPABASE_URL = supabaseUrlLine.split('=')[1].trim();
const SUPABASE_KEY = supabaseKeyLine.split('=')[1].trim();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkContent() {
    const { data } = await supabase.from('user_vectors').select('content');
    console.log("Database Vectors Length:", data?.length);
    if (data && data.length > 0) {
        console.log("Vector Content:");
        data.forEach((d, i) => console.log(`--- Vector ${i} ---`, d.content));
    }
}
checkContent();
