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

// GET: 增量拉取
// ?since=ISO_timestamp → 只返回 updated_at > since 的记录（含墓碑）
// 不传 since → 全量拉取
// 响应包含 serverTime，客户端用它作为下次 since，避免时钟偏差
export async function GET(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const since = req.nextUrl.searchParams.get("since");

    // 优先尝试含 deleted_at 的查询（需要迁移已执行）
    let query = supabaseAdmin
        .from("conversations")
        .select("id, title, messages, created_at, updated_at, deleted_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

    if (since) query = query.gt("updated_at", since);

    let result = await query;

    // deleted_at 列不存在时（迁移未执行），降级为不含墓碑字段的查询
    if (result.error && result.error.message?.includes("deleted_at")) {
        const fallback = supabaseAdmin
            .from("conversations")
            .select("id, title, messages, created_at, updated_at")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false });
        result = (since ? await fallback.gt("updated_at", since) : await fallback) as typeof result;
    }

    const { data, error } = result;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const conversations = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        title: (row.title as string) ?? "",
        messages: (row.messages as unknown[]) ?? [],
        createdAt: new Date(row.created_at as string).getTime(),
        updatedAt: new Date(row.updated_at as string).getTime(),
        deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    }));

    return NextResponse.json({
        conversations,
        serverTime: new Date().toISOString(),
    });
}

// POST: 写入/更新一条对话（upsert）
// updated_at 由服务器生成，不信任客户端时钟
export async function POST(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const body = await req.json();
    const conv = body?.conversation;
    if (!conv?.id) return NextResponse.json({ error: "Invalid" }, { status: 400 });

    const now = new Date().toISOString();

    // 先尝试含 deleted_at: null 的写法（迁移已执行时可清除墓碑）
    let { error } = await supabaseAdmin.from("conversations").upsert(
        {
            id: conv.id,
            user_id: userId,
            title: conv.title ?? "新会话",
            messages: conv.messages ?? [],
            created_at: conv.createdAt ? new Date(conv.createdAt).toISOString() : now,
            updated_at: now,
            deleted_at: null,
        },
        { onConflict: "id" }
    );

    // deleted_at 列不存在时降级（迁移未执行）
    if (error && error.message?.includes("deleted_at")) {
        ({ error } = await supabaseAdmin.from("conversations").upsert(
            {
                id: conv.id,
                user_id: userId,
                title: conv.title ?? "新会话",
                messages: conv.messages ?? [],
                created_at: conv.createdAt ? new Date(conv.createdAt).toISOString() : now,
                updated_at: now,
            },
            { onConflict: "id" }
        ));
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, updatedAt: new Date(now).getTime() });
}

// DELETE: 单条写墓碑 / 全部真删
export async function DELETE(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const body = await req.json();

    // 全部清空 → 用户主动操作，真删（不留墓碑）
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

    const now = new Date().toISOString();

    // 先尝试写墓碑（迁移已执行）
    let { error } = await supabaseAdmin
        .from("conversations")
        .update({ deleted_at: now, updated_at: now, title: "", messages: [] })
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
