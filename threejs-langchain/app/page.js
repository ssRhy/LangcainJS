"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";

// 动态导入避免SSR问题
const AgentWorkspace = dynamic(() => import("@/components/AgentWorkspace"), {
  ssr: false,
  loading: () => (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">正在加载Three.js Agent</h2>
        <p className="text-gray-500">请稍候...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 初始化API连接
    fetch("/api/ws")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`API状态错误: ${res.status}`);
        }
        return res.text();
      })
      .then(() => {
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("API连接失败:", error);
        setIsLoading(false); // 仍然设置为false以显示界面
      });
  }, []);

  return (
    <main className="min-h-screen">
      {isLoading ? (
        <div className="h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">正在初始化应用...</h2>
            <p className="text-gray-500">请稍候...</p>
          </div>
        </div>
      ) : (
        <AgentWorkspace />
      )}
    </main>
  );
}
