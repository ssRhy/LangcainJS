"use client";

import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as THREE from "three";
// 修改导入方式，支持多种模块格式
import { createSandbox } from "@/lib/sandbox/sandboxEval";

// 添加一个备用导入方法，防止上面的方式失败
let sandboxModule;
try {
  sandboxModule = require("@/lib/sandbox/sandboxEval");
} catch (e) {
  // 如果require失败，则不处理，使用上面的import
  console.log("备用导入方法未生效，继续使用import");
}

const ThreeCanvas = forwardRef(function ThreeCanvas(props, ref) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const [lastError, setLastError] = useState(null);
  const sandboxRef = useRef(null);

  // 初始化Three.js环境
  useEffect(() => {
    if (!canvasRef.current) return;

    // 创建基本场景
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    rendererRef.current = renderer;

    // 创建安全沙箱，尝试不同的导入方式
    let sandboxCreate = createSandbox;
    if (!sandboxCreate && sandboxModule && sandboxModule.createSandbox) {
      sandboxCreate = sandboxModule.createSandbox;
    }

    // 如果都不可用，尝试从全局对象获取
    if (!sandboxCreate && typeof window !== "undefined" && window.SandboxEval) {
      sandboxCreate = window.SandboxEval.createSandbox;
    }

    if (!sandboxCreate) {
      setLastError("无法加载沙箱模块");
      console.error("无法加载沙箱模块");
      return;
    }

    sandboxRef.current = sandboxCreate(THREE, renderer);

    // 初始化基本场景
    const { scene, camera } = initDefaultScene();
    sceneRef.current = { scene, camera };

    // 渲染循环
    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    // 清理函数
    return () => {
      if (renderer) {
        renderer.dispose();
      }
      if (scene) {
        disposeScene(scene);
      }
    };
  }, []);

  // 初始化默认场景
  function initDefaultScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);

    const camera = new THREE.PerspectiveCamera(
      75,
      canvasRef.current.clientWidth / canvasRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 5;

    // 添加环境光
    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);

    // 添加方向光
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    return { scene, camera };
  }

  // 清理场景资源
  function disposeScene(scene) {
    scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }

      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  }

  // 向Agent暴露的方法
  useImperativeHandle(ref, () => ({
    // 执行Three.js代码
    executeCode: async (code, mode = "replace") => {
      try {
        setLastError(null);

        if (!sandboxRef.current || !sceneRef.current) {
          throw new Error("Three.js环境未初始化");
        }

        // 在沙箱中执行代码
        const result = await sandboxRef.current.execute(code, {
          scene: sceneRef.current.scene,
          camera: sceneRef.current.camera,
          mode,
        });

        return {
          success: true,
          message: "代码执行成功",
          sceneInfo: {
            objectCount: sceneRef.current.scene.children.length,
            memoryUsage: estimateMemoryUsage(),
          },
        };
      } catch (error) {
        setLastError(error.message);
        return {
          success: false,
          error: error.message,
        };
      }
    },

    // 捕获截图
    captureScreenshot: async (quality = 0.8, view = "current") => {
      try {
        if (!rendererRef.current || !sceneRef.current) {
          throw new Error("渲染器未初始化");
        }

        // 如果需要特定视角，先调整相机
        if (view !== "current") {
          adjustCameraView(view);
        }

        // 强制渲染一帧
        rendererRef.current.render(
          sceneRef.current.scene,
          sceneRef.current.camera
        );

        // 获取画布数据URL
        const dataUrl = canvasRef.current.toDataURL("image/jpeg", quality);

        return {
          success: true,
          screenshot: dataUrl,
          dimensions: {
            width: canvasRef.current.width,
            height: canvasRef.current.height,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    },

    // 分析场景
    analyzeScene: async (detail = "basic", focus = "all") => {
      if (!sceneRef.current) {
        return { success: false, error: "场景未初始化" };
      }

      const scene = sceneRef.current.scene;
      let objectCount = 0;
      let triangleCount = 0;
      let materialCount = 0;
      let textureCount = 0;
      const objectTypes = {};

      // 遍历场景获取信息
      scene.traverse((object) => {
        objectCount++;

        const type = object.type;
        objectTypes[type] = (objectTypes[type] || 0) + 1;

        if (object.geometry) {
          const geo = object.geometry;
          if (geo.index) {
            triangleCount += geo.index.count / 3;
          } else if (geo.attributes.position) {
            triangleCount += geo.attributes.position.count / 3;
          }
        }

        if (object.material) {
          if (Array.isArray(object.material)) {
            materialCount += object.material.length;
            object.material.forEach((mat) => {
              if (mat.map) textureCount++;
            });
          } else {
            materialCount++;
            if (object.material.map) textureCount++;
          }
        }
      });

      return {
        success: true,
        stats: {
          objectCount,
          triangleCount: Math.round(triangleCount),
          materialCount,
          textureCount,
          objectTypes,
        },
        performance: detail === "detailed" ? getPerformanceMetrics() : null,
        memoryUsage: estimateMemoryUsage(),
      };
    },
  }));

  // 调整相机视角
  function adjustCameraView(view) {
    const camera = sceneRef.current.camera;
    switch (view) {
      case "front":
        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);
        break;
      case "top":
        camera.position.set(0, 5, 0);
        camera.lookAt(0, 0, 0);
        break;
      case "side":
        camera.position.set(5, 0, 0);
        camera.lookAt(0, 0, 0);
        break;
    }
  }

  // 估算内存使用
  function estimateMemoryUsage() {
    const renderer = rendererRef.current;
    if (!renderer || !renderer.info) return null;

    const info = renderer.info;
    return {
      geometries: info.memory ? info.memory.geometries : 0,
      textures: info.memory ? info.memory.textures : 0,
      triangles: info.render ? info.render.triangles : 0,
    };
  }

  // 性能指标
  function getPerformanceMetrics() {
    return {
      fps: 0, // 在实际应用中可以实现FPS计算
      drawCalls: rendererRef.current?.info?.render?.calls || 0,
      triangles: rendererRef.current?.info?.render?.triangles || 0,
    };
  }

  return (
    <div className="w-full h-full relative">
      {lastError && (
        <div className="absolute top-0 right-0 bg-red-500 text-white p-2 m-2 rounded">
          {lastError}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: "block" }}
      />
    </div>
  );
});

export default ThreeCanvas;
