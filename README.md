<details>
<summary><b>🇨🇳 点击展开中文版说明 (Click to expand Chinese version)</b></summary>

# FakeModel 人工接管 OpenAI API 代理系统

FakeModel 是一个为开发调试、大模型输出安全审计或特定 API 联调场景设计的人工接管代理系统。它能伪装成 OpenAI API 服务，将客户端的所有请求拦截并同步到前端控制台，由人工进行实时作答或审计后再以流式（SSE）或标准 JSON 的方式回写给客户端，实现完全可控的大模型“人工代打”。

---

## 核心特性

1. **零配置 OpenAI API 客户端兼容**：
   - 兼容标准 `/v1/chat/completions` POST 请求，支持客户端的多轮对话上下文重载。
   - 智能识别 API 参数，自动提取客户端发起的模型名（`model`）及挂载的工具函数列表（`tools` / `functions`）。
2. **可视化人工接管控制台**：
   - **自适应工具侧边栏**：当客户端请求注册了工具函数时，右侧会自动展开显示挂载工具列表，支持模糊过滤，且支持宽度鼠标拖动与 `localStorage` 持久化记忆。
   - **双栏拓宽工具详情弹窗**：点击工具卡片，以 1200px 宽幅及精美双栏设计呈现该工具的元数据及 parameters Schema（JSON 格式化渲染）。
   - **消息行数自动折叠**：限制聊天记录单条消息最大高度为 8 行，溢出部分自动以 `...` 截断，并在气泡内部右下角呈献高颜值“展开/收起”控制按钮。
3. **i18n 多语言支持**：
   - 边栏头部右上角提供了 `•••` 设置菜单，支持“自动 / 中文 / 英文”三挡语言切换并持久化存储。
4. **可靠的物理 TCP 断开检测**：
   - 监听底层响应层（Response Object）的 `close` 事件，100% 捕获客户端中途取消或进程杀死的物理强断行为，将状态标红置为 `disconnected`，拒绝悬空连接。
5. **多轮对话自动匹配与复活**：
   - 客户端发起多轮会话时，后端会根据消息历史与已有会话进行匹配，自动将新一轮请求合并到原会话卡片上，并将卡片置顶和闪烁呼吸灯提醒人工上线。

---

## 快速上手

### 1. 简易启动（开箱即用 🌟）
由于前端编译产物已预先打包在项目根目录的 `public` 下，如果您**仅需要运行并使用本系统**，无需关心前端源码或进行构建，直接在项目**根目录**下执行：
```bash
# 1. 安装后端 ws 依赖
npm install

# 2. 启动托管服务
npm start
```
服务启动成功后，直接在浏览器中访问下述地址即可进入控制中心：
👉 **控制台访问地址：`http://localhost:3000`**

---

### 2. 编译与二次开发（如果您需要修改前端代码）

#### 方式 A：托管生产模式（重新构建前端并由 Server 统一托管运行）
当您对前端界面源码进行了修改，需要重新打包生成托管静态资源时：
1. **安装 GUI 前端依赖**：
   ```bash
   cd gui && npm install
   ```
2. **重新编译前端并运行**：
   - **命令行方式**：在项目**根目录**下运行：
     ```bash
     # 编译前端，打包产物自动输出至根目录的 public 目录
     npm run build
     
     # 启动托管服务器
     npm start
     ```
   - **VS Code 任务一键运行**：在 VS Code 中直接运行任务：**`启动托管环境 (一键构建并运行)`**，它会以 `sequence` 顺序流自动帮您先进行前端打包构建，再启动托管服务。

#### 方式 B：前端开发调试模式（热更新联调）
如果您需要对前端代码进行二次开发并体验实时热更新（HMR）：
* **方式 1**：在 VS Code 中直接运行任务：**`启动开发环境 (热更新双端)`**，将以 `parallel` 模式同时启动 Server 代理服务（`3000` 端口）与前端开发服务。
* **方式 2**：在命令行中启动：
  - 在项目根目录下执行 `node server.js`
  - 在 `gui` 目录下执行 `npm run dev`
  启动后，在浏览器访问 `http://localhost:5173` 进行交互调试。

---

## 集成测试验证

为了帮助您快速验证整个系统的双向通信，我们提供了一个全功能的模拟测试套件：

1. **测试客户端发送请求**：
   在项目根目录下运行模拟的 API 客户端请求：
   ```bash
   # 运行客户端（发送一个带有 gpt-4-turbo-custom-model 及 2 个工具函数的流式请求）
   node tests/test_client.js
   ```
   此时客户端请求会被后端挂起，并在前端控制中心瞬间弹出一个呼吸灯闪烁的卡片，显示大模型名与 `🛠️ 2` 标签。
2. **人工接管作答**：
   - 您可以直接在前端网页的输入框内打字并回车发送进行回复。
   - 也可以通过在项目根目录下启动自动回复模拟器来验证全自动闭环：
     ```bash
     node tests/test_frontend_sim.js
     ```
     模拟客服会自动在 1.5 秒内进行打字作答，流式同步回写给客户端，最后安全释放 TCP。

---

## 项目结构
- `server.js`：放置于项目根目录下的 Node.js 服务端主程序。
- `/public`：编译打包后的前端 GUI 静态资源托管目录。
- `/gui`：Vue 3 控制台源码，所有网页样式、交互和多语言字典均已集成于 `src/App.vue` 中。
- `/tests`：包含 `test_client.js` 与 `test_frontend_sim.js` 的接口模拟与客服交互测试脚本文件夹。

</details>

# FakeModel: Manual Takeover OpenAI API Proxy System

FakeModel is a manual takeover proxy system designed for development debugging, LLM output security auditing, or specific API integration testing. It acts as an OpenAI API service, intercepting all client requests and synchronizing them to a front-end control panel. A human operator can then compose responses or perform audits in real-time, after which the responses are streamed (via SSE) or returned as standard JSON back to the client, enabling fully controlled human-in-the-loop interaction.

---

## Core Features

1. **Zero-Configuration OpenAI API Client Compatibility**:
   - Fully compatible with the standard `/v1/chat/completions` POST endpoint, supporting context reloading for multi-round client conversations.
   - Automatically parses API parameters, extracting the requested model name (`model`) and the registered tools/functions (`tools` / `functions`).
2. **Visual Manual Takeover Control Panel**:
   - **Adaptive Tools Sidebar**: Dynamically expands to display the registered tool list when a client request contains tool declarations. Supports fuzzy filtering, resizable dragging, and `localStorage` state persistence.
   - **Expanded Double-Column Details Modal**: Click any tool card to display its metadata and parameters Schema (JSON formatted) in a 1200px double-column modal.
   - **Collapsible Message Bubble**: Restricts single chat history messages to 8 lines. Excess text is truncated with `...`, offering a stylish "Expand / Collapse" button nested neatly inside the bubble.
3. **i18n Multi-Language Support**:
   - Offers an options menu (`•••`) in the sidebar header to switch among "Auto / Chinese / English" language modes with persistence.
4. **Reliable TCP Connection Disconnect Detection**:
   - Listens to the `close` event on the underlying Response Object, capturing 100% of physical client termination or process kills. The status instantly changes to `disconnected` (in red) to prevent dangling connections.
5. **Multi-Round Conversation Matching & Reviving**:
   - When a client initiates multi-round chats, the backend matches the history with active records, merges the new request into the existing session, brings the card to the top, and triggers a pulsing indicator to alert the operator.

---

## Quick Start

### 1. Simple Run (Out-of-the-Box 🌟)
Since the compiled front-end static assets are pre-packaged in the `/public` folder of the root directory, if you **only need to run and use this system**, you do not need to install GUI dependencies or run build commands. Simply execute the following at the **root directory**:
```bash
# 1. Install root backend dependencies
npm install

# 2. Start the hosting service
npm start
```
Once the service starts successfully, open your browser and navigate to:
👉 **Control Panel URL: `http://localhost:3000`**

---

### 2. Compilation & Development (If you need to modify front-end code)

#### Mode A: Hosted Production Mode (Rebuild front-end and served by Server)
When you modify the front-end source code and need to rebuild the hosted static assets:
1. **Install GUI dependencies**:
   ```bash
   cd gui && npm install
   ```
2. **Recompile and run**:
   - **Command line**: Run at the **root directory**:
     ```bash
     # Build front-end, outputting static assets to /public
     npm run build
     
     # Start the hosting server
     npm start
     ```
   - **VS Code Task**: Launch the VS Code task: **`启动托管环境 (一键构建并运行)`** (Start Hosting - Build and Run). It automatically builds the front-end and starts the server in sequence.

#### Mode B: Front-End Development Mode (HMR Debugging)
If you wish to modify the front-end code with Hot Module Replacement (HMR):
* **Option 1**: Run the VS Code task: **`启动开发环境 (热更新双端)`** (Start Dev Environment). It runs parallel tasks to launch the proxy server (`3000`) and the Vite dev server (`5173`).
* **Option 2**: Run via command line:
  - Run `node server.js` at the root directory.
  - Run `npm run dev` under the `gui` directory.
  Access the hot-reload interface at `http://localhost:5173`.

---

## Integration Test & Verification

To verify the bi-directional communication channel of the system, we provide a full-featured mock test suite:

1. **Client Sends Mock Request**:
   Run the mock API client request at the root directory:
   ```bash
   # Send a streaming request containing custom model name and 2 tool functions
   node tests/test_client.js
   ```
   The request will be suspended by the backend, and a card with a pulsing warning indicator will instantly pop up in the control panel.
2. **Operator Simulates Reply**:
   - You can type your response in the textarea in the web UI and hit Enter.
   - Alternatively, start the auto-reply simulator at the root directory to perform an automated loop test:
     ```bash
     node tests/test_frontend_sim.js
     ```
     The simulator automatically mimics typing and replies within 1.5s, writing chunks back to the client and releasing the TCP connection cleanly.

---

## Project Structure
- `server.js`: The Node.js proxy server main entry point located at the root.
- `/public`: The hosted static assets directory containing compiled GUI bundles.
- `/gui`: The Vue 3 source code for the console. All interface layouts and localizations are compiled from `src/App.vue`.
- `/tests`: Independent folder containing test scripts `test_client.js` and `test_frontend_sim.js`.
