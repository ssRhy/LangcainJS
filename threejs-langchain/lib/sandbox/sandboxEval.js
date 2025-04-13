// 修改为支持双模块系统的格式
function createSandbox(THREE, renderer) {
  // 跟踪创建的资源以便清理
  const resources = {
    geometries: [],
    materials: [],
    objects: [],
    animations: [],
    mixers: [],
  };

  // 安全地执行代码
  async function execute(code, context) {
    const { scene, camera, mode } = context;

    // 如果是替换模式，先清理场景
    if (mode === "replace") {
      // 保留灯光等基础设置
      const basicObjects = [];
      scene.traverse((obj) => {
        if (obj.isLight || obj === camera) {
          basicObjects.push(obj);
        }
      });

      // 清空场景
      while (scene.children.length > 0) {
        scene.remove(scene.children[0]);
      }

      // 重新添加基础对象
      basicObjects.forEach((obj) => scene.add(obj));

      // 清理追踪的资源
      disposeResources();
    }

    // 创建沙箱环境
    const sandbox = {
      THREE,
      scene,
      camera,
      renderer,
      // 跟踪资源创建
      trackGeometry: (geo) => {
        resources.geometries.push(geo);
        return geo;
      },
      trackMaterial: (mat) => {
        resources.materials.push(mat);
        return mat;
      },
      trackObject: (obj) => {
        resources.objects.push(obj);
        return obj;
      },
      console: {
        log: (...args) => console.log("[Sandbox]", ...args),
        warn: (...args) => console.warn("[Sandbox]", ...args),
        error: (...args) => console.error("[Sandbox]", ...args),
      },
      // 禁止危险操作
      window: undefined,
      document: {
        // 仅允许有限的DOM操作
        createElement: (tag) => {
          if (tag.toLowerCase() === "canvas") {
            return document.createElement("canvas");
          }
          throw new Error("只允许创建canvas元素");
        },
      },
      // 添加动画支持
      createAnimationMixer: (obj) => {
        const mixer = new THREE.AnimationMixer(obj);
        resources.mixers.push(mixer);
        return mixer;
      },
    };

    // 添加安全的THREE对象工厂方法
    const safeFactories = [
      "BoxGeometry",
      "SphereGeometry",
      "PlaneGeometry",
      "CylinderGeometry",
      "TorusGeometry",
      "MeshBasicMaterial",
      "MeshStandardMaterial",
      "MeshPhongMaterial",
      "MeshLambertMaterial",
      "TextureLoader",
      "Vector2",
      "Vector3",
      "Color",
    ];

    safeFactories.forEach((factory) => {
      if (THREE[factory]) {
        sandbox[factory] = (...args) => {
          const obj = new THREE[factory](...args);
          if (factory.includes("Geometry")) {
            resources.geometries.push(obj);
          } else if (factory.includes("Material")) {
            resources.materials.push(obj);
          }
          return obj;
        };
      }
    });

    // 对代码进行一些安全检查
    validateCode(code);

    // 构建安全执行函数
    const wrappedCode = `
      "use strict";
      return (async function() {
        try {
          ${code}
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      })();
    `;

    // 执行代码
    try {
      const result = new Function(...Object.keys(sandbox), wrappedCode)(
        ...Object.values(sandbox)
      );
      return await result;
    } catch (error) {
      throw new Error(`代码执行错误: ${error.message}`);
    }
  }

  // 验证代码安全性
  function validateCode(code) {
    // 检查危险操作
    const dangerousPatterns = [
      /\beval\s*\(/g,
      /\bFunction\s*\(/g,
      /\bdocument\.write/g,
      /\blocation\s*=/g,
      /\bwindow\.(open|close|alert|confirm|prompt)/g,
      /\blocalStorage\b/g,
      /\bsessionStorage\b/g,
      /\bindexedDB\b/g,
      /\bfetch\s*\(/g,
      /\bXMLHttpRequest\b/g,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        throw new Error("代码包含不安全操作");
      }
    }
  }

  // 清理资源
  function disposeResources() {
    // 清理几何体
    resources.geometries.forEach((geo) => {
      if (geo && typeof geo.dispose === "function") {
        geo.dispose();
      }
    });

    // 清理材质
    resources.materials.forEach((mat) => {
      if (mat && typeof mat.dispose === "function") {
        mat.dispose();
      }
    });

    // 重置资源跟踪
    resources.geometries = [];
    resources.materials = [];
    resources.objects = [];
    resources.animations = [];
    resources.mixers = [];
  }

  return {
    execute,
    disposeResources,
  };
}

// 兼容ES Module和CommonJS
// 检测是否在ES Module环境
if (typeof exports === "object" && typeof module !== "undefined") {
  // CommonJS环境
  module.exports = { createSandbox };
} else if (typeof define === "function" && define.amd) {
  // AMD环境
  define([], function () {
    return { createSandbox };
  });
} else {
  // 浏览器全局环境或ES Module
  if (typeof window !== "undefined") {
    window.SandboxEval = { createSandbox };
  }
  // 支持ES Module导出
  if (typeof exports !== "undefined") {
    exports.createSandbox = createSandbox;
  }
}
