// CommonJS格式 - 替换NextResponse导入
// const { NextResponse } = require("next/server");

// 模拟消息队列
const messages = [];

// 清理超过30秒的消息
function cleanupOldMessages() {
  const now = Date.now();
  return messages.filter((msg) => now - msg.timestamp < 30000);
}

async function GET(request) {
  cleanupOldMessages();

  // 返回最新消息并清空队列
  const response = {
    messages: [...messages],
  };

  messages.length = 0; // 清空数组

  return response;
}

// 添加消息到队列的公共函数
function addMessageToQueue(message) {
  messages.push({
    ...message,
    timestamp: Date.now(),
  });
}

async function POST(request) {
  try {
    // 在Node.js环境中，request可能是不同的格式
    let data;
    if (request.json) {
      data = await request.json();
    } else if (request.body) {
      data = request.body;
    } else {
      data = {};
    }

    // 添加消息到队列
    if (data.message) {
      addMessageToQueue(data.message);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// 导出CommonJS模块
module.exports = {
  messages,
  addMessageToQueue,
  GET,
  POST,
};
