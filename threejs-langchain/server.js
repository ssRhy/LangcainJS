// 使用CommonJS导入语法
const { exec } = require("child_process");
const path = require("path");
const dotenv = require("dotenv");

// 加载环境变量
dotenv.config();

// 明确指定端口
const WS_PORT = process.env.WS_PORT || 3001;
console.log(`将使用端口 ${WS_PORT} 启动WebSocket服务器`);

// 加载WebSocket服务
console.log("开始初始化服务器...");
console.log("尝试导入WebSocket模块...");
const websocketModule = require("./server/websocket.js");
const { server } = websocketModule;
console.log("WebSocket模块导入成功");
console.log("获取到服务器实例");

// 等待WebSocket服务器启动后再启动Next.js
console.log("正在启动WebSocket服务器...");

// 启动服务器
console.log(`服务器将在端口 ${WS_PORT} 上启动`);
server.listen(WS_PORT, () => {
  console.log(`WebSocket服务器已启动，运行在 ws://localhost:${WS_PORT}`);

  // WebSocket服务器启动后再启动Next.js应用
  console.log("正在启动Next.js应用...");
  const nextApp = exec("npm run dev", {
    cwd: path.resolve(__dirname),
    env: process.env,
  });

  nextApp.stdout.on("data", (data) => {
    console.log(`[Next.js]: ${data}`);
  });

  nextApp.stderr.on("data", (data) => {
    console.error(`[Next.js Error]: ${data}`);
  });

  console.log("ThreeJS LangChain应用已启动");
  console.log("1. WebSocket服务器运行在 ws://localhost:3001");
  console.log("2. Next.js应用运行在 http://localhost:3000");

  // 处理进程退出
  process.on("SIGINT", () => {
    console.log("正在关闭服务...");
    nextApp.kill();
    server.close();
    process.exit(0);
  });
});
