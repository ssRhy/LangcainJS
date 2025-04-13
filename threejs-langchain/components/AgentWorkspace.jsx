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
  const webSocketRef = useRef(null);
  const [canvasReady, setCanvasReady] = useState(false);

  // 初始化WebSocket连接
  useEffect(() => {
    let wsInstance = null;
    let retryCount = 0;
    let retryTimeout = null;
    const MAX_RETRIES = 5;

    // 创建WebSocket连接函数
    const connectWebSocket = (url) => {
      console.log(
        `尝试连接WebSocket: ${url} (重试: ${retryCount}/${MAX_RETRIES})`
      );

      // 确保URL包含/ws路径
      let wsUrl = url;
      if (!wsUrl.endsWith("/ws")) {
        wsUrl = wsUrl.endsWith("/") ? `${wsUrl}ws` : `${wsUrl}/ws`;
      }

      const socket = new WebSocket(wsUrl);
      webSocketRef.current = socket;

      // 添加全局引用供Agent使用
      if (typeof window !== "undefined") {
        window._threeJsAgentWebSocket = socket;
      }

      socket.onopen = () => {
        console.log("WebSocket连接已建立");
        setSocketReady(true);
        retryCount = 0; // 重置重试计数
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("收到WebSocket消息:", message.type);
          handleMessage(message);
        } catch (error) {
          console.error("解析WebSocket消息出错:", error);
        }
      };

      socket.onclose = (event) => {
        console.log(
          `WebSocket连接已关闭 (code: ${event.code}, reason: ${event.reason})`
        );
        setSocketReady(false);
        retryConnection();
      };

      socket.onerror = (error) => {
        console.error("WebSocket错误:", error);
        setSocketReady(false);

        if (retryCount === 0) {
          addToConversation({
            role: "system",
            content: "WebSocket连接出错，正在尝试重新连接...",
            type: "error",
          });
        }
      };

      return socket;
    };

    // 重试连接函数
    const retryConnection = () => {
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // 指数退避策略，最大10秒

        console.log(`将在 ${delay}ms 后重试WebSocket连接...`);
        clearTimeout(retryTimeout);

        retryTimeout = setTimeout(() => {
          if (wsInstance) {
            try {
              wsInstance.close();
            } catch (e) {
              // 忽略关闭错误
            }
          }
          wsInstance = connectWebSocket(wsUrl);
        }, delay);
      } else {
        console.error(`WebSocket连接失败，已达到最大重试次数 (${MAX_RETRIES})`);
        addToConversation({
          role: "system",
          content: "WebSocket连接失败，请刷新页面重试或检查服务器是否运行",
          type: "error",
        });
      }
    };

    // 首先获取WebSocket服务地址
    let wsUrl = "";
    fetch("/api/ws")
      .then((res) => res.json())
      .then((data) => {
        console.log("WebSocket服务信息:", data);
        wsUrl = data.websocket_url;
        wsInstance = connectWebSocket(wsUrl);
      })
      .catch((error) => {
        console.error("获取WebSocket服务信息失败:", error);

        // 使用默认WebSocket地址
        console.log("使用默认WebSocket地址");
        wsUrl = `ws://${window.location.hostname}:3001/ws`;
        wsInstance = connectWebSocket(wsUrl);

        addToConversation({
          role: "system",
          content: "无法获取WebSocket服务信息，尝试使用默认连接",
          type: "warning",
        });
      });

    return () => {
      // 清理函数
      clearTimeout(retryTimeout);

      // 关闭WebSocket连接
      if (wsInstance) {
        try {
          wsInstance.close();
        } catch (e) {
          // 忽略关闭错误
        }
      }

      webSocketRef.current = null;
      if (typeof window !== "undefined") {
        window._threeJsAgentWebSocket = null;
      }
    };
  }, []);

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

  // 通过WebSocket发送消息
  function sendWebSocketMessage(message) {
    if (
      !webSocketRef.current ||
      webSocketRef.current.readyState !== WebSocket.OPEN
    ) {
      console.error("WebSocket未连接");
      addToConversation({
        role: "system",
        content: "WebSocket未连接，无法发送消息",
        type: "error",
      });
      return false;
    }

    try {
      console.log("发送WebSocket消息:", message);
      webSocketRef.current.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error("发送WebSocket消息出错:", error);
      addToConversation({
        role: "system",
        content: `发送消息失败: ${error.message}`,
        type: "error",
      });
      return false;
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

    // 通过WebSocket发送用户输入
    const success = sendWebSocketMessage({
      type: "user_input",
      content: userInput,
    });

    if (!success) {
      setIsAgentWorking(false);
    }

    setUserInput("");
  }

  // 执行Three.js代码
  async function executeCode(code, requestId) {
    if (!threeCanvasRef.current) {
      console.error("Three.js Canvas组件未初始化");
      sendWebSocketMessage({
        type: "tool_response",
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

      // 返回执行结果
      sendWebSocketMessage({
        type: "tool_response",
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

      sendWebSocketMessage({
        type: "tool_response",
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
      sendWebSocketMessage({
        type: "tool_response",
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

      sendWebSocketMessage({
        type: "tool_response",
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

      sendWebSocketMessage({
        type: "tool_response",
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
      sendWebSocketMessage({
        type: "tool_response",
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

      sendWebSocketMessage({
        type: "tool_response",
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

      sendWebSocketMessage({
        type: "tool_response",
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
