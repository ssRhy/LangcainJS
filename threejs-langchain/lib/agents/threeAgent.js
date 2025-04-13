const { AzureChatOpenAI } = require("@langchain/openai");
const { AgentExecutor, createToolCallingAgent } = require("langchain/agents");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const { DynamicStructuredTool } = require("@langchain/core/tools");
const { z } = require("zod");
const { BufferMemory } = require("langchain/memory");
const Client = require("langsmith").Client;
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// 配置LangSmith（可选但推荐用于监控和调试）
const LANGCHAIN_TRACING_V2 = process.env.LANGCHAIN_TRACING_V2 || "true";
const LANGCHAIN_ENDPOINT =
  process.env.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com";
const LANGCHAIN_API_KEY = process.env.LANGCHAIN_API_KEY;
const LANGCHAIN_PROJECT =
  process.env.LANGCHAIN_PROJECT || "ThreeJS-Code-Generation";

// 初始化LangSmith客户端（如果有API密钥）
const langsmith = LANGCHAIN_API_KEY
  ? new Client({
      apiKey: LANGCHAIN_API_KEY,
      endpoint: LANGCHAIN_ENDPOINT,
    })
  : null;

// 动态加载前端通信接口
let addMessageToQueue;
let broadcast;

// 检查是否在Node.js环境中
if (typeof window === "undefined") {
  // Node环境
  addMessageToQueue = (msg) => {
    // 使用process.send或全局事件来传递消息
    // 不要直接导入websocket.js
    console.log("Message to queue:", JSON.stringify(msg));
    global.messageQueue = global.messageQueue || [];
    global.messageQueue.push(msg);
    if (global.messageCallback) global.messageCallback(msg);
  };
} else {
  // 在浏览器环境中定义，使用WebSocket
  addMessageToQueue = (message) => {
    // 检查WebSocket是否已连接
    if (typeof window !== "undefined" && window.WebSocket) {
      const ws = window._threeJsAgentWebSocket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        return;
      }
    }

    // 回退到HTTP
    fetch("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    }).catch((error) => {
      console.error("发送消息出错:", error);
    });

    console.log("添加消息到队列:", message);
  };
}

// 配置 Azure OpenAI
const createAzureLLM = (config = {}) => {
  try {
    // 尝试创建Azure版本
    console.log("尝试创建Azure OpenAI模型...");

    return new AzureChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      azureOpenAIApiKey:
        config.azureOpenAIApiKey || process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiDeploymentName:
        config.azureOpenAIApiDeploymentName ||
        process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      azureOpenAIApiVersion:
        config.azureOpenAIApiVersion ||
        process.env.AZURE_OPENAI_API_VERSION ||
        "2024-02-15-preview",
      azureOpenAIApiEndpoint:
        config.azureOpenAIApiEndpoint || process.env.AZURE_OPENAI_ENDPOINT,
    });
  } catch (error) {
    console.warn("创建Azure OpenAI模型失败:", error.message);
    console.log("尝试回退使用ChatOpenAI模型...");

    // 尝试从非Azure导入ChatOpenAI
    try {
      const { ChatOpenAI } = require("@langchain/openai");

      return new ChatOpenAI({
        modelName: "gpt-3.5-turbo",
        temperature: 0,
        openAIApiKey: process.env.OPENAI_API_KEY,
      });
    } catch (fallbackError) {
      console.error("回退ChatOpenAI创建也失败:", fallbackError);
      throw new Error("无法创建LLM: 请检查API密钥和环境变量配置");
    }
  }
};

// 工具定义层
const createBasicTools = (sessionId) => [
  new DynamicStructuredTool({
    name: "code_validator",
    description: "验证Three.js代码完整性",
    schema: z.object({
      code: z.string().describe("需要验证的完整代码"),
    }),
    func: async ({ code }) => {
      const isValid = code.includes("THREE") && code.includes("new Scene()");
      return isValid ? "代码有效" : "错误：缺少核心Three.js组件";
    },
  }),
  new DynamicStructuredTool({
    name: "execute_threejs_code",
    description: "执行Three.js代码",
    schema: z.object({
      code: z.string().describe("需要执行的Three.js代码"),
    }),
    func: async ({ code }) => {
      console.log("开始执行Three.js代码");

      // 通知前端执行代码
      if (typeof addMessageToQueue === "function") {
        addMessageToQueue({
          type: "code_execution",
          code: code,
          requestId: sessionId + "-code",
        });
      }

      return {
        status: "success",
        message: "代码已提交到前端执行",
      };
    },
  }),
  new DynamicStructuredTool({
    name: "generate_threejs_code",
    description: "根据描述生成完整的Three.js代码",
    schema: z.object({
      description: z.string().describe("3D场景的自然语言描述"),
      complexity: z
        .enum(["simple", "medium", "complex"])
        .optional()
        .describe("代码复杂度"),
    }),
    func: async ({ description, complexity = "medium" }) => {
      // 调用代码生成链
      const llm = createAzureLLM();
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `你是一名专业的Three.js代码生成专家，请根据用户描述生成完整的HTML文件代码，包含完整Three.js场景。
复杂度：${complexity}
代码要求：
1. 包含场景、相机、渲染器、光源和动画循环
2. 使用CDN引入three.js库（版本0.158.0）
3. 代码应该是完整可运行的HTML文件
4. 用户可调整的参数使用注释标注
5. 包含基本的交互控制`,
        ],
        ["human", "{input}"],
      ]);

      const chain = prompt.pipe(llm);
      const result = await chain.invoke({ input: description });
      return result.content;
    },
  }),
  new DynamicStructuredTool({
    name: "capture_screenshot",
    description: "捕获Three.js场景截图",
    schema: z.object({
      quality: z.number().default(0.8).describe("图像质量 0-1"),
      view: z
        .string()
        .default("current")
        .describe("视角: current, front, top, side"),
    }),
    func: async ({ quality, view }) => {
      console.log("请求捕获截图", { quality, view });

      // 通知前端捕获截图
      if (typeof addMessageToQueue === "function") {
        addMessageToQueue({
          type: "screenshot_request",
          quality,
          view,
          requestId: sessionId + "-screenshot",
        });
      }

      return {
        status: "success",
        message: "截图请求已完成",
      };
    },
  }),
  new DynamicStructuredTool({
    name: "analyze_scene",
    description: "分析Three.js场景结构和性能",
    schema: z.object({
      detail: z
        .string()
        .default("basic")
        .describe("分析详细程度: basic, detailed"),
      focus: z
        .string()
        .default("all")
        .describe("分析焦点: all, objects, materials, performance"),
    }),
    func: async ({ detail, focus }) => {
      console.log("请求分析场景", { detail, focus });

      // 通知前端分析场景
      if (typeof addMessageToQueue === "function") {
        addMessageToQueue({
          type: "scene_analysis_request",
          detail,
          focus,
          requestId: sessionId + "-analysis",
        });
      }

      return {
        status: "success",
        message: "场景分析已完成",
      };
    },
  }),
];

// 创建对话Agent
const createConversationAgent = (llm, tools) => {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个专业的Three.js助手，可以理解用户的需求并生成相应的3D场景代码。如果用户询问如何创建特定的3D对象或场景，
请使用generate_threejs_code工具来生成完整的代码。你也可以使用code_validator工具检查代码的有效性，或者使用
execute_threejs_code工具执行代码。如果用户只是闲聊，你可以直接回答不使用工具。

你可以:
1. 根据用户描述生成Three.js代码
2. 验证代码是否符合Three.js标准
3. 执行代码并显示在前端界面
4. 捕获场景截图
5. 分析场景结构和性能`,
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  return createToolCallingAgent({ llm, tools, prompt });
};

// 创建Three.js Agent - 主函数
async function createThreeAgent(config = {}) {
  console.log("创建新版Three.js Agent...");

  try {
    // 检查环境变量
    console.log(
      "环境变量检查: AZURE_OPENAI_API_KEY:",
      process.env.AZURE_OPENAI_API_KEY ? "已设置" : "未设置"
    );
    console.log(
      "环境变量检查: AZURE_OPENAI_ENDPOINT:",
      process.env.AZURE_OPENAI_ENDPOINT ? "已设置" : "未设置"
    );
    console.log(
      "环境变量检查: AZURE_OPENAI_API_DEPLOYMENT_NAME:",
      process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME ? "已设置" : "未设置"
    );

    // 生成唯一的会话ID
    const sessionId = Date.now().toString();

    // 初始化LLM
    console.log("初始化Azure OpenAI LLM...");
    const llm = createAzureLLM(config);

    // 创建工具集
    console.log("创建Agent工具集...");
    const tools = createBasicTools(sessionId);

    // 创建内存组件
    const memory = new BufferMemory({
      returnMessages: true,
      memoryKey: "chat_history",
      inputKey: "input",
      outputKey: "output",
    });

    // 创建对话型Agent
    console.log("创建对话型Agent...");
    const conversationAgent = createConversationAgent(llm, tools);

    // 创建执行器
    const agentExecutor = new AgentExecutor({
      agent: conversationAgent,
      tools,
      memory,
      verbose: true,
      tags: ["threejs-agent", "conversation"], // 添加标签用于LangSmith过滤
    });

    console.log("Agent创建成功!");
    return agentExecutor;
  } catch (error) {
    console.error("创建Agent时发生错误:", error);
    throw new Error(`创建ThreeAgent失败: ${error.message}`);
  }
}

// 如果当前脚本是直接运行的，则设置交互式模式
if (require.main === module) {
  const readline = require("readline");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Three.js场景生成器交互模式");
  console.log("输入描述或输入'exit'退出");

  const runInteractive = async () => {
    try {
      const agent = await createThreeAgent();

      const askQuestion = () => {
        rl.question("\n请描述你想要的3D场景: ", async (input) => {
          if (input.toLowerCase() === "exit") {
            rl.close();
            return;
          }

          try {
            console.log("处理中...");
            const result = await agent.invoke({
              input: input,
              chat_history: [],
            });

            console.log("\n生成结果:");
            console.log(result.output);
          } catch (error) {
            console.error("处理失败:", error);
          }

          askQuestion();
        });
      };

      askQuestion();
    } catch (error) {
      console.error("初始化失败:", error);
      rl.close();
    }
  };

  runInteractive();
}

module.exports = { createThreeAgent };
