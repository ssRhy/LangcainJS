"use client";

import { useState, useRef, useEffect } from "react";
import ThreeCanvas from "./ThreeCanvas";
import CodeEditor from "./CodeEditor";
import ConversationLog from "./ConversationLog";

export default function AgentWorkspace() {
  const [userInput, setUserInput] = useState("");
  const [conversation, setConversation] = useState([]);
  const [isAgentWorking, setIsAgentWorking] = useState(false);
  const [currentCode, setCurrentCode] = useState("");
  const threeCanvasRef = useRef(null);
  const [socketReady, setSocketReady] = useState(false);
  const requestIdRef = useRef(0);
  const pendingRequestsRef = useRef({});
  const pollingRef = useRef(null);
  const [canvasReady, setCanvasReady] = useState(false);

  // 初始化API通信
  useEffect(() => {
    // 检查API是否准备好
    fetch("/api/ws")
      .then((res) => res.text())
      .then(() => {
        console.log("API连接已建立");
        setSocketReady(true);

        // 开始轮询消息
        startPolling();
      })
      .catch((error) => {
        console.error("API连接失败:", error);
        addToConversation({
          role: "system",
          content: "API连接失败，请刷新页面重试",
          type: "error",
        });
      });

    return () => {
      // 清理轮询
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
      }
    };
  }, []);

  // 轮询API获取消息
  function startPolling() {
    const poll = () => {
      if (document.visibilityState === "visible") {
        // 只在页面可见时轮询
        fetch("/api/messages")
          .then((res) => res.json())
          .catch(() => ({ messages: [] }))
          .then((data) => {
            if (data.messages && data.messages.length > 0) {
              // 处理消息
              data.messages.forEach((message) => {
                handleMessage(message);
              });
            }
          })
          .finally(() => {
            // 继续轮询
            pollingRef.current = setTimeout(poll, 1000);
          });
      } else {
        // 页面不可见时减慢轮询频率
        pollingRef.current = setTimeout(poll, 5000);
      }
    };

    // 开始第一次轮询
    poll();
  }

  // 处理收到的消息
  function handleMessage(message) {
    try {
      // 处理各种消息类型
      switch (message.type) {
        case "agent_thinking":
          addToConversation({
            role: "agent",
            content: message.content,
            type: "thinking",
          });
          break;

        case "agent_message":
          addToConversation({
            role: "agent",
            content: message.content,
            type: "message",
          });
          break;

        case "code_execution":
          setCurrentCode(message.code);
          // 确保Canvas已准备好再执行代码
          if (canvasReady) {
            executeCode(message.code, message.requestId);
          } else {
            // 如果Canvas未准备好，设置一个延迟重试
            setTimeout(() => {
              if (threeCanvasRef.current) {
                executeCode(message.code, message.requestId);
              } else {
                console.warn("Canvas仍未准备好，无法执行代码");
                addToConversation({
                  role: "system",
                  content: "3D渲染环境未准备好，无法执行代码",
                  type: "error",
                });
              }
            }, 1000);
          }
          break;

        case "screenshot_request":
          captureScreenshot(message.quality, message.view, message.requestId);
          break;

        case "scene_analysis_request":
          analyzeScene(message.detail, message.focus, message.requestId);
          break;

        case "agent_complete":
          setIsAgentWorking(false);
          break;

        case "tool_response":
          // 处理工具响应
          const callback = pendingRequestsRef.current[message.requestId];
          if (callback) {
            callback(message.result);
            delete pendingRequestsRef.current[message.requestId];
          }
          break;
      }
    } catch (error) {
      console.error("处理消息错误:", error);
    }
  }

  // 安全地发送API请求
  async function sendApiRequest(endpoint, data) {
    try {
      const response = await fetch(`/api/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`发送到${endpoint}的请求失败:`, error);
      return { success: false, error: error.message };
    }
  }

  // 添加消息到对话
  function addToConversation(message) {
    setConversation((prev) => [...prev, message]);
  }

  // 启动Agent
  async function startAgent() {
    if (!socketReady || !userInput.trim()) return;

    setIsAgentWorking(true);
    addToConversation({
      role: "user",
      content: userInput,
    });

    try {
      // 发送用户输入到服务器
      await sendApiRequest("chat", {
        type: "user_input",
        content: userInput,
      });
    } catch (error) {
      console.error("发送消息错误:", error);
      addToConversation({
        role: "system",
        content: "发送消息失败，请检查网络连接",
        type: "error",
      });
      setIsAgentWorking(false);
    }

    setUserInput("");
  }

  // 执行Three.js代码
  async function executeCode(code, requestId) {
    if (!threeCanvasRef.current) {
      console.error("Three.js Canvas组件未初始化");
      await sendApiRequest("toolResponse", {
        type: "code_execution_result",
        requestId,
        result: {
          success: false,
          error: "Three.js Canvas组件未初始化",
        },
      });
      return;
    }

    try {
      const result = await threeCanvasRef.current.executeCode(code);

      // 返回执行结果给服务器
      await sendApiRequest("toolResponse", {
        type: "code_execution_result",
        requestId,
        result,
      });

      // 显示执行结果
      addToConversation({
        role: "system",
        content: `代码${result.success ? "成功" : "失败"}执行`,
        type: "code_execution",
      });
    } catch (error) {
      console.error("执行代码错误:", error);

      await sendApiRequest("toolResponse", {
        type: "code_execution_result",
        requestId,
        result: {
          success: false,
          error: error.message,
        },
      });
    }
  }

  // 捕获截图
  async function captureScreenshot(quality, view, requestId) {
    if (!threeCanvasRef.current) {
      console.error("Three.js Canvas组件未初始化");
      await sendApiRequest("toolResponse", {
        type: "screenshot_result",
        requestId,
        result: {
          success: false,
          error: "Three.js Canvas组件未初始化",
        },
      });
      return;
    }

    try {
      const result = await threeCanvasRef.current.captureScreenshot(
        quality,
        view
      );

      await sendApiRequest("toolResponse", {
        type: "screenshot_result",
        requestId,
        result,
      });

      if (result.success) {
        addToConversation({
          role: "system",
          content: "截图已捕获",
          type: "screenshot",
          imageUrl: result.screenshot,
        });
      }
    } catch (error) {
      console.error("捕获截图错误:", error);

      await sendApiRequest("toolResponse", {
        type: "screenshot_result",
        requestId,
        result: {
          success: false,
          error: error.message,
        },
      });
    }
  }

  // 分析场景
  async function analyzeScene(detail, focus, requestId) {
    if (!threeCanvasRef.current) {
      console.error("Three.js Canvas组件未初始化");
      await sendApiRequest("toolResponse", {
        type: "scene_analysis_result",
        requestId,
        result: {
          success: false,
          error: "Three.js Canvas组件未初始化",
        },
      });
      return;
    }

    try {
      const result = await threeCanvasRef.current.analyzeScene(detail, focus);

      await sendApiRequest("toolResponse", {
        type: "scene_analysis_result",
        requestId,
        result,
      });

      if (result.success) {
        addToConversation({
          role: "system",
          content: `场景分析: ${JSON.stringify(result.stats, null, 2)}`,
          type: "analysis",
        });
      }
    } catch (error) {
      console.error("分析场景错误:", error);

      await sendApiRequest("toolResponse", {
        type: "scene_analysis_result",
        requestId,
        result: {
          success: false,
          error: error.message,
        },
      });
    }
  }

  // 为演示目的添加模拟消息
  useEffect(() => {
    // 添加初始消息
    setTimeout(() => {
      addToConversation({
        role: "system",
        content: "欢迎使用Three.js Agent。请输入您想要创建的3D场景描述。",
        type: "message",
      });
    }, 500);
  }, []);

  // 处理Canvas引用设置
  const handleCanvasRef = (ref) => {
    threeCanvasRef.current = ref;
    if (ref) {
      setCanvasReady(true);
    }
  };

  return (
    <div className="flex h-screen">
      {/* 左侧面板：对话和代码编辑器 */}
      <div className="w-1/2 flex flex-col border-r border-gray-200">
        {/* 对话历史 */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
          <ConversationLog messages={conversation} />
        </div>

        {/* 用户输入 */}
        <div className="p-4 border-t border-gray-200">
          <textarea
            className="w-full p-2 border rounded"
            rows={3}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="描述你想创建的3D场景..."
            disabled={isAgentWorking}
          />
          <div className="flex justify-between mt-2">
            <button
              className={`px-4 py-2 rounded ${
                isAgentWorking ? "bg-gray-300" : "bg-blue-500 text-white"
              }`}
              onClick={startAgent}
              disabled={isAgentWorking || !socketReady}
            >
              {isAgentWorking ? "代理思考中..." : "开始生成"}
            </button>
            <button
              className="px-4 py-2 text-gray-700 border rounded"
              onClick={() => setConversation([])}
            >
              清空对话
            </button>
          </div>
        </div>

        {/* 代码编辑器 */}
        <div className="h-1/3 border-t border-gray-200">
          <CodeEditor
            code={currentCode}
            readOnly={isAgentWorking}
            onChange={setCurrentCode}
          />
        </div>
      </div>

      {/* 右侧面板：Three.js渲染区域 */}
      <div className="w-1/2 bg-black">
        <ThreeCanvas ref={handleCanvasRef} />
      </div>
    </div>
  );
}
