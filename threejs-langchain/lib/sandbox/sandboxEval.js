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
    console.log("执行代码开始，代码长度:", code.length);
    console.log("代码前30个字符:", code.substring(0, 30));

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

    // 尝试预处理代码
    let processedCode = code;
    try {
      // 增强的代码格式识别和处理

      // 1. 检查是否为HTML代码，尝试提取<script>部分
      if (
        code.includes("<!DOCTYPE html>") ||
        code.includes("<html>") ||
        code.includes("<script>")
      ) {
        console.log("检测到HTML或script标签，提取script内容");

        // 尝试提取所有脚本内容并合并
        const scriptMatches = code.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
        if (scriptMatches && scriptMatches.length > 0) {
          const extractedScripts = scriptMatches
            .map((script) => {
              const content = script.match(
                /<script[^>]*>([\s\S]*?)<\/script>/i
              )[1];
              return content.trim();
            })
            .join("\n\n");

          processedCode = extractedScripts;
          console.log("成功提取脚本，长度:", processedCode.length);
        } else {
          console.warn(
            "未能从HTML提取脚本，将尝试从整个代码中查找THREE相关代码..."
          );
        }
      }

      // 2. 检查是否为Markdown代码块，尝试提取```js```部分
      const markdownCodeBlockRegex = /```(?:javascript|js)?\s*([\s\S]*?)```/;
      const markdownMatch = code.match(markdownCodeBlockRegex);
      if (markdownMatch && markdownMatch[1]) {
        console.log("检测到Markdown代码块，提取JavaScript代码");
        processedCode = markdownMatch[1].trim();
      }

      // 3. 尝试提取包含THREE相关的代码段（如果前面的方法都不适用）
      if (
        processedCode === code &&
        (code.includes("THREE") ||
          code.includes("scene.add") ||
          code.includes("new Mesh"))
      ) {
        console.log("尝试直接从代码中识别Three.js相关部分");
        // 查找常见的THREE对象创建模式
        const patterns = [
          /new\s+THREE\.([A-Za-z]+)/,
          /const\s+([a-zA-Z0-9_]+)\s*=\s*new\s+THREE\.([A-Za-z]+)/,
          /scene\.add\(/,
        ];

        for (const pattern of patterns) {
          if (pattern.test(code)) {
            // 找到匹配项，保留整个代码
            processedCode = code;
            console.log("找到THREE相关代码");
            break;
          }
        }
      }

      // 移除可能的import/export语句
      processedCode = processedCode.replace(
        /^\s*import\s+.*?;?\s*$/gm,
        "// 已移除import语句"
      );
      processedCode = processedCode.replace(
        /^\s*export\s+.*?;?\s*$/gm,
        "// 已移除export语句"
      );

      // 如果代码中包含使用document的部分，尝试替换或移除
      processedCode = processedCode.replace(
        /document\.getElementById\(['"](.*?)['"]\)/g,
        "/* 已移除DOM操作 */"
      );

      // 如果代码中创建新的THREE.Scene()，替换为使用已有的scene
      processedCode = processedCode.replace(
        /const\s+([a-zA-Z0-9_]+)\s*=\s*new\s+THREE\.Scene\(\)/g,
        "const $1 = scene"
      );

      // 如果代码中创建新的renderer，移除这部分
      processedCode = processedCode.replace(
        /const\s+([a-zA-Z0-9_]+)\s*=\s*new\s+THREE\.WebGLRenderer\(.*?\)/g,
        "const $1 = renderer"
      );

      // 移除可能的animate或requestAnimationFrame循环
      processedCode = processedCode.replace(
        /function\s+animate\s*\(\s*\)\s*{[\s\S]*?requestAnimationFrame\s*\(\s*animate\s*\)[\s\S]*?}/g,
        "// 已移除动画循环"
      );

      // 移除直接调用的requestAnimationFrame
      processedCode = processedCode.replace(
        /requestAnimationFrame\s*\(\s*animate\s*\)/g,
        "// 已移除requestAnimationFrame调用"
      );

      // 添加更详细的调试输出，检查是否添加了objects
      processedCode = `
        // 添加调试跟踪
        console.log("沙箱内执行Three.js代码开始");
        
        let objectsAdded = 0;
        let geometriesCreated = 0;
        let materialsCreated = 0;
        const originalAdd = scene.add;
        
        scene.add = function() {
          objectsAdded++;
          console.log("添加对象到场景:", ...arguments);
          return originalAdd.apply(this, arguments);
        };
        
        // 包装几何体创建
        const originalBoxGeometry = THREE.BoxGeometry;
        THREE.BoxGeometry = function() {
          geometriesCreated++;
          console.log("创建BoxGeometry");
          return new originalBoxGeometry(...arguments);
        };
        
        // 包装材质创建
        const originalMeshStandardMaterial = THREE.MeshStandardMaterial;
        THREE.MeshStandardMaterial = function() {
          materialsCreated++;
          console.log("创建MeshStandardMaterial");
          return new originalMeshStandardMaterial(...arguments);
        };
        
        try {
          // 代码执行前确保场景已经初始化
          console.log("场景初始状态:", { 
            children: scene.children.length,
            camera: camera ? "已设置" : "未设置" 
          });
          
          // 执行处理后的代码
          ${processedCode}
          
          // 执行后检查场景状态
          console.log("代码执行结束，场景状态:", { 
            children: scene.children.length,
            objectsAdded: objectsAdded,
            geometriesCreated: geometriesCreated,
            materialsCreated: materialsCreated
          });
        } catch(err) {
          console.error("代码执行异常:", err);
          console.error("异常堆栈:", err.stack);
        }
        
        // 检查是否有对象被添加
        console.log("共添加了 " + objectsAdded + " 个对象到场景");
        
        // 添加默认对象（如果没有添加任何对象）
        if (objectsAdded === 0) {
          console.log("未检测到对象添加，添加默认立方体");
           
          // 再次检查代码中是否含有mesh或geometry创建但没有调用scene.add
          if (processedCode.includes("new THREE.Mesh") || 
              processedCode.includes("Mesh(") || 
              processedCode.includes("geometry") ||
              processedCode.includes("material")) {
             
            console.log("检测到代码创建了3D对象但未添加到场景，尝试查找并添加");
             
            // 尝试再次执行代码，强制执行scene.add
            try {
              let createdObjects = [];
              let lastCreatedMesh = null;
                 
              // 替换Mesh构造函数以跟踪创建的对象
              const originalMesh = THREE.Mesh;
              THREE.Mesh = function() {
                const mesh = new originalMesh(...arguments);
                createdObjects.push(mesh);
                lastCreatedMesh = mesh;
                return mesh;
              };
                 
              // 再次执行处理后的代码
              eval(processedCode);
                 
              // 检查是否有创建的对象没有添加到场景
              if (createdObjects.length > 0 && objectsAdded === 0) {
                console.log("发现" + createdObjects.length + "个未添加的对象，自动添加到场景");
                createdObjects.forEach(obj => {
                  if (!scene.children.includes(obj)) {
                    scene.add(obj);
                    objectsAdded++;
                  }
                });
              }
                 
              // 如果还是没有对象，但有找到最后创建的网格，则添加它
              if (objectsAdded === 0 && lastCreatedMesh) {
                console.log("添加最后创建的网格到场景");
                scene.add(lastCreatedMesh);
                objectsAdded++;
              }
            } catch(err) {
              console.error("自动添加对象失败:", err);
            }
          }
           
          // 如果所有尝试都失败，添加默认立方体
          if (objectsAdded === 0) {
            const defaultGeo = new THREE.BoxGeometry(1, 1, 1);
            const defaultMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
            const cube = new THREE.Mesh(defaultGeo, defaultMat);
            cube.position.y = 0.5;
            scene.add(cube);
          }
        }
      `;
    } catch (error) {
      console.warn("代码预处理错误，继续尝试原始代码:", error);
      processedCode = `
        try {
          ${code}
        } catch(err) {
          console.error("代码执行异常:", err);
        }
        
        // 检查是否需要添加默认对象
        if (scene.children.length <= 2) {
          console.log("场景中对象不足，添加默认立方体");
          const defaultGeo = new THREE.BoxGeometry(1, 1, 1);
          const defaultMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
          const cube = new THREE.Mesh(defaultGeo, defaultMat);
          cube.position.y = 0.5;
          scene.add(cube);
        }
      `;
    }

    try {
      // 对代码进行安全检查，但允许大多数Three.js特定代码
      validateCode(code);

      // 创建更丰富的沙箱环境
      const sandbox = createEnhancedSandbox(
        THREE,
        scene,
        camera,
        renderer,
        resources
      );

      // 构建安全执行函数
      const wrappedCode = `
        "use strict";
        return (async function() {
          try {
            ${processedCode}
            return { success: true };
          } catch (error) {
            return { success: false, error: error.message };
          }
        })();
      `;

      // 执行代码
      const result = new Function(...Object.keys(sandbox), wrappedCode)(
        ...Object.values(sandbox)
      );

      return await result;
    } catch (error) {
      console.error("代码执行最终错误:", error);
      // 即使出错也尝试在场景中添加一个错误提示立方体
      try {
        const errorGeo = new THREE.BoxGeometry(1, 1, 1);
        const errorMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const errorCube = new THREE.Mesh(errorGeo, errorMat);
        errorCube.position.set(0, 0.5, 0);
        scene.add(errorCube);
      } catch (e) {
        console.error("添加错误提示立方体失败:", e);
      }

      throw new Error(`代码执行错误: ${error.message}`);
    }
  }

  // 创建增强的沙箱环境
  function createEnhancedSandbox(THREE, scene, camera, renderer, resources) {
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
      // 添加常用的Three.js方法和属性
      Math: Math,
      // 添加Vector3帮助器
      Vector3: THREE.Vector3,
      // 添加常用颜色变量
      Color: THREE.Color,
      // 添加常用常量
      PI: Math.PI,
      // 添加场景工具方法
      centerObject: (obj) => {
        if (obj.geometry) {
          obj.geometry.computeBoundingBox();
          obj.position.set(0, obj.geometry.boundingBox.max.y / 2, 0);
        }
        return obj;
      },
    };

    // 添加所有常用的THREE对象工厂方法
    const safeFactories = [
      "BoxGeometry",
      "SphereGeometry",
      "PlaneGeometry",
      "CylinderGeometry",
      "TorusGeometry",
      "TorusKnotGeometry",
      "ConeGeometry",
      "CircleGeometry",
      "RingGeometry",
      "TetrahedronGeometry",
      "OctahedronGeometry",
      "DodecahedronGeometry",
      "MeshBasicMaterial",
      "MeshStandardMaterial",
      "MeshPhongMaterial",
      "MeshLambertMaterial",
      "MeshDepthMaterial",
      "MeshNormalMaterial",
      "TextureLoader",
      "Vector2",
      "Vector3",
      "Color",
      "Quaternion",
      "Euler",
      "Box3",
      "Sphere",
      "Raycaster",
      "Mesh",
      "Group",
      "Object3D",
      "PointLight",
      "SpotLight",
      "DirectionalLight",
      "AmbientLight",
      "HemisphereLight",
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

    return sandbox;
  }

  // 验证代码安全性
  function validateCode(code) {
    // 检查ES模块语法
    const modulePatterns = [
      /\bimport\s+.*from\s+/g,
      /\bimport\s+{.*}\s+from\s+/g,
      /\bimport\s+\*/g,
      /\bimport\s*\(/g,
      /\bexport\s+/g,
    ];

    let hasModuleSyntax = false;
    for (const pattern of modulePatterns) {
      if (pattern.test(code)) {
        console.warn("代码包含ES模块语法，将自动移除");
        hasModuleSyntax = true;
      }
    }

    // 如果包含模块语法，尝试提取有效代码部分
    if (hasModuleSyntax) {
      // 记录原始长度
      const originalLength = code.length;

      // 移除import语句
      code = code.replace(/^\s*import\s+.*?;?\s*$/gm, "");

      // 移除export语句
      code = code.replace(/^\s*export\s+.*?;?\s*$/gm, "");

      // 移除default导出
      code = code.replace(/^\s*export\s+default\s+.*?;?\s*$/gm, "");

      console.log(
        `移除了ES模块语法，代码长度从${originalLength}变为${code.length}`
      );
    }

    // 检查其他危险操作
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
