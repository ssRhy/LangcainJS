/**
 * toolFormatter.js
 * 
 * 工具格式化模块，确保所有工具符合OpenAI API要求
 * 兼容LangChain.js 0.3版本
 */

/**
 * 格式化工具，确保所有工具都有必要的字段
 * @param {Array} tools 工具数组
 * @returns {Array} 格式化后的工具数组
 */
function formatTools(tools) {
  console.log("🔧 格式化工具集...");
  
  if (!Array.isArray(tools)) {
    console.warn("⚠️ 工具不是数组，返回空数组");
    return [];
  }
  
  return tools.map((tool, index) => {
    if (!tool) {
      console.warn(`⚠️ 工具[${index}]为空，跳过`);
      return null;
    }
    
    // 确保工具有name字段
    if (!tool.name) {
      console.warn(`⚠️ 工具[${index}]没有name字段，添加默认name`);
      tool.name = `tool_${index}`;
    }
    
    // 确保工具有description字段
    if (!tool.description) {
      console.warn(`⚠️ 工具[${index}]没有description字段，添加默认description`);
      tool.description = `Tool ${tool.name}`;
    }
    
    // 确保工具有type字段，默认为"function"
    if (!tool.type) {
      console.log(`ℹ️ 工具[${index}] "${tool.name}" 添加type="function"字段`);
      tool.type = "function";
    }
    
    // 处理函数调用参数
    if (tool.function_call) {
      if (typeof tool.function_call !== "object") {
        tool.function_call = {};
      }
      
      if (!tool.function_call.name) {
        tool.function_call.name = tool.name;
      }
      
      if (!tool.function_call.arguments && tool.schema) {
        try {
          tool.function_call.arguments = JSON.stringify(tool.schema);
        } catch (err) {
          tool.function_call.arguments = "{}";
        }
      }
    }
    
    // 处理schema
    if (tool.schema) {
      // 确保schema是对象
      if (typeof tool.schema !== "object") {
        try {
          tool.schema = JSON.parse(tool.schema);
        } catch (err) {
          tool.schema = {
            type: "object",
            properties: {},
            required: []
          };
        }
      }
      
      // 确保schema有type字段
      if (!tool.schema.type) {
        tool.schema.type = "object";
      }
      
      // 确保schema有properties字段
      if (!tool.schema.properties) {
        tool.schema.properties = {};
      }
    } else if (!tool.function) {
      // 如果没有schema和function，创建一个基本schema
      tool.schema = {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: `Input for ${tool.name}`
          }
        },
        required: ["input"]
      };
    }
    
    // 处理function字段
    if (!tool.function && tool.schema) {
      tool.function = {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema
      };
    }
    
    return tool;
  }).filter(Boolean); // 过滤掉null值
}

/**
 * 创建带工具格式化功能的LLM包装器
 * @param {Object} llm 原始LLM实例
 * @returns {Object} 带工具格式化功能的LLM实例
 */
function createToolFormatterLLM(llm) {
  if (!llm) {
    throw new Error("LLM实例不能为空");
  }
  
  console.log("🔄 创建带工具格式化功能的LLM包装器");
  
  // 包装原始invoke方法
  const originalInvoke = llm.invoke.bind(llm);
  
  // 创建新的invoke方法
  llm.invoke = async function(messages, options = {}) {
    // 如果有工具，确保它们格式正确
    if (options.tools && Array.isArray(options.tools)) {
      console.log(`🔍 检测到${options.tools.length}个工具，进行格式化`);
      options.tools = formatTools(options.tools);
      console.log(`✅ 工具格式化完成，现在有${options.tools.length}个有效工具`);
    }
    
    // 调用原始方法
    return await originalInvoke(messages, options);
  };
  
  return llm;
}

module.exports = {
  formatTools,
  createToolFormatterLLM
};
