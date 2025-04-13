/**
 * MessageDebugger.js - 消息格式调试工具
 * 
 * 用于检查和修复发送到OpenAI API的消息格式
 * 兼容LangChain.js 0.3版本
 */

const { ChatOpenAI } = require("@langchain/openai");
const { AzureChatOpenAI } = require("@langchain/openai");

/**
 * 深度检查消息格式并修复问题
 * @param {Array|Object} messages 需要检查的消息
 * @returns {Array} 修复后的消息数组
 */
function deepInspectMessages(messages) {
  console.log("🔍 深度检查消息格式...");
  
  // 如果不是数组，转换为数组
  if (!Array.isArray(messages)) {
    console.warn("⚠️ 消息不是数组，转换为数组");
    if (messages && typeof messages === "object") {
      return [formatSingleMessage(messages)];
    }
    return [{ role: "user", content: String(messages || "") }];
  }
  
  // 检查每个消息
  const fixed = messages.map((msg, idx) => {
    try {
      // 如果消息不是对象
      if (!msg || typeof msg !== "object") {
        console.warn(`⚠️ 消息[${idx}]不是对象，转换为标准格式`);
        return { role: "user", content: String(msg || "") };
      }
      
      // 检查role字段
      if (!msg.role || typeof msg.role !== "string") {
        console.warn(`⚠️ 消息[${idx}]缺少有效role，设置为"user"`);
        msg.role = "user";
      }
      
      // 处理content字段 - 最关键的部分
      if (msg.content === undefined || msg.content === null) {
        // 空content转为空字符串
        console.warn(`⚠️ 消息[${idx}]的content为空，设置为空字符串`);
        msg.content = "";
      } else if (typeof msg.content === "object") {
        // 对象类型content需要特殊处理
        console.warn(`⚠️ 消息[${idx}]的content是对象，需要转换`);
        
        // 检查是否是OpenAI格式的内容数组
        if (Array.isArray(msg.content) && msg.content.every(item => 
          item && typeof item === "object" && 
          (item.type === "text" || item.type === "image_url"))) {
          // 这是合法的OpenAI格式，保留数组格式
          console.log(`✅ 消息[${idx}]的content是有效的OpenAI内容数组`);
        } else {
          // 其他对象类型转为字符串
          try {
            msg.content = JSON.stringify(msg.content);
            console.log(`🔄 消息[${idx}]的content已转换为JSON字符串`);
          } catch (err) {
            console.error(`❌ 序列化消息[${idx}]的content失败:`, err);
            msg.content = String(msg.content || "");
          }
        }
      }
      
      // 检查其他字段
      if (msg.name && typeof msg.name !== "string") {
        msg.name = String(msg.name);
      }
      
      if (msg.function_call && typeof msg.function_call === "object") {
        if (typeof msg.function_call.name !== "string") {
          msg.function_call.name = String(msg.function_call.name || "");
        }
        
        if (typeof msg.function_call.arguments !== "string") {
          try {
            msg.function_call.arguments = JSON.stringify(msg.function_call.arguments);
          } catch (err) {
            msg.function_call.arguments = "{}";
          }
        }
      }
      
      // 检查tool_calls字段
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        msg.tool_calls = msg.tool_calls.map(tool => {
          if (typeof tool.id !== "string") {
            tool.id = String(tool.id || "");
          }
          
          if (tool.function && typeof tool.function === "object") {
            if (typeof tool.function.name !== "string") {
              tool.function.name = String(tool.function.name || "");
            }
            
            if (typeof tool.function.arguments !== "string") {
              try {
                tool.function.arguments = JSON.stringify(tool.function.arguments);
              } catch (err) {
                tool.function.arguments = "{}";
              }
            }
          }
          
          return tool;
        });
      }
      
      return msg;
    } catch (err) {
      console.error(`❌ 处理消息[${idx}]时出错:`, err);
      return { role: "user", content: "" };
    }
  });
  
  // 最终检查
  for (let i = 0; i < fixed.length; i++) {
    const msg = fixed[i];
    console.log(`📝 最终消息[${i}]: role=${msg.role}, contentType=${typeof msg.content}`);
    
    // 额外检查content是否为对象但不是数组
    if (typeof msg.content === "object" && !Array.isArray(msg.content)) {
      console.error(`❌ 警告: 消息[${i}]的content仍然是对象，强制转换为字符串`);
      fixed[i].content = JSON.stringify(msg.content);
    }
  }
  
  return fixed;
}

/**
 * 格式化单个消息
 * @param {Object} msg 单个消息对象
 * @returns {Object} 格式化后的消息对象
 */
function formatSingleMessage(msg) {
  if (!msg || typeof msg !== "object") {
    return { role: "user", content: String(msg || "") };
  }
  
  const role = msg.role || "user";
  let content = msg.content;
  
  if (content === undefined || content === null) {
    content = "";
  } else if (typeof content === "object") {
    // 检查是否是OpenAI格式的内容数组
    if (Array.isArray(content) && content.every(item => 
      item && typeof item === "object" && 
      (item.type === "text" || item.type === "image_url"))) {
      // 保留数组格式
    } else {
      try {
        content = JSON.stringify(content);
      } catch (err) {
        content = String(content || "");
      }
    }
  }
  
  return { role, content, ...msg };
}

/**
 * 创建带消息调试功能的Azure LLM
 * @param {Object} config 配置对象
 * @returns {AzureChatOpenAI} 带调试功能的LLM实例
 */
function createDebugAzureLLM(config = {}) {
  try {
    console.log("🚀 创建带调试功能的Azure OpenAI模型...");
    
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
      callbacks: [{
        handleLLMStart: async (llm, messages) => {
          console.log("🔍 MessageDebugger: 拦截并检查消息格式");
          // 深度检查并修复消息格式
          const fixedMessages = deepInspectMessages(messages);
          return { messages: fixedMessages };
        }
      }]
    });
    
    // 包装invoke方法以确保消息格式化
    const originalInvoke = azureOpenAI.invoke.bind(azureOpenAI);
    azureOpenAI.invoke = async function(messages, options = {}) {
      console.log("🔄 调用LLM.invoke，进行消息格式检查");
      
      try {
        // 深度检查并修复消息格式
        const fixedMessages = deepInspectMessages(messages);
        
        // 调用原始方法
        return await originalInvoke(fixedMessages, options);
      } catch (error) {
        // 如果是消息格式错误，尝试更严格的修复
        if (error.message && error.message.includes("Invalid type for 'messages")) {
          console.error("❌ 消息格式错误，尝试更严格的修复:", error.message);
          
          // 提取错误消息索引
          const match = error.message.match(/messages\[(\d+)\]\.content/);
          if (match && match[1]) {
            const index = parseInt(match[1]);
            console.log(`🔧 尝试修复消息[${index}]`);
            
            // 创建新的消息数组，确保问题消息被强制转换为字符串
            const emergencyFixed = deepInspectMessages(messages).map((msg, idx) => {
              if (idx === index && typeof msg.content === "object") {
                return { ...msg, content: JSON.stringify(msg.content) };
              }
              return msg;
            });
            
            // 再次尝试调用
            console.log("🔄 使用紧急修复后的消息重试");
            return await originalInvoke(emergencyFixed, options);
          }
        }
        
        // 其他错误直接抛出
        throw error;
      }
    };
    
    console.log('✅ 返回带消息调试功能的LLM实例');
    return azureOpenAI;
  } catch (error) {
    console.error("❌ 创建Azure OpenAI模型失败:", error.message);
    throw error;
  }
}

module.exports = {
  createDebugAzureLLM,
  deepInspectMessages,
  formatSingleMessage
};
