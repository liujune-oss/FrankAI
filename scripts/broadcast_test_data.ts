import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// using anon key is fine if we just want to read activities with service role
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function broadcastToAllKnownActivityUsers() {
    console.log("=== Broadcast Test Data to ALL Known Users ===");

    // 1. Get all unique user_ids from existing activities
    const { data: allActivities, error: actErr } = await supabase.from('activities').select('user_id');
    if (actErr || !allActivities) {
        console.error("Failed to fetch activities.", actErr);
        return;
    }

    const uniqueUsers = [...new Set(allActivities.map(a => a.user_id))].filter(Boolean);
    console.log(`Found ${uniqueUsers.length} unique users who have activities:`, uniqueUsers);

    // 2. Fetch the 10 golden test activities created recently 
    const testTitles = [
        "参加组会", "超市买鸡蛋", "与老同学聚会", "看牙",
        "回复重要邮件", "记录短视频创意", "缴纳物业费",
        "与王总共进晚餐", "深蹲训练日志", "制作下周工作汇报PPT",
        "跟王总吃饭", "致电银行咨询信用卡", "致电银行"
    ];

    const { data: testActivities, error: testErr } = await supabase
        .from('activities')
        .select('*')
        .in('title', testTitles)
        .order('created_at', { ascending: false })
        .limit(20);

    if (testErr || !testActivities || testActivities.length === 0) {
        console.error("Could not find the test activities in the database.", testErr);
        return;
    }

    // Deduplicate activities by title so we only have exactly the unique ones
    const uniqueActivitiesMap = new Map();
    testActivities.forEach(act => {
        if (!uniqueActivitiesMap.has(act.title)) {
            uniqueActivitiesMap.set(act.title, act);
        }
    });

    const uniqueTestActivities = Array.from(uniqueActivitiesMap.values());
    console.log(`Found ${uniqueTestActivities.length} unique test activities to broadcast.`);

    // 3. For each user, insert these activities
    let insertedCount = 0;
    for (const userId of uniqueUsers) {
        for (const act of uniqueTestActivities) {
            // Check if this user already has this specific test item
            const { data: existing } = await supabase
                .from('activities')
                .select('id')
                .eq('user_id', userId)
                .eq('title', act.title)
                .limit(1);

            if (!existing || existing.length === 0) {
                // Insert a copy for this user
                const newAct = { ...act };
                delete newAct.id; // Let database generate a new UUID
                delete newAct.created_at;
                delete newAct.updated_at;
                newAct.user_id = userId;

                const { error: insertErr } = await supabase.from('activities').insert(newAct);
                if (!insertErr) {
                    insertedCount++;
                }
            }
        }
    }

    console.log(`\n✅ Broadcast complete! Copied ${insertedCount} test items to the accounts. Total users: ${uniqueUsers.length}`);
}

broadcastToAllKnownActivityUsers();
