"use client";

import { useState, useEffect } from "react";

export default function CodeEditor({
  code,
  readOnly = false,
  onChange = () => {},
  onExecute = null,
}) {
  const [localCode, setLocalCode] = useState(code || "");

  useEffect(() => {
    setLocalCode(code || "");
  }, [code]);

  const handleChange = (e) => {
    setLocalCode(e.target.value);
    onChange(e.target.value);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 bg-gray-100 text-sm text-gray-700 border-b flex justify-between items-center">
        <span>Three.js 代码</span>
        {onExecute && (
          <button
            onClick={() => onExecute(localCode)}
            className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
          >
            执行代码
          </button>
        )}
      </div>
      <textarea
        className="flex-grow p-3 font-mono text-sm outline-none resize-none bg-gray-50"
        value={localCode}
        onChange={handleChange}
        readOnly={readOnly}
        spellCheck="false"
      />
    </div>
  );
}
