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
          // 其他对象类型必须转为字符串
          try {
            // 尝试序列化对象
            const jsonString = JSON.stringify(msg.content);
            console.log(`🔄 消息[${idx}]的content已转换为JSON字符串`);
            msg.content = jsonString;
          } catch (err) {
            console.error(`❌ 序列化消息[${idx}]的content失败:`, err);
            // 如果序列化失败，尝试使用String()转换
            try {
              msg.content = String(msg.content || "");
            } catch (e) {
              // 如果还是失败，使用空字符串
              msg.content = "";
            }
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
      try {
        fixed[i].content = JSON.stringify(msg.content);
      } catch (err) {
        console.error(`❌ 序列化消息[${i}]的content失败，使用空字符串`);
        fixed[i].content = "";
      }
    }
    
    // 再次检查确保所有content都是字符串或有效的数组
    if (typeof fixed[i].content !== "string" && !Array.isArray(fixed[i].content)) {
      console.error(`❌ 紧急修复: 消息[${i}]的content类型仍然无效，强制设置为空字符串`);
      fixed[i].content = "";
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
            
            // 创建新的消息数组，对所有消息进行更严格的格式化
            const emergencyFixed = messages.map((msg, idx) => {
              // 确保有效的role
              const role = msg && msg.role && typeof msg.role === "string" ? msg.role : "user";
              
              // 强制将content转换为字符串
              let content = "";
              if (msg && msg.content !== undefined && msg.content !== null) {
                if (typeof msg.content === "string") {
                  content = msg.content;
                } else if (Array.isArray(msg.content) && 
                           msg.content.every(item => item && typeof item === "object" && 
                                            (item.type === "text" || item.type === "image_url"))) {
                  // 保留有效的内容数组
                  content = msg.content;
                } else {
                  try {
                    content = JSON.stringify(msg.content);
                  } catch (e) {
                    content = "";
                  }
                }
              }
              
              // 返回干净的消息对象，只包含必要的字段
              return { role, content };
            });
            
            // 再次尝试调用
            console.log("🔄 使用紧急修复后的消息重试");
            try {
              return await originalInvoke(emergencyFixed, options);
            } catch (retryError) {
              console.error("❌ 紧急修复后仍然失败，尝试最后的备用方案");
              
              // 最后的备用方案：创建一个全新的最简单消息
              const fallbackMessage = [
                { role: "user", content: "I need help with Three.js code generation." }
              ];
              
              return await originalInvoke(fallbackMessage, options);
            }
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

/**
 * MessageValidatorHandler - 专门用于验证和消毒消息的处理器
 * 提供多层验证和处理机制，确保消息格式符合OpenAI API要求
 */
class MessageValidatorHandler {
  constructor(options = {}) {
    this.options = {
      logLevel: options.logLevel || 'info',
      strictMode: options.strictMode !== undefined ? options.strictMode : true,
      emergencyRecovery: options.emergencyRecovery !== undefined ? options.emergencyRecovery : true,
      ...options
    };
    
    this.log(`创建消息验证处理器，配置: ${JSON.stringify(this.options)}`);
  }
  
  /**
   * 日志输出函数
   */
  log(message, level = 'info') {
    const levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    
    if (levels[level] <= levels[this.options.logLevel]) {
      const prefix = {
        error: '❌',
        warn: '⚠️',
        info: '💬',
        debug: '🔍'
      }[level];
      
      console[level](`${prefix} [MessageValidator] ${message}`);
    }
  }
  
  /**
   * 验证单个消息
   * @param {Object} message 需要验证的消息
   * @returns {Object} 验证后的消息
   */
  validateMessage(message) {
    this.log(`验证单个消息: ${typeof message}`, 'debug');
    
    try {
      // 如果消息不是对象，转换为标准格式
      if (!message || typeof message !== 'object') {
        this.log(`消息不是对象，转换为标准格式`, 'warn');
        return { role: 'user', content: String(message || '') };
      }
      
      // 特殊处理agent_scratchpad字段，这通常是出错的源头
      if (message.agent_scratchpad) {
        this.log(`检测到agent_scratchpad字段，特殊处理`, 'warn');
        
        // 如果是对象，尝试转换为字符串
        if (typeof message.agent_scratchpad === 'object') {
          try {
            message.agent_scratchpad = JSON.stringify(message.agent_scratchpad);
          } catch (e) {
            message.agent_scratchpad = String(message.agent_scratchpad || '');
          }
        }
      }
      
      // 确保有效的role
      const role = message.role && typeof message.role === 'string' ? message.role : 'user';
      
      // 处理content字段
      let content = '';
      
      if (message.content === undefined || message.content === null) {
        this.log(`消息content为空，设置为空字符串`, 'warn');
        content = '';
      } else if (typeof message.content === 'string') {
        // 字符串类型直接使用
        content = message.content;
      } else if (Array.isArray(message.content)) {
        // 检查是否是合法的OpenAI内容数组
        if (message.content.every(item => 
          item && typeof item === 'object' && 
          (item.type === 'text' || item.type === 'image_url'))) {
          this.log(`检测到有效的OpenAI内容数组`, 'debug');
          content = message.content;
        } else {
          // 如果不是有效的内容数组，转换为字符串
          this.log(`消息content是无效数组，转换为字符串`, 'warn');
          try {
            content = JSON.stringify(message.content);
          } catch (err) {
            this.log(`序列化消息content失败: ${err.message}`, 'error');
            content = String(message.content || '');
          }
        }
      } else if (typeof message.content === 'object') {
        // 对象类型需要转换
        this.log(`消息content是对象类型，转换为字符串`, 'warn');
        try {
          content = JSON.stringify(message.content);
        } catch (err) {
          this.log(`序列化消息content失败: ${err.message}`, 'error');
          content = String(message.content || '');
        }
      } else {
        // 其他类型转换为字符串
        this.log(`消息content是其他类型，转换为字符串`, 'warn');
        content = String(message.content || '');
      }
      
      // 创建干净的消息对象
      const sanitized = { role, content };
      
      // 添加其他必要字段
      if (message.name && typeof message.name === 'string') {
        sanitized.name = message.name;
      }
      
      // 处理function_call字段
      if (message.function_call && typeof message.function_call === 'object') {
        const function_call = {};
        
        if (message.function_call.name && typeof message.function_call.name === 'string') {
          function_call.name = message.function_call.name;
        } else if (message.function_call.name) {
          function_call.name = String(message.function_call.name);
        }
        
        if (message.function_call.arguments) {
          if (typeof message.function_call.arguments === 'string') {
            function_call.arguments = message.function_call.arguments;
          } else {
            try {
              function_call.arguments = JSON.stringify(message.function_call.arguments);
            } catch (e) {
              function_call.arguments = '{}';
            }
          }
        }
        
        sanitized.function_call = function_call;
      }
      
      // 处理tool_calls字段
      if (message.tool_calls && Array.isArray(message.tool_calls)) {
        sanitized.tool_calls = message.tool_calls.map(tool => {
          const sanitizedTool = {};
          
          if (tool.id) sanitizedTool.id = String(tool.id);
          
          if (tool.function && typeof tool.function === 'object') {
            sanitizedTool.function = {};
            
            if (tool.function.name) {
              sanitizedTool.function.name = String(tool.function.name);
            }
            
            if (tool.function.arguments) {
              if (typeof tool.function.arguments === 'string') {
                sanitizedTool.function.arguments = tool.function.arguments;
              } else {
                try {
                  sanitizedTool.function.arguments = JSON.stringify(tool.function.arguments);
                } catch (e) {
                  sanitizedTool.function.arguments = '{}';
                }
              }
            }
          }
          
          return sanitizedTool;
        });
      }
      
      return sanitized;
    } catch (error) {
      this.log(`验证消息时出错: ${error.message}`, 'error');
      return { role: 'user', content: '' };
    }
  }
  
  /**
   * 验证消息数组
   * @param {Array} messages 需要验证的消息数组
   * @returns {Array} 验证后的消息数组
   */
  validateMessages(messages) {
    this.log(`验证消息数组: ${typeof messages}`, 'debug');
    
    try {
      // 处理非数组输入
      if (!Array.isArray(messages)) {
        this.log(`输入不是数组，转换为数组`, 'warn');
        if (messages && typeof messages === 'object') {
          return [this.validateMessage(messages)];
        }
        return [{ role: 'user', content: String(messages || '') }];
      }
      
      // 验证每个消息
      const sanitized = messages.map((msg, idx) => {
        try {
          const validatedMsg = this.validateMessage(msg);
          this.log(`消息[${idx}]验证成功: role=${validatedMsg.role}`, 'debug');
          return validatedMsg;
        } catch (err) {
          this.log(`消息[${idx}]验证失败: ${err.message}`, 'error');
          return { role: 'user', content: '' };
        }
      });
      
      // 过滤掉无效消息
      const filtered = sanitized.filter(Boolean);
      
      // 确保至少有一条消息
      if (filtered.length === 0) {
        this.log(`消息数组为空，添加默认消息`, 'warn');
        filtered.push({ role: 'user', content: 'Please help me with Three.js code generation.' });
      }
      
      // 最终检查
      for (let i = 0; i < filtered.length; i++) {
        const msg = filtered[i];
        
        // 特殊处理可能包含 agent_scratchpad 的消息
        if (msg.content && typeof msg.content === 'object' && !Array.isArray(msg.content)) {
          // 如果 content 是对象且包含 agent_scratchpad
          if (msg.content.agent_scratchpad !== undefined) {
            this.log(`检测到content中的agent_scratchpad，进行特殊处理`, 'warn');
            
            // 将 agent_scratchpad 转换为字符串
            if (typeof msg.content.agent_scratchpad === 'object') {
              try {
                msg.content.agent_scratchpad = JSON.stringify(msg.content.agent_scratchpad);
              } catch (e) {
                msg.content.agent_scratchpad = String(msg.content.agent_scratchpad || '');
              }
            }
            
            // 将整个content转换为字符串
            try {
              filtered[i].content = JSON.stringify(msg.content);
            } catch (e) {
              filtered[i].content = String(msg.content || '');
            }
          }
        }
        
        // 确保 content 是字符串或合法的数组
        if (typeof msg.content !== 'string' && !Array.isArray(msg.content)) {
          this.log(`紧急修复: 消息[${i}]的content类型仍然无效，强制转换为字符串`, 'error');
          try {
            filtered[i].content = JSON.stringify(msg.content);
          } catch (e) {
            filtered[i].content = '';
          }
        }
      }
      
      return filtered;
    } catch (error) {
      this.log(`验证消息数组时出错: ${error.message}`, 'error');
      return [{ role: 'user', content: 'Please help me with Three.js code generation.' }];
    }
  }
  
  /**
   * 创建LLM回调处理器
   * @returns {Object} 回调处理器对象
   */
  createCallbackHandler() {
    return {
      handleLLMStart: async (llm, messages) => {
        this.log('拦截并验证LLM消息', 'info');
        const validatedMessages = this.validateMessages(messages);
        return { messages: validatedMessages };
      },
      
      handleLLMError: async (error, llm, messages) => {
        // 如果是消息格式错误，尝试紧急修复
        if (this.options.emergencyRecovery && 
            error.message && 
            error.message.includes('Invalid type for \'messages')) {
          this.log(`检测到消息格式错误，尝试紧急修复: ${error.message}`, 'error');
          
          // 提取错误消息索引
          const match = error.message.match(/messages\[(\d+)\]\.content/);
          if (match && match[1]) {
            const index = parseInt(match[1]);
            this.log(`尝试特别修复消息[${index}]`, 'info');
            
            // 创建新的消息数组，对所有消息进行更严格的格式化
            const emergencyFixed = messages.map((msg, idx) => {
              // 确保有效的role
              const role = msg && msg.role && typeof msg.role === 'string' ? msg.role : 'user';
              
              // 强制将content转换为字符串
              let content = '';
              if (msg && msg.content !== undefined && msg.content !== null) {
                if (typeof msg.content === 'string') {
                  content = msg.content;
                } else {
                  try {
                    content = JSON.stringify(msg.content);
                  } catch (e) {
                    content = '';
                  }
                }
              }
              
              // 返回干净的消息对象，只包含必要的字段
              return { role, content };
            });
            
            return { messages: emergencyFixed };
          }
        }
        
        // 如果不能修复，返回原始错误
        return { error };
      }
    };
  }
  
  /**
   * 包裹LLM实例，添加消息验证功能
   * @param {Object} llm LLM实例
   * @returns {Object} 包裹后的LLM实例
   */
  wrapLLM(llm) {
    if (!llm) {
      throw new Error('LLM实例不能为空');
    }
    
    this.log('包裹LLM实例，添加消息验证功能', 'info');
    
    // 包裹原始invoke方法
    const originalInvoke = llm.invoke.bind(llm);
    
    // 创建新的invoke方法
    llm.invoke = async (messages, options = {}) => {
      this.log('调用LLM.invoke，进行消息验证', 'info');
      
      try {
        // 验证消息格式
        const validatedMessages = this.validateMessages(messages);
        
        // 调用原始方法
        return await originalInvoke(validatedMessages, options);
      } catch (error) {
        // 如果是消息格式错误，尝试紧急修复
        if (this.options.emergencyRecovery && 
            error.message && 
            error.message.includes('Invalid type for \'messages')) {
          this.log(`消息格式错误，尝试紧急修复: ${error.message}`, 'error');
          
          // 提取错误消息索引
          const match = error.message.match(/messages\[(\d+)\]\.content/);
          if (match && match[1]) {
            const index = parseInt(match[1]);
            this.log(`尝试特别修复消息[${index}]`, 'info');
            
            // 创建新的消息数组，对所有消息进行更严格的格式化
            const emergencyFixed = messages.map((msg) => {
              // 确保有效的role
              const role = msg && msg.role && typeof msg.role === 'string' ? msg.role : 'user';
              
              // 强制将content转换为字符串
              let content = '';
              if (msg && msg.content !== undefined && msg.content !== null) {
                if (typeof msg.content === 'string') {
                  content = msg.content;
                } else {
                  try {
                    content = JSON.stringify(msg.content);
                  } catch (e) {
                    content = '';
                  }
                }
              }
              
              // 返回干净的消息对象，只包含必要的字段
              return { role, content };
            });
            
            // 再次尝试调用
            this.log('使用紧急修复后的消息重试', 'info');
            try {
              return await originalInvoke(emergencyFixed, options);
            } catch (retryError) {
              this.log(`紧急修复后仍然失败，尝试最后的备用方案: ${retryError.message}`, 'error');
              
              // 最后的备用方案：创建一个全新的最简单消息
              const fallbackMessage = [
                { role: 'user', content: 'I need help with Three.js code generation.' }
              ];
              
              return await originalInvoke(fallbackMessage, options);
            }
          }
        }
        
        // 其他错误直接抛出
        throw error;
      }
    };
    
    return llm;
  }
}

module.exports = {
  createDebugAzureLLM,
  deepInspectMessages,
  formatSingleMessage,
  MessageValidatorHandler
};
