import "./globals.css";

export const metadata = {
  title: "Three.js LangChain Agent",
  description: "Three.js可视化与LangChain代理集成示例",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
