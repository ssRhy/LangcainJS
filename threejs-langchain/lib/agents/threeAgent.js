/**
 * threeAgent.js
 * 
 * 提供Three.js代理功能，使用MessageValidatorHandler进行消息验证
 * 兼容LangChain.js 0.3版本
 */

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

// 导入消息验证处理器和工具格式化模块
const { MessageValidatorHandler } = require("./messageDebugger");
const { formatTools, createToolFormatterLLM } = require("./toolFormatter");
const { createThreeJSTools } = require("./threeJSTools");

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

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

// 创建全局消息验证处理器实例
const messageValidator = new MessageValidatorHandler({
  logLevel: 'info',
  strictMode: true,
  emergencyRecovery: true
});

/**
 * 统一的消息格式化函数，使用MessageValidatorHandler
 * @param {*} msg 需要格式化的消息
 * @returns {Object} 格式化后的消息
 */
function formatMessage(msg) {
  try {
    // 使用MessageValidatorHandler处理消息
    return messageValidator.validateMessage(msg);
  } catch (error) {
    console.error("消息格式化错误:", error);
    return { role: "user", content: "消息格式化错误" };
  }
}

/**
 * 统一的消息数组净化函数，使用MessageValidatorHandler
 * @param {Array} messages 消息数组
 * @returns {Array} 净化后的消息数组
 */
function sanitizeMessagesForAPI(messages) {
  return messageValidator.validateMessages(messages);
}

/**
 * 使用全局messageValidator创建AzureLLM
 * @param {Object} config 配置对象
 * @returns {Object} LLM实例
 */
const createAzureLLM = (config = {}) => {
  try {
    console.log("创建Azure OpenAI模型，使用全局MessageValidatorHandler...");
    
    // 获取消息验证器的回调处理器
    const validatorCallbacks = messageValidator.createCallbackHandler();
    
    // 创建原始模型，并添加验证器回调
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
      callbacks: [validatorCallbacks]
    });
    
    // 使用消息验证器包装LLM实例
    const wrappedLLM = messageValidator.wrapLLM(azureOpenAI);
    
    // 添加工具格式化功能
    const formattedLLM = createToolFormatterLLM(wrappedLLM);
    
    console.log('✅ 返回带完整消息验证和工具格式化功能的LLM实例');
    return formattedLLM;
  } catch (error) {
    console.warn("❌ 创建Azure OpenAI模型失败:", error.message);
    throw error;
  }
};

/**
 * 工具定义层 - 使用threeJSTools.js中的工具
 * @param {string} sessionId 会话ID
 * @returns {Array} 工具数组
 */
const createBasicTools = (sessionId) => {
  console.log(`创建基本工具集，会话ID: ${sessionId}`);
  
  // 使用threeJSTools.js中的工具
  const threeJSTools = createThreeJSTools(sessionId);
  
  // 添加其他工具
  const additionalTools = [
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
      name: "capture_screenshot",
      description: "捕捉Three.js场景截图",
      schema: z.object({
        quality: z.number().default(0.8).describe("图像质量 0-1"),
        view: z
          .string()
          .default("current")
          .describe("视角: current, front, top, side"),
      }),
      func: async ({ quality, view }) => {
        console.log("请求捕捉截图", { quality, view });

        // 通知前端捕捉截图
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
        detail: z.string().default("basic").describe("分析详细程度: basic, detailed"),
        focus: z.string().optional().describe("关注的特定对象或属性"),
      }),
      func: async ({ detail, focus }) => {
        console.log("请求分析场景", { detail, focus });

        // 通知前端分析场景
        if (typeof addMessageToQueue === "function") {
          addMessageToQueue({
            type: "scene_analysis",
            detail,
            focus,
            requestId: sessionId + "-analysis",
          });
        }

        return {
          status: "success",
          message: "场景分析请求已发送",
        };
      },
    }),
  ];
  
  // 将threeJSTools转换为DynamicStructuredTool格式
  const convertedThreeJSTools = threeJSTools.map(tool => {
    // 如果已经是DynamicStructuredTool实例，直接返回
    if (tool instanceof DynamicStructuredTool) {
      return tool;
    }
    
    // 否则创建新的DynamicStructuredTool
    return new DynamicStructuredTool({
      name: tool.name,
      description: tool.description,
      schema: z.object({
        code: z.string().describe("需要执行的Three.js代码"),
        ...(tool.name === "generate_threejs_code" ? {
          description: z.string().describe("代码描述")
        } : {}),
        ...(tool.name === "execute_threejs_code" ? {
          mode: z.enum(["replace", "append"]).optional().describe("执行模式")
        } : {})
      }),
      func: async (params) => {
        console.log(`调用${tool.name}工具`);
        return await tool.invoke(params);
      }
    });
  });
  
  // 合并工具集
  return [...convertedThreeJSTools, ...additionalTools];
};

/**
 * 创建对话Agent - 超简化版
 * @param {Object} llm LLM实例
 * @param {Array} tools 工具数组
 * @returns {Object} Agent实例
 */
const createConversationAgent = (llm, tools) => {
  // 创建提示模板
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个专业的Three.js助手，可以理解用户的需求并生成相应的3D场景代码。如果用户询问如何创建特定的3D对象或场景，
请使用generate_threejs_code工具来生成完整的代码。你也可以使用code_validator工具检查代码的有效性，或者使用
execute_threejs_code工具执行代码。如果用户只是闲聊，你可以直接回答不使用工具。

生成Three.js代码时，请遵循以下规则：
1. 不要创建场景(scene)、相机(camera)或渲染器(renderer)，直接使用已存在的变量
2. 不要包含任何渲染循环代码(requestAnimationFrame或animate函数)
3. 不使用import/export语句
4. 直接使用scene.add()将对象添加到场景中，确保添加创建的所有对象
5. 不要使用document.querySelector或任何DOM操作
6. 代码必须添加至少一个3D对象到场景中
7. 不要在注释或代码中包含任何Markdown格式
8. 代码必须是纯JavaScript，没有任何包装
9. 不要创建任何函数，直接使用线性代码
10. 确保每个创建的3D对象都使用scene.add()添加到场景中
11. 避免使用类定义或模块语法`,
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  // 创建工具调用代理
  const agent = createToolCallingAgent({
    llm,
    prompt,
    tools,
  });

  return agent;
};

/**
 * 创建Three.js Agent - 主函数
 * @param {Object} config 配置对象
 * @returns {AgentExecutor} Agent执行器
 */
const createThreeAgent = (config = {}) => {
  try {
    console.log("创建Three.js Agent...");

    // 会话ID
    const sessionId = config.sessionId || "default";

    // 创建LLM
    const llm = createAzureLLM(config);

    // 创建工具
    const tools = createBasicTools(sessionId);

    // 创建代理
    const agent = createConversationAgent(llm, tools);

    // 创建内存
    const memory = new BufferMemory({
      returnMessages: true,
      memoryKey: "chat_history",
      inputKey: "input",
    });

    // 创建执行器
    const executor = new AgentExecutor({
      agent,
      tools,
      memory,
      returnIntermediateSteps: true,
      maxIterations: 5,
    });

    console.log("Three.js Agent创建成功");
    return executor;
  } catch (error) {
    console.error("创建Three.js Agent失败:", error);
    throw error;
  }
};

module.exports = {
  createThreeAgent,
  formatMessage, // 导出格式化函数供其他模块使用
  messageValidator // 导出消息验证器实例供其他模块使用
};
