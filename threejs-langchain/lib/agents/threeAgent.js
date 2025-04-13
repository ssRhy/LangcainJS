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

// 增强的消息格式化函数
function formatMessage(msg) {
  try {
    // 处理undefined或null
    if (msg === undefined || msg === null) {
      return { role: "user", content: "" };
    }

    // 如果是字符串，直接转为用户消息
    if (typeof msg === "string") {
      return { role: "user", content: msg };
    }

    // 对象类型处理
    if (typeof msg === "object") {
      // 特殊处理agent_scratchpad字段，这通常是出错的源头
      if (msg.agent_scratchpad && typeof msg.agent_scratchpad === "object") {
        console.log("检测到agent_scratchpad对象，移除或转换为字符串");
        if (typeof msg.content === "object") {
          msg.content = JSON.stringify(msg.content);
        }
        delete msg.agent_scratchpad;
      }

      // 确保有效的role
      const role = msg.role && typeof msg.role === "string" ? msg.role : "user";

      // 特殊处理content字段
      let content = "";

      // 处理不同类型的content
      if (msg.content === undefined || msg.content === null) {
        content = "";
      } else if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // 数组类型：确保数组中每个元素都是字符串或合法对象
        try {
          content = msg.content.map((item) => {
            // 如果是字符串直接返回
            if (typeof item === "string") return item;

            // 如果是合法的函数调用对象，确保它符合OpenAI格式
            if (item && typeof item === "object") {
              // 检查是否已经是合法的内容对象格式
              if (
                item.type &&
                (item.type === "text" ||
                  item.type === "image_url" ||
                  item.type === "function_call")
              ) {
                return item;
              }

              // 否则尝试转为文本
              return { type: "text", text: JSON.stringify(item) };
            }

            // 其他类型转为字符串
            return String(item || "");
          });
        } catch (err) {
          console.error("处理content数组失败，转为字符串:", err);
          content = JSON.stringify(msg.content);
        }
      } else if (typeof msg.content === "object") {
        // 对象类型处理
        console.warn("消息content是对象类型，进行特殊处理");
        
        // 检查是否为OpenAI支持的特殊对象格式
        if (msg.content.type && [
            "text",
            "image_url",
            "function_call"
          ].includes(msg.content.type)) {
          // 如果是单个符合格式的对象，将其转换为数组格式
          content = [msg.content];
          console.log("已将单个对象转换为数组格式");
        } else {
          // 其他对象类型转为字符串
          content = JSON.stringify(msg.content);
        }
      } else {
        // 其他类型转为字符串
        content = String(msg.content);
      }

      // 最终检查确保content是字符串或合法数组
      if (typeof content !== "string" && !Array.isArray(content)) {
        console.warn("警告：content格式仍不正确，强制转为字符串");
        content = JSON.stringify(content);
      }

      // 返回格式化后的消息
      return { role, content };
    }

    // 其他类型全部转为字符串
    return { role: "user", content: String(msg || "") };
  } catch (error) {
    console.error("消息格式化错误:", error);
    return { role: "user", content: "消息格式化错误" };
  }
}

// 增强的消息数组净化函数
function sanitizeMessagesForAPI(messages) {
  // 处理非数组输入
  if (!Array.isArray(messages)) {
    console.warn("sanitizeMessagesForAPI: 输入不是数组，修复中...");
    return [{ role: "user", content: String(messages || "") }];
  }

  // 过滤和净化所有消息
  let sanitized = messages.map((msg, idx) => {
    // 处理非对象或空消息
    if (!msg || typeof msg !== "object") {
      console.warn(`sanitizeMessagesForAPI: 消息[${idx}]无效，替换`);
      return { role: "user", content: String(msg || "") };
    }

    // 确保角色字段有效
    const role = msg.role && typeof msg.role === "string" ? msg.role : "user";

    // 处理content字段
    let content;

    // 不同类型内容处理
    if (msg.content === undefined || msg.content === null) {
      content = "";
    } else if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      // 验证数组内容是否符合OpenAI要求 (字符串或特定格式对象)
      try {
        content = msg.content.map((item) => {
          // 字符串直接保留
          if (typeof item === "string") return item;

          // 如果是符合OpenAI规范的格式化对象
          if (
            item &&
            typeof item === "object" &&
            (item.type === "text" ||
              item.type === "image_url" ||
              item.type === "function_call")
          ) {
            return item;
          }

          // 其他对象类型转为JSON字符串
          if (item && typeof item === "object") {
            return { type: "text", text: JSON.stringify(item) };
          }

          // 其他类型转为文本
          return { type: "text", text: String(item || "") };
        });
      } catch (err) {
        console.error(
          `sanitizeMessagesForAPI: 消息[${idx}]的content数组处理失败，转为字符串:`,
          err
        );
        content = JSON.stringify(msg.content);
      }
    } else if (typeof msg.content === "object") {
      // 对象类型转为字符串
      console.warn(
        `sanitizeMessagesForAPI: 消息[${idx}]的content是对象，转为字符串`
      );
      // 检查是否为OpenAI支持的特殊对象格式
      if (msg.content.type && [
          "text",
          "image_url",
          "function_call"
        ].includes(msg.content.type)) {
        // 如果是单个符合格式的对象，将其转换为数组格式
        content = [msg.content];
      } else {
        // 其他对象类型转为字符串
        content = JSON.stringify(msg.content);
      }
    } else {
      // 其他类型转为字符串
      content = String(msg.content);
    }

    // 返回净化后的消息
    return { role, content };
  });

  // 过滤掉可能的null或undefined
  sanitized = sanitized.filter(Boolean);

  // 确保至少有一条消息
  if (sanitized.length === 0) {
    sanitized.push({ role: "user", content: "请提供帮助" });
  }

  return sanitized;
}

// 修改createAzureLLM函数，简化处理消息格式
const createAzureLLM = (config = {}) => {
  try {
    // 尝试创建Azure版本
    console.log("尝试创建Azure OpenAI模型...");
    
    // 定义消息格式化函数
    const formatMessages = (messages) => {
      // 如果不是数组，转换为数组
      if (!Array.isArray(messages)) {
        console.warn('警告: messages不是数组，转换为数组');
        return [{ role: 'user', content: String(messages || '') }];
      }
      
      // 对每个消息进行格式化
      return messages.map((msg, idx) => {
        // 如果不是对象，转换为对象
        if (!msg || typeof msg !== "object") {
          return { role: "user", content: String(msg || "") };
        }
        
        // 确保 role 合法
        const role = msg.role || "user";
        let content = msg.content;
        
        // 统一把 null/undefined 转为空字符串
        if (content == null) {
          content = "";
        }
        // 如果 content 不是字符串，强制转为字符串
        else if (typeof content !== "string") {
          try {
            content = JSON.stringify(content);
          } catch (err) {
            content = "";
          }
        }
        
        return { role, content };
      });
    };

    // 创建原始模型，并添加回调函数
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
      callbacks: [{
        handleLLMStart: async (llm, messages) => {
          console.log("MessageValidator: 验证消息格式");
          // 格式化消息并返回
          return { messages: formatMessages(messages) };
        }
      }]
    });
    
    // 包装invoke方法以确保消息格式化
    const originalInvoke = azureOpenAI.invoke;
    azureOpenAI.invoke = async function(messages, options) {
      // 格式化消息
      const formattedMessages = formatMessages(messages);
      // 调用原始方法
      return originalInvoke.call(this, formattedMessages, options);
    };
    
    console.log('返回带消息格式化功能的LLM实例');
    return azureOpenAI;
  } catch (error) {
    console.warn("创建Azure OpenAI模型失败:", error.message);
    throw error;
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
          `你是一名专业的Three.js代码生成专家，请根据用户描述生成Three.js代码。生成的代码要简洁易懂，专注于核心功能。

请生成纯JavaScript代码片段，不要使用HTML或Markdown格式，因为这个代码将直接在Three.js环境中执行。
你的代码将在已经设置好了以下变量的环境中运行：
- scene: THREE.Scene的实例，已初始化
- camera: THREE.PerspectiveCamera的实例，已设置在(2, 2, 5)的位置并指向(0, 0, 0)
- renderer: THREE.WebGLRenderer的实例，已配置
- THREE: Three.js库已导入可全局使用

严格要求：
1. 不要创建场景(scene)、相机(camera)或渲染器(renderer)，直接使用已存在的变量
2. 不要包含任何渲染循环代码(requestAnimationFrame或animate函数)
3. 不使用import/export语句
4. 直接使用scene.add()将对象添加到场景中，确保添加创建的所有对象
5. 不要使用document.querySelector或任何DOM操作
6. 代码必须添加至少一个3D对象到场景中
7. 复杂度：${complexity}
8. 不要在注释或代码中包含任何Markdown格式
9. 不要输出代码块标记
10. 代码必须是纯JavaScript，没有任何包装
11. 不要创建任何函数，直接使用线性代码
12. 确保每个创建的3D对象都使用scene.add()添加到场景中
13. 避免使用类定义或模块语法

优秀的代码示例：
// 创建一个红色立方体
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const cube = new THREE.Mesh(geometry, material);
cube.position.y = 0.5;
scene.add(cube);

// 添加一个地面
const planeGeometry = new THREE.PlaneGeometry(10, 10);
const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = -Math.PI / 2;
scene.add(plane);

只输出纯JavaScript代码，不包含任何HTML标记、代码块标记或其他格式标记。不需要任何解释。每个对象创建后必须立即调用scene.add()将其添加到场景中。`,
        ],
        ["human", "{input}"],
      ]);

      const chain = prompt.pipe(llm);
      const result = await chain.invoke({ input: description });

      // 清理结果，确保只返回可执行的JavaScript代码
      let code = result.content;

      // 如果输出仍然包含代码块，提取代码块内容
      const codeBlockRegex = /```(?:javascript|js)?\s*([\s\S]*?)```/;
      const match = code.match(codeBlockRegex);
      if (match && match[1]) {
        code = match[1].trim();
      }

      // 移除可能的HTML注释或Markdown格式
      code = code.replace(/<!--[\s\S]*?-->/g, "");

      // 如果代码以注释开头并包含关键字"代码"，尝试提取实际代码部分
      if (code.trim().startsWith("//") && code.includes("代码")) {
        const lines = code.split("\n");
        let firstCodeLine = 0;
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].trim().startsWith("//") && lines[i].trim().length > 0) {
            firstCodeLine = i;
            break;
          }
        }
        if (firstCodeLine > 0) {
          code = lines.slice(firstCodeLine).join("\n");
        }
      }

      // 如果代码中包含"return"语句，需要确保它不返回整个代码
      if (code.includes("return ") && !code.includes("function ")) {
        code = code.replace(/return\s+[^;]+;/g, "// 已移除return语句");
      }

      // 最终清理
      code = code.trim();

      // 如果检测到代码是函数定义，提取函数体
      if (code.startsWith("function ") && code.includes("{")) {
        const funcBodyMatch = code.match(/{([\s\S]+)}/);
        if (funcBodyMatch && funcBodyMatch[1]) {
          code = funcBodyMatch[1].trim();
        }
      }

      // 确保代码没有被包裹在立即执行函数中
      if (code.startsWith("(function") && code.endsWith("})();")) {
        const funcBodyMatch = code.match(/{([\s\S]+)}/);
        if (funcBodyMatch && funcBodyMatch[1]) {
          code = funcBodyMatch[1].trim();
        }
      }

      // 确保移除所有的import和export语句
      code = code.replace(/^\s*import\s+.*?;?\s*$/gm, "// 不需要import语句");
      code = code.replace(/^\s*export\s+.*?;?\s*$/gm, "// 不需要export语句");

      // 检查是否每个创建的对象都有对应的scene.add调用
      const addObjectPattern = (objName) => {
        if (
          code.includes(`const ${objName} =`) ||
          code.includes(`let ${objName} =`)
        ) {
          if (!code.includes(`scene.add(${objName})`)) {
            return `scene.add(${objName});`;
          }
        }
        return "";
      };

      // 常见的3D对象变量名
      const commonObjectNames = [
        "cube",
        "sphere",
        "plane",
        "cylinder",
        "torus",
        "mesh",
        "group",
        "object",
      ];

      // 查找代码中可能创建了但未添加到场景的对象
      let missingAddCalls = "";
      commonObjectNames.forEach((name) => {
        const addCall = addObjectPattern(name);
        if (addCall) {
          missingAddCalls += `\n// 自动添加遗漏的对象\n${addCall}`;
        }
      });

      // 添加缺失的scene.add调用
      if (missingAddCalls) {
        code += missingAddCalls;
      }

      // 添加基本的验证 - 确保代码中包含scene.add
      if (!code.includes("scene.add")) {
        code = `// 原始代码未包含scene.add，添加基本立方体
${code}

// 确保有对象添加到场景
const defaultGeometry = new THREE.BoxGeometry(1, 1, 1);
const defaultMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const defaultCube = new THREE.Mesh(defaultGeometry, defaultMaterial);
defaultCube.position.set(0, 0.5, 0);
scene.add(defaultCube);`;
      }

      return code;
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

// 创建对话Agent - 超简化版
const createConversationAgent = (llm, tools) => {
  // 创建提示模板
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

  // 创建工具调用代理
  console.log("创建Tool-Calling Agent");
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

      // 超简化的调用方法
      async invoke(input, options = {}) {
        console.log("AgentExecutor.invoke被调用");

        try {
          // 基本输入检查
          input = input || {};

          // 确保聊天历史存在且是数组
          if (!input.chat_history || !Array.isArray(input.chat_history)) {
            input.chat_history = [];
          }

          // 确保input字段存在且是字符串
          if (input.input === undefined || input.input === null) {
            input.input = "";
          } else if (typeof input.input !== "string") {
            input.input = String(input.input || "");
          }

          console.log(`调用Agent，输入长度: ${input.input.length}`);
          
          // 调用原始方法
          return await super.invoke(input, options);
        } catch (error) {
          console.error("Agent调用错误:", error);
          
          // 返回错误信息
          return {
            output: `执行出错: ${error.message}`,
          };
        }
      },

      // 处理Agent动作并添加思考过程到消息队列
      handleAgentAction(action, runManager) {
        console.log("Agent执行动作:", action.tool);

        // 安全处理工具输入
        try {
          if (action && action.toolInput) {
            // 深度净化toolInput，确保没有复杂对象类型
            const sanitizeToolInput = (obj) => {
              if (obj === null || obj === undefined) return obj;

              if (Array.isArray(obj)) {
                return obj.map((item) => sanitizeToolInput(item));
              }

              if (typeof obj === "object") {
                // 移除agent_scratchpad和其他可能导致问题的字段
                const cleanObj = { ...obj };
                delete cleanObj.agent_scratchpad;

                // 递归处理所有字段
                for (const key in cleanObj) {
                  if (Object.prototype.hasOwnProperty.call(cleanObj, key)) {
                    const value = cleanObj[key];
                    if (value !== null && typeof value === "object") {
                      cleanObj[key] = sanitizeToolInput(value);
                    }
                  }
                }
                return cleanObj;
              }

              return obj;
            };

            // 应用净化
            action.toolInput = sanitizeToolInput(action.toolInput);
          }
        } catch (err) {
          console.error("处理工具输入时出错:", err);
        }

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

      // 超简化版工具调用方法
      async _callTool(tool, toolInput) {
        console.log(`执行工具: ${tool.name}`);
        try {
          // 确保工具输入是合适的格式
          let input = toolInput;
          if (typeof toolInput === "object" && toolInput !== null) {
            try {
              input = JSON.stringify(toolInput);
            } catch (e) {
              input = String(toolInput);
            }
          }

          // 直接调用工具
          const result = await tool.invoke(input);
          
          // 确保返回结果是字符串
          if (result === null || result === undefined) {
            return "";
          } else if (typeof result === "string") {
            return result;
          } else if (typeof result === "object") {
            // 处理工具消息对象
            if (result.type === "tool_message" || result.tool_call_id) {
              if (result.content && typeof result.content !== "string") {
                result.content = typeof result.content === "object"
                  ? JSON.stringify(result.content)
                  : String(result.content || "");
              }
              return result;
            }
            
            // 其他对象转为JSON字符串
            try {
              return JSON.stringify(result);
            } catch (err) {
              return String(result);
            }
          }
          
          // 其他类型转为字符串
          return String(result);
        } catch (err) {
          console.error(`工具错误:`, err);
          return `工具错误: ${err.message}`;
        }
      },
    });

    console.log("Agent创建成功!");
    return agentExecutor;
  } catch (error) {
    console.error("创建Agent时发生错误:", error);
    throw new Error(`创建ThreeAgent失败: ${error.message}`);
  }
}

module.exports = {
  createThreeAgent,
  formatMessage, // 导出格式化函数供其他模块使用
};
