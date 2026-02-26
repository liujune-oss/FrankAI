import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

async function main() {
    const envFile = fs.readFileSync('.env.local', 'utf-8');
    const getEnv = (key: string) => {
        const match = envFile.match(new RegExp(`${key}=(.*)`));
        return match ? match[1].trim() : '';
    };

    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') || getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.from('app_config').select('*').eq('key', 'chat_models').single();
    if (error) {
        console.error("Error fetching models:", error.message);
    } else {
        console.dir(data.value, { depth: null });
    }
}

main();
