/**
 * threeJSTools.js
 * 
 * 提供Three.js代码生成和执行的工具
 */

/**
 * 创建Three.js代码生成和执行工具
 * @param {string} sessionId 会话ID
 * @returns {Array} 工具数组
 */
function createThreeJSTools(sessionId) {
  console.log(`创建Three.js工具集，会话ID: ${sessionId}`);
  
  return [
    {
      name: "generate_threejs_code",
      description: "生成Three.js代码，根据用户的描述创建3D场景",
      type: "function", // 确保有type字段
      schema: {
        type: "string",
        properties: {
          code: {
            type: "string",
            description: "完整的Three.js代码，可以是HTML格式或纯JavaScript",
          },
          description: {
            type: "string",
            description: "对生成代码的简要描述",
          }
        },
        required: ["code", "description"],
      },
      function: {
        name: "generate_threejs_code",
        description: "生成Three.js代码，根据用户的描述创建3D场景",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "完整的Three.js代码，可以是HTML格式或纯JavaScript",
            },
            description: {
              type: "string",
              description: "对生成代码的简要描述"
            }
          },
          required: ["code", "description"]
        }
      },
      invoke: async (input) => {
        console.log("调用generate_threejs_code工具");
        try {
          // 解析输入
          const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
          const { code, description } = parsedInput;
          
          if (!code) {
            return {
              success: false,
              error: "未提供代码"
            };
          }
          
          // 返回生成的代码和描述
          return {
            success: true,
            code: code,
            description: description || "Three.js场景",
            message: `代码已生成: ${description || "Three.js场景"}`
          };
        } catch (error) {
          console.error("生成代码时出错:", error);
          return {
            success: false,
            error: `生成代码时出错: ${error.message}`
          };
        }
      }
    },
    {
      name: "execute_threejs_code",
      description: "执行Three.js代码并在前端显示结果",
      type: "function", // 确保有type字段
      schema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "要执行的Three.js代码，可以是HTML格式或纯JavaScript",
          },
          mode: {
            type: "string",
            description: "执行模式: 'replace' 替换当前场景, 'append' 添加到当前场景",
            enum: ["replace", "append"]
          }
        },
        required: ["code"],
      },
      function: {
        name: "execute_threejs_code",
        description: "执行Three.js代码并在前端显示结果",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "要执行的Three.js代码，可以是HTML格式或纯JavaScript",
            },
            mode: {
              type: "string",
              description: "执行模式: 'replace' 替换当前场景, 'append' 添加到当前场景",
              enum: ["replace", "append"]
            }
          },
          required: ["code"]
        }
      },
      invoke: async (input) => {
        console.log("调用execute_threejs_code工具");
        try {
          // 解析输入
          const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
          const { code, mode = "replace" } = parsedInput;
          
          if (!code) {
            return {
              success: false,
              error: "未提供代码"
            };
          }
          
          // 返回执行请求
          return {
            type: "code_execution",
            code: code,
            mode: mode,
            success: true,
            message: "代码已发送到前端执行"
          };
        } catch (error) {
          console.error("执行代码时出错:", error);
          return {
            success: false,
            error: `执行代码时出错: ${error.message}`
          };
        }
      }
    }
  ];
}

module.exports = {
  createThreeJSTools
};
