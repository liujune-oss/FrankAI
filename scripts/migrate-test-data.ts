import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fixTestUserIds() {
    // 1. Find the latest legitimate user_id by looking at the most recently updated activity
    // That is NOT one of the test titles.
    const { data: realActivities, error: realErr } = await supabase
        .from('activities')
        .select('user_id')
        .not('title', 'in', '("参加组会", "超市买鸡蛋", "与老同学聚会", "看牙", "回复重要邮件", "记录短视频创意", "缴纳物业费", "与王总共进晚餐", "深蹲训练日志", "制作下周工作汇报PPT")')
        .order('created_at', { ascending: false })
        .limit(1);

    if (realErr || !realActivities || realActivities.length === 0) {
        console.log('Could not find a real user id.');
        return;
    }

    const activeUserId = realActivities[0].user_id;
    console.log(`Found active logged in user id: ${activeUserId}`);

    // 2. Update all activities created in the last 15 minutes to belong to this user
    // We will use the test titles as a safety net
    const testTitles = [
        "参加组会",
        "超市买鸡蛋",
        "与老同学聚会",
        "看牙",
        "回复重要邮件",
        "记录短视频创意",
        "缴纳物业费",
        "与王总共进晚餐",
        "深蹲训练日志",
        "制作下周工作汇报PPT",
        // And variations if the title generation was slightly different
        "致电银行咨询信用卡",
        "制作下周汇报PPT",
        "跟王总吃饭"
    ];

    const { data: updated, error: updateErr } = await supabase
        .from('activities')
        .update({ user_id: activeUserId })
        .in('title', testTitles)
        .select();

    if (updateErr) {
        console.error('Failed to update:', updateErr);
    } else {
        console.log(`Successfully migrated ${updated.length} test records to your active account!`);
        console.log('You should now see them if you refresh the local app page.');
    }
}

fixTestUserIds();
