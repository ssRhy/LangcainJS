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

// 替换现有的formatMessage函数
function formatMessage(msg) {
  try {
    // If it's already a valid message object with role and content
    if (
      msg &&
      typeof msg === "object" &&
      msg.role &&
      msg.content !== undefined
    ) {
      // Handle object content specially - convert to string
      if (typeof msg.content === "object" && !Array.isArray(msg.content)) {
        return {
          role: msg.role,
          content: JSON.stringify(msg.content),
        };
      }
      return msg;
    }

    // If it's a string, make it a user message
    if (typeof msg === "string") {
      return { role: "user", content: msg };
    }

    // If it's an object without proper structure
    if (msg && typeof msg === "object") {
      // Try to extract role and content
      const role = msg.role || "user";
      let content = msg.content || msg.text || JSON.stringify(msg);

      // Handle object content
      if (typeof content === "object" && !Array.isArray(content)) {
        content = JSON.stringify(content);
      }

      return { role, content };
    }

    // Fallback
    return { role: "user", content: String(msg || "") };
  } catch (error) {
    console.error("Error formatting message:", error);
    return { role: "user", content: "Error formatting message" };
  }
}

// 修改createAzureLLM函数，增强消息验证
const createAzureLLM = (config = {}) => {
  try {
    // 尝试创建Azure版本
    console.log("尝试创建Azure OpenAI模型...");

    // 创建原始模型
    const azureOpenAI = new AzureChatOpenAI({
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

    // 声明一个sanitizeMessagesForAPI函数来严格确保消息内容符合API要求
    function sanitizeMessagesForAPI(messages) {
      if (!Array.isArray(messages)) {
        console.warn(
          "sanitizeMessagesForAPI: messages is not an array, fixing..."
        );
        return [{ role: "user", content: String(messages || "") }];
      }

      try {
        return messages.map((msg) => {
          // Ensure message has role and content
          if (!msg.role) msg.role = "user";

          // Handle content formatting
          if (msg.content === undefined || msg.content === null) {
            msg.content = "";
          } else if (
            typeof msg.content === "object" &&
            !Array.isArray(msg.content)
          ) {
            // Convert object content to string to avoid "object instead of string or array" error
            msg.content = JSON.stringify(msg.content);
          }

          return msg;
        });
      } catch (err) {
        console.error("Error sanitizing messages:", err);
        return [{ role: "user", content: "Error processing messages" }];
      }
    }

    // 深度包装API调用，确保消息格式正确
    const originalSend = azureOpenAI.completionWithChatInputs;
    if (originalSend) {
      azureOpenAI.completionWithChatInputs = async function (inputs, options) {
        // 尝试自动修复可能的格式问题
        if (inputs && inputs.messages) {
          try {
            // 首先应用formatMessage函数
            const formattedMessages = inputs.messages.map((msg) =>
              formatMessage(msg)
            );

            // 然后应用严格的sanitize函数
            inputs.messages = sanitizeMessagesForAPI(formattedMessages);

            // 添加额外的验证和修复步骤，确保所有消息内容都是字符串
            inputs.messages = inputs.messages.map((msg, idx) => {
              if (
                msg &&
                typeof msg.content === "object" &&
                !Array.isArray(msg.content)
              ) {
                console.log(
                  `紧急修复：消息[${idx}]的content是对象，强制转换为字符串`
                );
                return {
                  ...msg,
                  content: JSON.stringify(msg.content),
                };
              }
              return msg;
            });

            // 输出最终的消息结构便于调试
            console.log("最终消息数量:", inputs.messages.length);
            inputs.messages.forEach((msg, i) => {
              console.log(
                `消息[${i}]: role=${
                  msg.role
                }, contentType=${typeof msg.content}`
              );
            });
          } catch (e) {
            console.error("消息预处理失败:", e);
          }
        }

        // 确保调用原始函数
        try {
          return await originalSend.call(this, inputs, options);
        } catch (error) {
          console.error("API调用失败:", error.message);

          // 尝试进一步简化消息格式，如果发生错误
          if (
            error.message.includes("Invalid type for 'messages") &&
            inputs &&
            inputs.messages
          ) {
            console.log("尝试紧急修复消息格式...");

            // 改进的紧急修复：只保留基本字符串格式，丢弃复杂结构
            const simplifiedMessages = inputs.messages.map((msg) => {
              // 确保role是有效字符串
              const role = typeof msg.role === "string" ? msg.role : "system";

              // 处理content字段
              let content = "";
              if (typeof msg.content === "string") {
                content = msg.content;
              } else if (Array.isArray(msg.content)) {
                // 如果是数组，确保每个元素都是字符串或简单对象
                content = msg.content.map((item) =>
                  typeof item === "string"
                    ? item
                    : typeof item === "object" && item !== null
                    ? JSON.stringify(item)
                    : String(item || "")
                );
              } else if (msg.content === null || msg.content === undefined) {
                content = "";
              } else if (typeof msg.content === "object") {
                content = JSON.stringify(msg.content);
              } else {
                content = String(msg.content);
              }

              return { role, content };
            });

            // 重试调用
            try {
              inputs.messages = simplifiedMessages;
              return await originalSend.call(this, inputs, options);
            } catch (retryError) {
              console.error("紧急修复后API调用仍然失败:", retryError.message);
              throw retryError;
            }
          }

          throw error;
        }
      };
    }

    // 包装核心方法以确保消息格式化
    const originalInvokeMethod = azureOpenAI.invoke;
    azureOpenAI.invoke = async function (messages, options) {
      console.log("LLM.invoke被调用，确保消息格式化");

      try {
        // 确保每个消息都经过格式化
        const formattedMessages = Array.isArray(messages)
          ? messages.map((msg) => formatMessage(msg))
          : formatMessage(messages);

        // 对格式化后的消息应用原方法
        return await originalInvokeMethod.call(
          this,
          formattedMessages,
          options
        );
      } catch (err) {
        console.error("调用LLM时出错:", err);
        throw err;
      }
    };

    // 包装_convertMessageToOpenAICompatible方法
    if (azureOpenAI._convertMessageToOpenAICompatible) {
      const originalConvertMethod =
        azureOpenAI._convertMessageToOpenAICompatible;
      azureOpenAI._convertMessageToOpenAICompatible = function (message) {
        const formattedMessage = formatMessage(message);
        return originalConvertMethod.call(this, formattedMessage);
      };
    }

    // 返回包装后的模型
    return azureOpenAI;
  } catch (error) {
    console.warn("创建Azure OpenAI模型失败:", error.message);
    console.log("尝试回退使用ChatOpenAI模型...");

    // 尝试回退
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
2. 使用普通script标签（不要使用type="module"）和普通script src引入three.js库
3. 不要使用import/export语句，直接使用全局THREE对象
4. 代码必须使用普通JavaScript语法，不使用ES模块语法
5. 使用CDN引入three.js库（版本0.158.0）：https://cdnjs.cloudflare.com/ajax/libs/three.js/0.158.0/three.min.js
6. 代码应该是完整可运行的HTML文件
7. 用户可调整的参数使用注释标注
8. 包含基本的交互控制`,
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

  // 创建工具调用代理并确保所有消息都被格式化
  return createToolCallingAgent({
    llm,
    tools,
    prompt,
  });
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

    // 创建对话型Agent的简化函数
    const createSimplifiedAgent = (llm, tools) => {
      // 使用简单的文本提示模板，避免复杂结构
      const simplePrompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `你是一个专业的Three.js助手，可以理解用户的需求并生成相应的3D场景代码。如果用户询问如何创建特定的3D对象或场景，可以使用generate_threejs_code工具生成代码，然后用execute_threejs_code工具执行代码。如果用户只是闲聊，直接回答即可。`,
        ],
        new MessagesPlaceholder("chat_history"),
        ["human", "{input}"],
        new MessagesPlaceholder("agent_scratchpad"),
      ]);

      // 创建一个简化的Agent
      return createToolCallingAgent({
        llm,
        tools,
        prompt: simplePrompt,
      });
    };

    // 尝试创建Agent，如果失败则使用简化版本
    console.log("创建对话型Agent...");
    let conversationAgent;
    try {
      // 创建标准Agent
      conversationAgent = createConversationAgent(llm, tools);
    } catch (error) {
      console.warn("创建标准Agent失败，尝试简化版本:", error.message);
      conversationAgent = createSimplifiedAgent(llm, tools);
    }

    // 创建执行器
    const agentExecutor = new AgentExecutor({
      agent: conversationAgent,
      tools,
      memory,
      verbose: true,
      tags: ["threejs-agent", "conversation"],

      // 自定义调用方法，确保所有输入消息都被格式化
      async invoke(input, options = {}) {
        console.log("AgentExecutor.invoke被调用，格式化输入");

        try {
          // 防止未定义的输入
          input = input || {};

          // 格式化聊天历史 - 特别小心处理这个字段
          if (input.chat_history) {
            if (Array.isArray(input.chat_history)) {
              // 深度格式化每个消息
              input.chat_history = input.chat_history.map((msg) =>
                formatMessage(msg)
              );
            } else if (typeof input.chat_history === "object") {
              // 如果不是数组但是对象，则转换为字符串
              input.chat_history = [
                {
                  role: "system",
                  content: JSON.stringify(input.chat_history),
                },
              ];
            } else if (
              input.chat_history === null ||
              input.chat_history === undefined
            ) {
              // 确保至少是空数组
              input.chat_history = [];
            }
          } else {
            // 确保存在聊天历史
            input.chat_history = [];
          }

          // 记录处理后的聊天历史
          console.log("格式化后的chat_history长度:", input.chat_history.length);

          // 确保input内容是字符串
          if (input.input && typeof input.input !== "string") {
            input.input = String(input.input);
          }

          // 安全执行
          try {
            return await super.invoke(input, options);
          } catch (error) {
            console.error("Agent调用错误:", error.message);

            // 如果是消息格式错误
            if (error.message.includes("messages")) {
              console.log("检测到消息格式错误，返回降级输出");
              return {
                output: `由于技术原因无法处理您的请求。请尝试以更简单的方式描述您想要的3D场景。`,
              };
            }

            // 返回适当的错误信息
            return {
              output: `执行出错: ${error.message}`,
            };
          }
        } catch (e) {
          console.error("Agent.invoke出现未处理异常:", e);
          return {
            output: "处理请求时发生意外错误，请重试",
          };
        }
      },

      // 处理Agent动作并添加思考过程到消息队列
      handleAgentAction(action, runManager) {
        console.log("Agent执行动作:", action.tool);
        if (typeof addMessageToQueue === "function") {
          try {
            // 创建安全版本的消息内容
            let actionDescription;
            if (action.toolInput && typeof action.toolInput === "object") {
              actionDescription =
                action.toolInput.description ||
                action.toolInput.code ||
                JSON.stringify(action.toolInput);
            } else {
              actionDescription = String(action.toolInput || "");
            }

            addMessageToQueue({
              type: "agent_thinking",
              content: `我需要使用${action.tool}工具: ${actionDescription}`,
            });
          } catch (e) {
            console.error("发送思考消息失败:", e);
          }
        }
        return action;
      },
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

module.exports = {
  createThreeAgent,
  formatMessage, // 导出格式化函数供其他模块使用
};
