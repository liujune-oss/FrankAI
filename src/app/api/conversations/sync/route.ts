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

// GET: 拉取用户所有云端对话
export async function GET(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const { data, error } = await supabaseAdmin
        .from("conversations")
        .select("id, title, messages, created_at, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // 将 snake_case 转回 camelCase 供前端使用
    const conversations = (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        messages: row.messages ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));

    return NextResponse.json({ conversations });
}

// POST: 写入/更新一条对话（upsert）
export async function POST(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const body = await req.json();
    const conv = body?.conversation;
    if (!conv?.id) return NextResponse.json({ error: "Invalid" }, { status: 400 });

    const { error } = await supabaseAdmin.from("conversations").upsert(
        {
            id: conv.id,
            user_id: userId,
            title: conv.title ?? "新会话",
            messages: conv.messages ?? [],
            created_at: conv.createdAt,
            updated_at: conv.updatedAt,
        },
        { onConflict: "id" }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

// DELETE: 删除一条或全部对话
export async function DELETE(req: NextRequest) {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!supabaseAdmin) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

    const body = await req.json();

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

    const { error } = await supabaseAdmin
        .from("conversations")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
