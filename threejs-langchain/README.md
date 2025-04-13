# ThreeJS Langchain Agent

基于 WebSocket 的 Three.js 场景生成代理，通过 WebSocket 实现前后端通信。

## 项目架构

- **前端**: Next.js + React + Three.js
- **后端**: Node.js WebSocket 服务器 + Langchain Agent
- **AI 模型**: Azure OpenAI (GPT-4o)

项目使用 WebSocket 进行实时通信，将 AI 代理与 Three.js 场景渲染无缝集成。

## 安装依赖

```bash
npm install
# 或
yarn
# 或
pnpm install
```

## 环境变量设置

创建`.env`文件，包含以下内容：

```bash
# Azure OpenAI API设置
AZURE_OPENAI_API_KEY=your_api_key
AZURE_OPENAI_ENDPOINT=your_endpoint
AZURE_OPENAI_API_INSTANCE_NAME=your_instance
AZURE_OPENAI_API_DEPLOYMENT_NAME=your_deployment
AZURE_OPENAI_API_VERSION=2024-02-15-preview
AZURE_OPENAI_API_TYPE=azure

# 应用设置
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_WS_HOST=localhost
WS_PORT=3001
```

## 启动应用

使用单个命令启动完整应用（WebSocket 服务器 + Next.js）:

```bash
npm run start:all
# 或
yarn start:all
# 或
pnpm start:all
```

应用将在以下地址启动:

- Web 界面: http://localhost:3000
- WebSocket 服务: ws://localhost:3001/ws

## 各组件单独启动

WebSocket 服务器:

```bash
npm run websocket
```

Next.js 开发服务器:

```bash
npm run dev
```

## 项目功能

- 自然语言描述生成 Three.js 3D 场景
- 实时代码执行和场景渲染
- 场景分析和截图功能
- 保持会话上下文的对话

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
