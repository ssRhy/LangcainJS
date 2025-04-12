import { NextResponse } from "next/server";

// 导入消息队列函数
import { addMessageToQueue } from "../messages/route";

export async function POST(request) {
  try {
    const data = await request.json();

    if (data.type === "user_input") {
      // 模拟Agent思考
      const requestId = Date.now().toString();

      // 将思考消息加入队列
      addMessageToQueue({
        type: "agent_thinking",
        content: "正在思考如何创建3D场景...",
        requestId,
      });

      // 延迟2秒后添加响应消息
      setTimeout(() => {
        // 添加代码执行请求
        addMessageToQueue({
          type: "code_execution",
          code: `// 创建一个简单的立方体
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// 添加动画
function animate() {
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
}

animate();`,
          requestId: requestId + "-code",
        });

        // 添加Agent响应
        addMessageToQueue({
          type: "agent_message",
          content: "我已经创建了一个旋转的绿色立方体，你可以在右侧看到效果。",
          requestId,
        });

        // 完成状态
        addMessageToQueue({
          type: "agent_complete",
          requestId,
        });
      }, 2000);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "未知请求类型" });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    );
  }
}

export const dynamic = "force-dynamic";
