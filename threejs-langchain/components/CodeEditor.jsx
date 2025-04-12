"use client";

import { useState, useEffect } from "react";

export default function CodeEditor({
  code,
  readOnly = false,
  onChange = () => {},
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
      <div className="p-2 bg-gray-100 text-sm text-gray-700 border-b">
        Three.js 代码
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
