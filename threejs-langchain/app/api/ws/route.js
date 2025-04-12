import { NextResponse } from "next/server";

export function GET() {
  return new NextResponse("WebSocket endpoint is ready", {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

export const dynamic = "force-dynamic";
