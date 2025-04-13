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

  // 改进初始场景函数
  useEffect(() => {
    if (!canvasRef.current) return;

    // 创建基本场景
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true; // 启用阴影
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

    // 创建时钟用于动画
    const clock = new THREE.Clock();

    // 保存动画混合器
    const mixers = [];

    // 添加窗口大小变化监听
    const handleResize = () => {
      if (canvasRef.current && camera) {
        const width = canvasRef.current.clientWidth;
        const height = canvasRef.current.clientHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        renderer.setSize(width, height);
      }
    };

    window.addEventListener("resize", handleResize);

    // 改进渲染循环
    function animate() {
      requestAnimationFrame(animate);

      // 更新动画混合器
      const delta = clock.getDelta();
      mixers.forEach((mixer) => mixer.update(delta));

      // 检查场景中的对象数量，如果为空，添加默认立方体
      if (scene.children.length <= 2) {
        // Only camera and light
        console.log("场景为空，添加默认立方体");
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0xff4444 });
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(0, 0.5, 0);
        scene.add(cube);
      }

      // 渲染场景
      renderer.render(scene, camera);
    }

    animate();

    // 清理函数
    return () => {
      window.removeEventListener("resize", handleResize);

      if (renderer) {
        renderer.dispose();
      }
      if (scene) {
        disposeScene(scene);
      }

      // 清理混合器
      mixers.forEach((mixer) => mixer.stopAllAction());
    };
  }, []);

  // 改进初始场景函数
  function initDefaultScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);

    // 创建一个更好的相机设置
    const camera = new THREE.PerspectiveCamera(
      75,
      canvasRef.current.clientWidth / canvasRef.current.clientHeight,
      0.1,
      1000
    );

    // 设置一个更好的初始位置
    camera.position.set(2, 2, 5);
    camera.lookAt(0, 0, 0);

    // 添加更强的环境光
    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.6);
    scene.add(ambientLight);

    // 添加方向光
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // 添加默认地面平面以提供参考点
    const gridHelper = new THREE.GridHelper(10, 10);
    scene.add(gridHelper);

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

        console.log(`执行代码 (${mode}模式), 代码长度: ${code.length}`);

        // 在沙箱中执行代码
        const result = await sandboxRef.current.execute(code, {
          scene: sceneRef.current.scene,
          camera: sceneRef.current.camera,
          mode,
        });

        // 在执行代码后，尝试自动调整相机以显示整个场景
        try {
          console.log("调整相机位置...");
          centerCameraOnScene();

          // 多次调整确保最佳视角
          setTimeout(() => centerCameraOnScene(), 100);
          setTimeout(() => centerCameraOnScene(), 500);
        } catch (centerError) {
          console.warn("自动调整相机失败:", centerError);
        }

        // 检查是否有对象被添加
        const objectCount = sceneRef.current.scene.children.length;
        console.log(`场景中物体数量: ${objectCount}`);

        if (objectCount <= 2) {
          // 只有光源和相机
          console.warn("执行后场景中无物体，添加默认立方体");
          const geometry = new THREE.BoxGeometry(1, 1, 1);
          const material = new THREE.MeshStandardMaterial({ color: 0x44ff44 });
          const cube = new THREE.Mesh(geometry, material);
          cube.position.set(0, 0.5, 0);
          sceneRef.current.scene.add(cube);
        }

        return {
          success: true,
          message: "代码执行成功",
          sceneInfo: {
            objectCount: sceneRef.current.scene.children.length,
            memoryUsage: estimateMemoryUsage(),
          },
        };
      } catch (error) {
        console.error("代码执行失败:", error);
        setLastError(error.message);

        // 添加错误信息到场景中
        try {
          // 在场景中添加一个错误指示立方体
          const errorGeometry = new THREE.BoxGeometry(1, 1, 1);
          const errorMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
          });
          const errorCube = new THREE.Mesh(errorGeometry, errorMaterial);
          errorCube.position.set(0, 0.5, 0);
          sceneRef.current.scene.add(errorCube);

          // 调整相机
          centerCameraOnScene();
        } catch (e) {
          console.error("添加错误指示失败:", e);
        }

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

  // 改进centerCameraOnScene方法
  function centerCameraOnScene() {
    if (!sceneRef.current || !sceneRef.current.scene) return;

    const scene = sceneRef.current.scene;
    const camera = sceneRef.current.camera;

    // 创建一个边界框，但排除很大的辅助对象(如网格)
    const box = new THREE.Box3();
    let hasVisibleObjects = false;

    scene.traverse((object) => {
      // 检查是否为网格且不是辅助对象
      if (
        object.isMesh &&
        !(object instanceof THREE.GridHelper) &&
        !(object instanceof THREE.AxesHelper)
      ) {
        box.expandByObject(object);
        hasVisibleObjects = true;
      }
    });

    // 如果没有找到可视对象，包含所有对象
    if (!hasVisibleObjects) {
      box.setFromObject(scene);
    }

    if (!box.isEmpty() && box.max.x !== Infinity) {
      // 计算包围盒中心和大小
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);

      // 确定最大尺寸维度
      const maxDim = Math.max(size.x, size.y, size.z);

      // 如果包围盒有意义的大小
      if (maxDim > 0.1) {
        // 调整相机位置，确保整个场景可见
        const distance = Math.max(maxDim * 2, 5); // 至少保持5个单位距离

        // 将相机位置设置为更加倾斜的角度，便于观察
        camera.position.set(
          center.x + distance * 0.7,
          center.y + distance * 0.7,
          center.z + distance * 0.7
        );
        camera.lookAt(center);

        console.log("自动调整相机完成:", {
          center: center.toArray(),
          distance,
          cameraPos: camera.position.toArray(),
        });
      }
    } else {
      // 如果边界框为空，设置默认视图
      camera.position.set(3, 3, 5);
      camera.lookAt(0, 0, 0);
      console.log("使用默认相机位置");
    }
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
