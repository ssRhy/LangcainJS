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
const { createDebugAzureLLM, deepInspectMessages } = require("./messageDebugger");
const { formatTools, createToolFormatterLLM } = require("./toolFormatter");

/**
 * 创建基本工具集
 * @param {string} sessionId 会话ID
 * @returns {Array} 工具数组
 */
const createBasicTools = (sessionId) => {
  console.log(`创建基本工具集，会话ID: ${sessionId}`);
  
  return [
    {
      name: "generate_threejs_code",
      description: "生成Three.js代码，根据用户的描述创建3D场景",
      schema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "完整的Three.js代码，包括HTML、CSS和JavaScript",
          },
          description: {
            type: "string",
            description: "对生成代码的简要描述",
          },
        },
        required: ["code", "description"],
      },
      invoke: async (input) => {
        console.log("调用generate_threejs_code工具");
        try {
          const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
          return `代码已生成: ${parsedInput.description || "Three.js场景"}`;
        } catch (error) {
          return `生成代码时出错: ${error.message}`;
        }
      },
    },
    {
      name: "code_validator",
      description: "验证Three.js代码的正确性和兼容性",
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
      invoke: async (input) => {
        console.log("调用code_validator工具");
        try {
          const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
          return "代码验证通过，没有发现语法错误";
        } catch (error) {
          return `验证代码时出错: ${error.message}`;
        }
      },
    },
    {
      name: "execute_threejs_code",
      description: "执行Three.js代码并在前端显示结果",
      schema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "要执行的Three.js代码",
          },
        },
        required: ["code"],
      },
      invoke: async (input) => {
        console.log("调用execute_threejs_code工具");
        try {
          const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
          return "代码已执行，场景已在前端显示";
        } catch (error) {
          return `执行代码时出错: ${error.message}`;
        }
      },
    },
  ];
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
4. 捕获场景截图
5. 分析场景结构和性能`,
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  // 创建工具调用代理
  console.log("创建带调试功能的Tool-Calling Agent");
  return createToolCallingAgent({
    llm,
    tools,
    prompt,
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
    
    // 初始化LLM
    console.log("初始化带调试功能的Azure OpenAI LLM...");
    const baseLLM = createDebugAzureLLM(config);
    
    // 添加工具格式化功能
    console.log("添加工具格式化功能...");
    const llm = createToolFormatterLLM(baseLLM);

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
            input.chat_history = deepInspectMessages(input.chat_history);
          }

          // 确保input字段存在且是字符串
          if (input.input === undefined || input.input === null) {
            input.input = "";
          } else if (typeof input.input !== "string") {
            input.input = String(input.input || "");
          }

          console.log(`调用Debug Agent，输入长度: ${input.input.length}`);
          
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
