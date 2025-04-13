/**
 * debugThreeAgent.js
 * 
 * 带消息调试功能的ThreeJS Agent
 * 兼容LangChain.js 0.3版本
 */

const { AgentExecutor } = require("langchain/agents");
const { ChatPromptTemplate, MessagesPlaceholder } = require("@langchain/core/prompts");
// 修复导入路径，适配LangChain.js 0.3版本
const { createToolCallingAgent } = require("langchain/agents");
const { AzureChatOpenAI } = require("@langchain/openai");
const { MessageValidatorHandler } = require("./messageDebugger");
const { formatTools, createToolFormatterLLM } = require("./toolFormatter");
const { createThreeJSTools } = require("./threeJSTools");

/**
 * 处理agent_scratchpad字段，确保其是字符串格式
 * @param {*} input 输入对象
 * @returns 处理后的输入对象
 */
function sanitizeAgentScratchpad(input) {
  if (!input) return input;
  
  // 如果输入不是对象，返回原样
  if (typeof input !== 'object') return input;
  
  // 创建副本以避免修改原始对象
  const result = { ...input };
  
  // 处理agent_scratchpad字段
  if (result.agent_scratchpad !== undefined) {
    console.log('检测到agent_scratchpad字段，进行特殊处理');
    
    // 如果是对象，转换为字符串
    if (typeof result.agent_scratchpad === 'object') {
      try {
        result.agent_scratchpad = JSON.stringify(result.agent_scratchpad);
      } catch (e) {
        console.error('序列化agent_scratchpad失败:', e.message);
        result.agent_scratchpad = String(result.agent_scratchpad || '');
      }
    }
  }
  
  // 递归检查其他字段中的agent_scratchpad
  Object.keys(result).forEach(key => {
    if (typeof result[key] === 'object' && result[key] !== null) {
      if (key !== 'agent_scratchpad') { // 避免重复处理
        result[key] = sanitizeAgentScratchpad(result[key]);
      }
    }
  });
  
  return result;
}

/**
 * 创建基本工具集
 * @param {string} sessionId 会话ID
 * @returns {Array} 工具数组
 */
const createBasicTools = (sessionId) => {
  console.log(`创建基本工具集，会话ID: ${sessionId}`);
  
  // 使用新的ThreeJS工具集
  const threeJSTools = createThreeJSTools(sessionId);
  
  // 添加其他工具
  const additionalTools = [
    {
      name: "code_validator",
      description: "验证Three.js代码的正确性和兼容性",
      type: "function", // 确保有type字段
      schema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "要验证的Three.js代码",
          },
        },
        required: ["code"],
      },
      function: {
        name: "code_validator",
        description: "验证Three.js代码的正确性和兼容性",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "要验证的Three.js代码",
            },
          },
          required: ["code"],
        }
      },
      invoke: async (input) => {
        console.log("调用code_validator工具");
        try {
          const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
          
          // 检查代码是否包含Three.js相关内容
          const code = parsedInput.code || "";
          const hasThreeJS = code.includes("THREE") || 
                          code.includes("scene.add") || 
                          code.includes("new Mesh") ||
                          code.includes("WebGLRenderer");
          
          if (!hasThreeJS) {
            return {
              success: false,
              message: "代码中未检测到Three.js相关内容"
            };
          }
          
          return {
            success: true,
            message: "代码验证通过，可以执行"
          };
        } catch (error) {
          return {
            success: false,
            error: `验证代码时出错: ${error.message}`
          };
        }
      },
    }
  ];
  
  // 合并工具集
  return [...threeJSTools, ...additionalTools];
};

/**
 * 创建对话Agent
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

你可以:
1. 根据用户描述生成Three.js代码
2. 验证代码是否符合Three.js标准
3. 执行代码并显示在前端界面


重要提示：你的所有回复内容必须是字符串或对象数组格式。不要返回单个对象作为内容，这会导致API错误。如果需要返回对象，请将其转换为字符串或包裹在数组中。`,
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  // 创建工具调用代理
  console.log("创建带调试功能的Tool-Calling Agent");
  
  // 添加agent_scratchpad处理回调
  const agentCallbacks = {
    handleAgentAction: async (action, runId, parentRunId) => {
      console.log(`处理Agent动作: ${action.tool}`);
      return { action };
    },
    handleToolStart: async (tool, input, runId, parentRunId) => {
      console.log(`工具开始执行: ${tool.name}`);
      return { tool, input };
    },
    handleToolEnd: async (output, runId, parentRunId) => {
      console.log(`工具执行完成`);
      // 确保输出是字符串
      if (typeof output !== 'string') {
        try {
          output = JSON.stringify(output);
        } catch (e) {
          output = String(output || '');
        }
      }
      return { output };
    },
    handleAgentComplete: async (action, runId, parentRunId) => {
      console.log(`Agent执行完成`);
      // 确保输出是字符串
      if (action && action.returnValues && action.returnValues.output && typeof action.returnValues.output !== 'string') {
        try {
          action.returnValues.output = JSON.stringify(action.returnValues.output);
        } catch (e) {
          action.returnValues.output = String(action.returnValues.output || '');
        }
      }
      return { action };
    }
  };
  
  return createToolCallingAgent({
    llm,
    tools,
    prompt,
    callbacks: [agentCallbacks]
  });
};

/**
 * 创建带调试功能的Three.js Agent
 * @param {Object} config 配置对象
 * @param {string} sessionId 会话ID
 * @param {Function} addMessageToQueue 消息队列函数
 * @returns {AgentExecutor} Agent执行器
 */
async function createDebugThreeAgent(config = {}, sessionId = "default", addMessageToQueue = null) {
  try {
    console.log(`创建带调试功能的ThreeJS Agent，会话ID: ${sessionId}`);
    
    // 创建消息验证器
    console.log("创建消息验证器...");
    const messageValidator = new MessageValidatorHandler({
      logLevel: 'info',
      strictMode: true,
      emergencyRecovery: true
    });
    
    // 初始化Azure OpenAI LLM
    console.log("初始化Azure OpenAI LLM...");
    const azureOpenAI = new AzureChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      azureOpenAIApiKey: config.azureOpenAIApiKey || process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiDeploymentName: config.azureOpenAIApiDeploymentName || process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      azureOpenAIApiVersion: config.azureOpenAIApiVersion || process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview",
      azureOpenAIApiEndpoint: config.azureOpenAIApiEndpoint || process.env.AZURE_OPENAI_ENDPOINT,
      callbacks: [messageValidator.createCallbackHandler()]
    });
    
    // 使用消息验证器包裹LLM实例
    console.log("使用消息验证器包裹LLM实例...");
    const validatedLLM = messageValidator.wrapLLM(azureOpenAI);
    
    // 添加工具格式化功能
    console.log("添加工具格式化功能...");
    const llm = createToolFormatterLLM(validatedLLM);

    // 创建工具集
    console.log("创建Agent工具集...");
    const rawTools = createBasicTools(sessionId);
    
    // 格式化工具集
    console.log("预格式化工具集...");
    const tools = formatTools(rawTools);

    // 创建Agent
    console.log("创建对话Agent...");
    const agent = createConversationAgent(llm, tools);

    // 创建执行器
    console.log("创建Agent执行器...");
    const agentExecutor = new AgentExecutor({
      agent,
      tools,
      verbose: true,
      tags: ["threejs-debug-agent", "conversation"],

      // 超简化的调用方法
      async invoke(input, options = {}) {
        console.log("DebugAgentExecutor.invoke被调用");

        try {
          // 基本输入检查
          input = input || {};

          // 确保聊天历史存在且是数组
          if (!input.chat_history || !Array.isArray(input.chat_history)) {
            input.chat_history = [];
          } else {
            // 深度检查聊天历史格式
            input.chat_history = input.chat_history.map(msg => {
              // 确保消息是对象
              if (!msg || typeof msg !== 'object') {
                return { role: 'user', content: String(msg || '') };
              }
              
              // 确保消息有role字段
              const role = msg.role && typeof msg.role === 'string' ? msg.role : 'user';
              
              // 确保消息有content字段且是字符串
              let content = '';
              if (msg.content !== undefined && msg.content !== null) {
                if (typeof msg.content === 'string') {
                  content = msg.content;
                } else if (Array.isArray(msg.content) && 
                           msg.content.every(item => 
                             item && typeof item === 'object' && 
                             (item.type === 'text' || item.type === 'image_url'))) {
                  // 合法的OpenAI内容数组格式
                  content = msg.content;
                } else if (typeof msg.content === 'object') {
                  try {
                    content = JSON.stringify(msg.content);
                  } catch (e) {
                    content = String(msg.content || '');
                  }
                } else {
                  content = String(msg.content || '');
                }
              }
              
              return { role, content };
            });
            input.chat_history = deepInspectMessages(input.chat_history);
          }

          // 确保input字段存在且是字符串
          if (input.input === undefined || input.input === null) {
            input.input = "";
          } else if (typeof input.input !== "string") {
            input.input = String(input.input || "");
          }

          console.log(`调用Debug Agent，输入长度: ${input.input.length}`);
          
          // 处理agent_scratchpad字段
          input = sanitizeAgentScratchpad(input);
          console.log('完成agent_scratchpad字段处理');
          
          // 调用原始方法
          return await super.invoke(input, options);
        } catch (error) {
          console.error("Debug Agent调用错误:", error);
          
          // 返回错误信息
          return {
            output: `执行出错: ${error.message}`,
          };
        }
      },

      // 超简化的工具调用方法
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

    console.log("Debug Agent创建成功!");
    return agentExecutor;
  } catch (error) {
    console.error("创建Debug Agent时发生错误:", error);
    throw new Error(`创建Debug ThreeAgent失败: ${error.message}`);
  }
}

module.exports = {
  createDebugThreeAgent,
};
