import { NextResponse } from "next/server";
import { addMessageToQueue } from "../messages/route";

export async function POST(request) {
  try {
    const data = await request.json();

    // 添加工具响应消息到队列
    if (data.requestId) {
      addMessageToQueue({
        type: "tool_response",
        requestId: data.requestId,
        result: data.result || {},
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    );
  }
}

export const dynamic = "force-dynamic";
