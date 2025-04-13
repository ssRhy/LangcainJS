import { NextResponse } from "next/server";

// 模拟消息队列
export let messages = [];

// 清理超过30秒的消息
function cleanupOldMessages() {
  const now = Date.now();
  messages = messages.filter((msg) => now - msg.timestamp < 30000);
}

export async function GET() {
  cleanupOldMessages();

  // 返回最新消息并清空队列
  const response = NextResponse.json({
    messages: [...messages],
  });

  messages = [];

  return response;
}

// 添加消息到队列的公共函数
export function addMessageToQueue(message) {
  messages.push({
    ...message,
    timestamp: Date.now(),
  });
}

export async function POST(request) {
  try {
    const data = await request.json();

    // 添加消息到队列
    if (data.message) {
      addMessageToQueue(data.message);
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
