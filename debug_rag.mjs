import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrlLine = envFile.split('\n').find(line => line.includes('NEXT_PUBLIC_SUPABASE_URL'));
const supabaseKeyLine = envFile.split('\n').find(line => line.includes('SUPABASE_SERVICE_ROLE_KEY'));
const apiKeyLine = envFile.split('\n').find(line => line.includes('GOOGLE_GENERATIVE_AI_API_KEY'));

const SUPABASE_URL = supabaseUrlLine.split('=')[1].trim();
const SUPABASE_KEY = supabaseKeyLine.split('=')[1].trim();
const API_KEY = apiKeyLine.split('=')[1].trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(API_KEY);

async function testRAG() {
    try {
        console.log("Checking user_vectors table...");
        const { data: usersInfo } = await supabase.from('user_vectors').select('user_id').limit(1);
        if (!usersInfo || usersInfo.length === 0) {
            console.log("No vectors in DB.");
            return;
        }
        const userId = usersInfo[0].user_id;

        const queryText = "你记得我的名字吗？";
        console.log(`Generating embedding for query: "${queryText}"`);
        const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
        const embedResult = await embeddingModel.embedContent(queryText);
        const embedding = embedResult.embedding.values;

        console.log("Calling match_user_vectors RPC...");
        const { data: matchedMemories, error } = await supabase.rpc('match_user_vectors', {
            query_embedding: embedding,
            match_threshold: 0.0, // Match everything to see scores
            match_count: 5,
            p_user_id: userId
        });

        if (error) console.error("RPC Error:", error);
        console.log("Matched Memories:", JSON.stringify(matchedMemories, null, 2));

    } catch (e) {
        console.error(e);
    }
}

testRAG();
