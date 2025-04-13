// 导入模块
const WebSocket = require("ws");
const http = require("http");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// 加载环境变量
dotenv.config();

console.log(`WS_PORT: ${process.env.WS_PORT || 3001}`);

// 处理动态加载模块
let addMessageToQueue;
let createThreeAgent;

// 从ES模块或文件动态加载功能
async function loadFunctionality() {
  // 消息队列处理
  try {
    console.log("尝试加载messages模块...");
    let messagesPath = path.resolve(__dirname, "../app/api/messages/route.js");

    if (fs.existsSync(messagesPath)) {
      try {
        // 使用动态import替代require
        const messagesModule = require(messagesPath);
        addMessageToQueue = messagesModule.addMessageToQueue;
        console.log("成功加载messages模块");
      } catch (err) {
        console.warn(`无法直接加载messages模块: ${err.message}`);
        // 创建简单的消息队列
        addMessageToQueue = (msg) => {
          console.log(
            "模拟消息队列:",
            JSON.stringify(msg).substring(0, 100) + "..."
          );
        };
      }
    } else {
      console.warn(`消息模块文件不存在: ${messagesPath}`);
      // 创建简单的消息队列
      addMessageToQueue = (msg) => {
        console.log(
          "模拟消息队列:",
          JSON.stringify(msg).substring(0, 100) + "..."
        );
      };
    }
  } catch (error) {
    console.error("加载消息队列失败:", error);
    // 默认实现
    addMessageToQueue = (msg) => {
      console.log(
        "默认消息队列:",
        JSON.stringify(msg).substring(0, 100) + "..."
      );
    };
  }

  // Agent处理
  try {
    console.log("尝试加载threeAgent模块...");
    const agentPath = path.resolve(__dirname, "../lib/agents/threeAgent.js");

    if (fs.existsSync(agentPath)) {
      try {
        // 使用动态import替代require
        const agentModule = require(agentPath);
        createThreeAgent = agentModule.createThreeAgent;
        console.log("成功加载threeAgent模块");
      } catch (err) {
        console.warn(`无法直接加载threeAgent模块: ${err.message}`);
        // 创建模拟Agent
        createThreeAgent = createMockAgent;
      }
    } else {
      console.warn(`Agent模块文件不存在: ${agentPath}`);
      createThreeAgent = createMockAgent;
    }
  } catch (error) {
    console.error("加载Agent失败:", error);
    createThreeAgent = createMockAgent;
  }
}

// 创建HTTP服务器和WebSocket服务器
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket服务器正在运行");
});

const wss = new WebSocket.Server({ server, path: "/ws" });

// 存储活跃连接
const clients = new Set();

// 广播消息给所有连接的客户端
function broadcast(data) {
  const message = JSON.stringify(data);
  console.log(`广播消息给 ${clients.size} 个客户端:`, data.type);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// 处理WebSocket连接
wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`WebSocket客户端已连接 [${ip}]`);
  clients.add(ws);

  // 发送连接确认
  ws.send(
    JSON.stringify({
      type: "connection_established",
      message: "WebSocket连接已建立",
    })
  );

  // 处理消息
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log("收到WebSocket消息:", data.type);

      if (data.type === "user_input") {
        // 生成请求ID
        const requestId = Date.now().toString();

        // 发送思考消息
        broadcast({
          type: "agent_thinking",
          content: "正在思考如何创建3D场景...",
          requestId,
        });

        try {
          console.log("创建Three.js Agent开始处理用户输入...");

          // 创建Agent
          const agent = await createThreeAgent();
          console.log("Agent创建成功，开始处理请求...");

          // 执行Agent
          const result = await agent.invoke({
            input: data.content,
            chat_history: [],
          });

          console.log("Agent处理完成");

          // 发送Agent响应
          broadcast({
            type: "agent_message",
            content: result.output,
            requestId,
          });

          // 完成状态
          broadcast({
            type: "agent_complete",
            requestId,
          });
        } catch (error) {
          console.error("Agent执行错误:", error);

          // 发送错误消息
          broadcast({
            type: "agent_message",
            content: `处理请求时出错: ${error.message}`,
            requestId,
          });

          broadcast({
            type: "agent_complete",
            requestId,
          });
        }
      } else if (data.type === "tool_response") {
        // 广播工具响应
        broadcast(data);
      }
    } catch (error) {
      console.error("处理WebSocket消息时出错:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: `处理消息出错: ${error.message}`,
        })
      );
    }
  });

  // 处理关闭
  ws.on("close", () => {
    console.log("WebSocket客户端已断开");
    clients.delete(ws);
  });

  // 处理错误
  ws.on("error", (error) => {
    console.error("WebSocket连接错误:", error);
    clients.delete(ws);
  });
});

// 初始化功能
loadFunctionality().catch((err) => {
  console.error("初始化功能时出错:", err);
});

// 导出服务器实例 - 不再这里监听，让server.js负责启动
module.exports = { server, wss, broadcast };
