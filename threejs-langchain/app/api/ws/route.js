import { NextResponse } from "next/server";

// 根据环境设置WebSocket服务器地址
const getWsUrl = () => {
  const port = process.env.WS_PORT || 3001;
  const host = process.env.NEXT_PUBLIC_WS_HOST || "localhost";
  return `ws://${host}:${port}/ws`;
};

// Next.js API路由，客户端用它来获取WebSocket服务信息
export async function GET(request) {
  return NextResponse.json(
    {
      status: "ok",
      websocket_url: getWsUrl(),
    },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
}

export const dynamic = "force-dynamic";
