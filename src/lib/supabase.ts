import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// We use the Service Role Key here for server-side operations
// DO NOT expose the Service Role Key to the client browser!
export const supabaseAdmin = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

// Helper to check if Supabase is properly configured
export const isSupabaseConfigured = () => {
    return !!supabaseAdmin;
};
