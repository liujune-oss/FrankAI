import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

async function getUserId(req: NextRequest): Promise<string | null> {
    const token = req.headers.get("x-activation-token") || "";
    const fingerprint = req.headers.get("x-device-fingerprint") || "";
    const payload = await verifyToken(token, fingerprint);
    if (!payload || !payload.uid) return null;
    return payload.uid as string;
}

// ─── 注意：conversations 表时间字段为 BIGINT（Unix 毫秒），不是 timestamptz ───
// GET: 增量拉取
// ?since=ISO_timestamp → 转为 ms 后过滤 updated_at > sinceMs
// 不传 since → 全量拉取
// 响应包含 serverTime（ISO），客户端存为下次 since
export async function GET(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const sinceRaw = req.nextUrl.searchParams.get("since");
    const sinceMs = sinceRaw ? new Date(sinceRaw).getTime() : null;

    let query = supabaseAdmin
        .from("conversations")
        .select("id, title, messages, created_at, updated_at, deleted_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

    if (sinceMs) query = query.gt("updated_at", sinceMs);

    let result = await query;

    // deleted_at 列不存在时（迁移未执行），降级为不含墓碑字段的查询
    if (result.error && result.error.message?.includes("deleted_at")) {
        const fallback = supabaseAdmin
            .from("conversations")
            .select("id, title, messages, created_at, updated_at")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false });
        result = (sinceMs ? await fallback.gt("updated_at", sinceMs) : await fallback) as typeof result;
    }

    const { data, error } = result;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const conversations = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        title: (row.title as string) ?? "",
        messages: (row.messages as unknown[]) ?? [],
        createdAt: row.created_at as number,          // BIGINT → 直接用
        updatedAt: row.updated_at as number,          // BIGINT → 直接用
        deletedAt: row.deleted_at                     // timestamptz → 转 ms
            ? new Date(row.deleted_at as string).getTime()
            : null,
    }));

    return NextResponse.json({
        conversations,
        serverTime: new Date().toISOString(),
    });
}

// POST: 写入/更新一条对话（upsert）
// updated_at 用服务器当前时间（ms），避免客户端时钟偏差
export async function POST(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const body = await req.json();
    const conv = body?.conversation;
    if (!conv?.id) return NextResponse.json({ error: "Invalid" }, { status: 400 });

    const nowMs = Date.now();

    const { error } = await supabaseAdmin.from("conversations").upsert(
        {
            id: conv.id,
            user_id: userId,
            title: conv.title ?? "新会话",
            messages: conv.messages ?? [],
            created_at: conv.createdAt ?? nowMs,   // BIGINT ms
            updated_at: nowMs,                     // BIGINT ms，服务器时间
        },
        { onConflict: "id" }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, updatedAt: nowMs });
}

// DELETE: 单条写墓碑 / 全部真删
export async function DELETE(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const body = await req.json();

    // 全部清空 → 真删
    if (body?.all === true) {
        const { error } = await supabaseAdmin
            .from("conversations")
            .delete()
            .eq("user_id", userId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    const id = body?.id;
    if (!id) return NextResponse.json({ error: "Invalid" }, { status: 400 });

    const nowMs = Date.now();

    // 写墓碑：deleted_at 为 timestamptz，updated_at 为 BIGINT ms
    let { error } = await supabaseAdmin
        .from("conversations")
        .update({
            deleted_at: new Date(nowMs).toISOString(),  // timestamptz
            updated_at: nowMs,                           // BIGINT ms
            title: "",
            messages: [],
        })
        .eq("id", id)
        .eq("user_id", userId);

    // deleted_at 列不存在时降级为真删
    if (error && error.message?.includes("deleted_at")) {
        ({ error } = await supabaseAdmin
            .from("conversations")
            .delete()
            .eq("id", id)
            .eq("user_id", userId));
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
