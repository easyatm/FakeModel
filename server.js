import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const public_dir = path.join(__dirname, 'public');

// 本地会话持久化存储文件路径
const sessions_file_path = './sessions.json';

/**
 * 净化 IP 地址，处理 IPv6 映射以及本地环回地址
 * @param {string} ip - 原始 IP 地址
 * @returns {string} 净化后的 IP 地址
 */
function clean_ip_address(ip) {
    if (!ip) return '127.0.0.1';
    // 兼容本地环回
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        return '127.0.0.1';
    }
    // 兼容 IPv4 映射 IPv6 格式
    if (ip.startsWith('::ffff:')) {
        return ip.slice(7);
    }
    return ip;
}

/**
 * 从 HTTP 请求头、Query 参数或 Body 数据中提取 API Key 用于认证和绑定
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {object} body_data - 解析后的 POST JSON 载荷
 * @returns {string|null} 提取出的 API Key 或者是 null
 */
function extract_api_key(req, body_data) {
    // 1. 优先从 Authorization 请求头提取 Bearer 凭证
    const auth_header = req.headers['authorization'];
    if (auth_header) {
        if (auth_header.toLowerCase().startsWith('bearer ')) {
            return auth_header.slice(7).trim();
        }
        return auth_header.trim();
    }
    
    // 2. 其次尝试从 URL 查询参数中获取 key / api_key 属性
    if (req.url && req.url.includes('?')) {
        try {
            const parsed_url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const query_key = parsed_url.searchParams.get('key') || parsed_url.searchParams.get('api_key');
            if (query_key) {
                return query_key.trim();
            }
        } catch (e) {
            // 忽略 URL 解析异常
        }
    }
    
    // 3. 最后尝试从 JSON 载荷 Body 中获取 key / api_key 字段
    if (body_data) {
        const body_key = body_data.key || body_data.api_key;
        if (body_key) {
            return String(body_key).trim();
        }
    }
    
    return null;
}


// 人工回复同步事件类，模拟 Windows 原生事件机制以进行线程/协程同步
class manual_event {
    constructor() {
        // 事件当前是否被激活/触发
        this.is_triggered = false;
        // 等待该事件触发的 Promise 回调函数队列
        this.wait_queue = [];
        // 触发事件时传递的负载数据（人工回复的文本内容）
        this.payload_data = null;
    }

    // 激活/设置事件，通知并唤醒正在等待该事件的线程/协程
    trigger_event(data) {
        this.is_triggered = true;
        this.payload_data = data;
        const current_waiters = [...this.wait_queue];
        this.wait_queue = [];
        for (const resolve_callback of current_waiters) {
            resolve_callback(data);
        }
        console.log("人工回复事件已成功触发。");
    }

    // 重置/取消事件，恢复为未触发状态
    reset_event() {
        this.is_triggered = false;
        this.payload_data = null;
        console.log("人工回复事件已重置。");
    }

    // 等待某个事件触发，如果已触发则立即返回数据
    wait_for_event() {
        if (this.is_triggered) {
            return Promise.resolve(this.payload_data);
        }
        return new Promise((resolve_callback) => {
            this.wait_queue.push(resolve_callback);
        });
    }
}

// 内存中保存的活跃会话列表
const active_sessions = [];
// 保存所有已连接的 WebSocket 客户端
const ws_clients = new Set();

// 上一次生成会话 ID 的时间戳字符串（格式：yymmddhhmmss）
let last_session_timestamp_str = '';
// 同一秒内生成会话的自增序号计数器
let session_sequence_num = 1;

/**
 * 根据当前本地时间生成符合格式要求的会话 ID (格式：yymmddhhmmssnn)
 * @returns {string} 格式化后的唯一会话 ID
 */
function generate_session_id() {
    const now = new Date();
    // 获取年份后两位
    const yy = String(now.getFullYear()).slice(-2);
    // 获取两位月份
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    // 获取两位日期
    const dd = String(now.getDate()).padStart(2, '0');
    // 获取两位小时
    const hh = String(now.getHours()).padStart(2, '0');
    // 获取两位分钟
    const min = String(now.getMinutes()).padStart(2, '0');
    // 获取两位秒数
    const ss = String(now.getSeconds()).padStart(2, '0');
    
    const timestamp_str = `${yy}${mm}${dd}${hh}${min}${ss}`;
    
    // 如果与上次生成会话的秒数相同，则序号自增，否则重置为 1
    if (timestamp_str === last_session_timestamp_str) {
        session_sequence_num++;
    } else {
        last_session_timestamp_str = timestamp_str;
        session_sequence_num = 1;
    }
    
    // 格式化为两位数字序号，最大 99 循环
    const nn = String(session_sequence_num % 100).padStart(2, '0');
    return `${timestamp_str}${nn}`;
}


// 将活跃会话列表持久化保存到本地 JSON 文件中
function save_sessions_to_local() {
    try {
        const safe_data = get_safe_sessions();
        fs.writeFileSync(sessions_file_path, JSON.stringify(safe_data, null, 2), 'utf8');
        console.log("会话数据已成功持久化保存到本地。");
    } catch (err) {
        console.error("持久化保存会话记录至本地失败:", err);
    }
}

// 从本地 JSON 文件加载历史会话数据
function load_sessions_from_local() {
    try {
        if (fs.existsSync(sessions_file_path)) {
            const raw_data = fs.readFileSync(sessions_file_path, 'utf8');
            const loaded_data = JSON.parse(raw_data);
            
            for (const session of loaded_data) {
                // 历史载入的会话，状态重置为非挂起/非等待回复状态
                session.is_waiting = false;
                session.current_http_res = null;
                session.current_event = null;
                // 如果历史状态为正在等待或活跃，启动后统一归于 ended
                if (session.status === 'waiting' || session.status === 'active') {
                    session.status = 'ended';
                }
                active_sessions.push(session);
            }
            console.log(`成功从本地加载了 ${loaded_data.length} 条历史会话记录。`);
        }
    } catch (err) {
        console.error("从本地加载历史会话记录失败:", err);
    }
}

// 自动加载本地的历史对话记录
load_sessions_from_local();

// 针对特定会话进行可见性安全过滤，分发广播会话更新事件给有权限的前端控制台
function broadcast_session_event(event_type, session) {
    const session_key = session.session_key;
    const session_ip = session.client_ip;

    for (const ws_client of ws_clients) {
        if (ws_client.readyState !== 1) continue;

        let is_authorized = false;
        if (session_key) {
            // 如果会话绑定了 Key，只有拥有相同 Key 绑定的前端有权接收
            is_authorized = (ws_client.bind_key === session_key);
        } else {
            // 如果会话是无 Key 状态，只有无 Key 连接且 IP 相同的前端有权接收 (IP 绑定隔离)
            is_authorized = (!ws_client.bind_key && ws_client.client_ip === session_ip);
        }

        if (is_authorized) {
            ws_client.send(JSON.stringify({
                type: event_type,
                session: get_session_payload(session),
                session_id: session.session_id
            }));
        }
    }
}

// 检查是否存在符合 API Key 或客户端 IP 绑定条件的活跃控制台连接
function has_active_gui_connection(session_key, client_ip) {
    for (const ws_client of ws_clients) {
        if (ws_client.readyState !== 1) continue;

        if (session_key) {
            if (ws_client.bind_key === session_key) return true;
        } else {
            if (!ws_client.bind_key && ws_client.client_ip === client_ip) return true;
        }
    }
    return false;
}

// 获取某个前端控制台有权访问的安全会话列表
function get_authorized_sessions_for_client(ws_client) {
    const bind_key = ws_client.bind_key;
    const client_ip = ws_client.client_ip;

    return active_sessions
        .filter(session => {
            if (session.session_key) {
                return session.session_key === bind_key;
            } else {
                return (!bind_key && session.client_ip === client_ip);
            }
        })
        .map(session => get_session_payload(session));
}

// 广播消息给所有已连接的前端页面（保留用于某些全局通知，主要逻辑已由隔离版 broadcast_session_event 接管）
function broadcast_message(message_data) {
    const raw_data = JSON.stringify(message_data);
    for (const ws_client of ws_clients) {
        if (ws_client.readyState === 1) { // 1 代表 WebSocket.OPEN
            ws_client.send(raw_data);
        }
    }
}

// 获取用于 WebSocket 广播传输的安全会话数据载荷 (排除 http 连接和事件等循环大对象，加入隔离绑定标识)
function get_session_payload(session) {
    return {
        session_id: session.session_id,
        session_key: session.session_key || null,
        client_ip: session.client_ip || '127.0.0.1',
        messages: session.messages,
        is_waiting: session.is_waiting,
        stream: session.stream,
        status: session.status,
        model: session.model || 'unknown',
        tools: session.tools || []
    };
}

// 获取用于传输给前端的安全会话列表数据（移除 http 响应对象和事件实例等循环引用/大对象）
function get_safe_sessions() {
    return active_sessions.map(session => get_session_payload(session));
}

// 尝试将新消息列表与现有的会话进行匹配，判断是否为同一个会话的多轮对话
function is_matching_session(old_messages, new_messages) {
    if (new_messages.length <= 1) {
        return false;
    }
    // 客户端多轮对话会把前面的历史和最新用户输入一并发送
    // 因此新消息除最后一条外，其余历史应该与旧会话记录完全一致
    if (old_messages.length !== new_messages.length - 1) {
        return false;
    }
    for (let i = 0; i < old_messages.length; i++) {
        if (old_messages[i].role !== new_messages[i].role || 
            old_messages[i].content !== new_messages[i].content) {
            return false;
        }
    }
    return true;
}

// 按照标点符号和空格切分文本的函数，使流式输出更加自然且不丢失字符
function split_text_into_chunks(text) {
    const delimiters = new Set([
        '，', '。', '！', '？', '、', '；', '：',
        ',', '.', '!', '?', ';', ':', ' ', '\t', '\n'
    ]);
    const chunks = [];
    let current_chunk = '';
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        current_chunk += char;
        // 遇到标点、空格或到达文本末尾，将累积的字符作为一个片段放入数组
        if (delimiters.has(char) || i === text.length - 1) {
            chunks.push(current_chunk);
            current_chunk = '';
        }
    }
    return chunks.filter(c => c.length > 0);
}

// 按照切分后的片段依次流式发送数据给客户端，模拟句子的自然流式效果
function send_stream_chunks(http_res, reply_content) {
    return new Promise((resolve) => {
        const chunks = split_text_into_chunks(reply_content);
        let current_index = 0;
        
        if (chunks.length === 0) {
            resolve();
            return;
        }

        const interval_id = setInterval(() => {
            if (current_index >= chunks.length) {
                clearInterval(interval_id);
                resolve();
                return;
            }
            
            const chunk_text = chunks[current_index];
            current_index++;

            const payload = {
                id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: "fake-model",
                choices: [
                    {
                        index: 0,
                        delta: { content: chunk_text },
                        finish_reason: null
                    }
                ]
            };
            http_res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }, 150); // 每个片段之间间隔 150ms，契合人类语言停顿
    });
}

/**
 * 流式发送工具调用 chunk 给客户端，严格遵循 OpenAI 规范
 * @param {http.ServerResponse} http_res - HTTP 响应对象
 * @param {Array} tool_calls - 工具调用列表
 * @returns {Promise<void>} 延迟发送结束后的 Promise
 */
function send_stream_tool_calls(http_res, tool_calls) {
    return new Promise((resolve) => {
        if (!tool_calls || tool_calls.length === 0) {
            resolve();
            return;
        }

        // 1. 发送声明事件，初始化每一个工具调用项的 ID 和名称
        const id_payload = {
            id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: "fake-model",
            choices: [
                {
                    index: 0,
                    delta: {
                        tool_calls: tool_calls.map((tc, idx) => ({
                            index: idx,
                            id: tc.id || "call_" + Math.random().toString(36).substr(2, 9),
                            type: "function",
                            function: {
                                name: tc.function.name,
                                arguments: ""
                            }
                        }))
                    },
                    finish_reason: null
                }
            ]
        };
        http_res.write(`data: ${JSON.stringify(id_payload)}\n\n`);

        // 2. 延迟 100ms 触发参数传输
        setTimeout(() => {
            const args_payload = {
                id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: "fake-model",
                choices: [
                    {
                        index: 0,
                        delta: {
                            tool_calls: tool_calls.map((tc, idx) => ({
                                index: idx,
                                function: {
                                    arguments: tc.function.arguments || "{}"
                                }
                            }))
                        },
                        finish_reason: null
                    }
                ]
            };
            http_res.write(`data: ${JSON.stringify(args_payload)}\n\n`);

            // 3. 再延迟 100ms 触发带有 finish_reason: "tool_calls" 的收尾帧
            setTimeout(() => {
                const finish_payload = {
                    id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: "fake-model",
                    choices: [
                        {
                            index: 0,
                            delta: {},
                            finish_reason: "tool_calls"
                        }
                    ]
                };
                http_res.write(`data: ${JSON.stringify(finish_payload)}\n\n`);
                resolve();
            }, 100);
        }, 100);
    });
}


// 解析 HTTP POST 请求的数据体
function parse_post_data(http_req) {
    return new Promise((resolve, reject) => {
        let body_data = '';
        http_req.on('data', chunk => {
            body_data += chunk.toString();
        });
        http_req.on('end', () => {
            try {
                resolve(JSON.parse(body_data));
            } catch (err) {
                reject(err);
            }
        });
    });
}

// 处理接收到的 HTTP API 请求
async function handle_http_request(req, res) {
    // 设置 CORS 跨域响应头，兼容各类 API 客户端
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 只处理 /v1/chat/completions 核心路由
    const req_path = req.url.split('?')[0];
    if (req.method === 'POST' && req_path === '/v1/chat/completions') {
        try {
            const body_data = await parse_post_data(req);
            const { messages, stream = false, model = 'unknown', tools = [] } = body_data;

            if (!messages || !Array.isArray(messages)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "参数错误：messages 必须为数组" }));
                return;
            }

            // 提取客户端 Key 与 IP 绑定属性
            const session_key = extract_api_key(req, body_data);
            const client_ip = clean_ip_address(req.socket.remoteAddress);

            // 当请求客户端发起对话时，检查是否有对应绑定的 GUI 连接
            if (!has_active_gui_connection(session_key, client_ip)) {
                console.log(`【拦截】客户端请求 (Key: ${session_key || '无'}, IP: ${client_ip}) 发起对话失败：未检测到对应的 GUI 控制台在线连接。`);
                
                // 动态获取请求的 Host 并构建服务基础地址
                const request_host = req.headers.host || `localhost:${listen_port}`;
                const server_url = `http://${request_host}`;

                const warning_msg = session_key
                    ? `# ⚠️ FakeModel 警告 / Warning\n\n未检测到绑定的前端控制台连接。您的客户端请求携带了 API Key：\n\`${session_key}\`\n\n**请按照以下步骤操作：**\n1. 确保您的网页控制中心（[${server_url}](${server_url})）处于打开且已连接状态。\n2. 在网页控制中心顶部 **"API Key 隔离绑定"** 栏输入上面完整的 API Key。\n3. 点击 **"应用"** 按钮以激活接管通道。\n\n*💡 提示：若您不想配置 Key，也可在两端均不填写 Key，系统将自动使用双方请求的 IP 地址进行通道绑定。*\n\n---\n\nNo bound frontend console connection detected. Your client request carried API Key:\n\`${session_key}\`\n\n**Please follow these steps:**\n1. Ensure your web control center ([${server_url}](${server_url})) is open and connected.\n2. Enter the complete API Key above into the **"API Key Binding"** field at the top of the control center.\n3. Click the **"Apply"** button to activate the takeover channel.\n\n*💡 Tip: If you prefer not to use an API Key, you can leave it blank on both sides. The system will automatically use the IP addresses to bind the channel.*`
                    : `# ⚠️ FakeModel 警告 / Warning\n\n未检测到绑定的前端控制台连接。您的客户端请求**未携带 API Key**，系统默认使用 **IP 隔离绑定模式**。\n\n**请按照以下步骤操作：**\n1. 确保您的网页控制中心（[${server_url}](${server_url})）已开启 WebSocket 连接。\n2. 确保您的网页端与客户端处于相同的 IP 网络环境。当前检测到的客户端 IP 为：\`${client_ip}\`。\n3. 网页端当前不能绑定 any API Key（保持为空，显示 IP 隔离模式），即可开始接收会话。\n\n---\n\nNo bound frontend console connection detected. Your client request **did not carry an API Key**. The system defaults to **IP Binding Mode**.\n\n**Please follow these steps:**\n1. Ensure your web control center ([${server_url}](${server_url})) has an active WebSocket connection.\n2. Ensure your web browser and client are in the same IP environment. Detected client IP: \`${client_ip}\`.\n3. The API Key field in the web UI must be kept empty (IP Isolation mode) to receive these sessions.`;
                
                if (stream) {
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive'
                    });
                    
                    const payload = {
                        id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: "fake-model-warning",
                        choices: [
                            {
                                index: 0,
                                delta: { content: warning_msg },
                                finish_reason: "stop"
                            }
                        ]
                    };
                    res.write(`data: ${JSON.stringify(payload)}\n\n`);
                    res.write(`data: [DONE]\n\n`);
                    res.end();
                } else {
                    const response_json = {
                        id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
                        object: "chat.completion",
                        created: Math.floor(Date.now() / 1000),
                        model: "fake-model-warning",
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: "assistant",
                                    content: warning_msg
                                },
                                finish_reason: "stop"
                            }
                        ]
                    };
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response_json));
                }
                return;
            }

            // 检查 messages 数组 the 第一个元素，如果是 role === 'assistant'，将其角色变更为 'system'
            if (messages.length > 0 && messages[0].role === 'assistant') {
                messages[0].role = 'system';
            }

            // 查找是否属于已有的会话的后续轮次
            let target_session = null;
            for (const session of active_sessions) {
                if (session.status !== 'ended' && is_matching_session(session.messages, messages)) {
                    target_session = session;
                    break;
                }
            }

            const client_event = new manual_event();

            if (target_session) {
                console.log(`匹配到已有会话，会话ID: ${target_session.session_id}，正在追加消息...`);
                // 更新会话状态和消息历史
                target_session.messages = messages;
                target_session.is_waiting = true;
                target_session.stream = stream;
                target_session.status = 'waiting';
                target_session.model = model;
                target_session.tools = tools;
                target_session.current_http_res = res;
                target_session.current_event = client_event;
                target_session.updated_at = Date.now();

                // 广播更新通知给符合可见性权限的前端
                broadcast_session_event("session_updated", target_session);
                // 同步本地存储存盘
                save_sessions_to_local();
            } else {
                // 创建全新会话
                const session_id = generate_session_id();
                console.log(`接收到新会话请求，生成会话ID: ${session_id}`);
                
                target_session = {
                    session_id: session_id,
                    session_key: session_key,
                    client_ip: client_ip,
                    messages: messages,
                    is_waiting: true,
                    stream: stream,
                    status: 'waiting',
                    model: model,
                    tools: tools,
                    current_http_res: res,
                    current_event: client_event,
                    updated_at: Date.now()
                };
                active_sessions.push(target_session);

                // 广播新建通知给符合可见性权限的前端
                broadcast_session_event("new_session", target_session);
                // 同步本地存储存盘
                save_sessions_to_local();
            }

            // 监听客户端连接断开事件
            res.on('close', () => {
                // 只有当响应尚未正常结束（即 writableEnded 依然为 false）时，才算作真正的客户端物理强行终止连接
                const is_real_disconnect = (res.writableEnded === false);

                if (is_real_disconnect && target_session.current_event === client_event) {
                    console.log(`客户端在等待回复期间强行断开了 TCP 连接，会话ID: ${target_session.session_id}`);
                    target_session.status = 'disconnected';
                    target_session.is_waiting = false;
                    target_session.current_event = null;
                    target_session.current_http_res = null;

                    // 释放可能挂起的事件
                    client_event.trigger_event(null);

                    // 广播给前端并同步写入本地 sessions.json
                    broadcast_session_event("client_disconnected", target_session);
                    save_sessions_to_local();
                } else {
                    console.log(`HTTP 响应正常释放或传输完毕后关闭，会话ID: ${target_session.session_id}`);
                    // 如果并非异常强断（即人工已经回复过了），我们应当将会话标记为 replied（已回复状态）
                    if (target_session.status === 'active' || target_session.status === 'waiting') {
                        target_session.status = 'replied';
                        target_session.is_waiting = false;
                        target_session.current_event = null;
                        target_session.current_http_res = null;

                        // 广播最新状态给前端
                        broadcast_session_event("session_updated", target_session);
                        save_sessions_to_local();
                    }
                }
            });

            if (stream) {
                // 流式响应预先写入头部，保持长连接挂起
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
            }

            // 循环阻塞等待人工回复，支持在同一 HTTP 连接上进行多次发送，直至会话被点击“结束”或连接断开
            while (target_session.status === 'waiting' || target_session.status === 'active') {
                const reply_data = await client_event.wait_for_event();

                // 如果接收到 null，代表人工强制结束会话或者连接意外断开，跳出循环
                if (reply_data === null) {
                    break;
                }

                // 兼容处理字符串和对象负载
                let reply_content = '';
                let reply_tool_calls = undefined;
                if (typeof reply_data === 'string') {
                    reply_content = reply_data;
                } else if (reply_data && typeof reply_data === 'object') {
                    reply_content = reply_data.content || '';
                    reply_tool_calls = reply_data.tool_calls;
                }

                // 将该段人工回复的内容追加记录到会话历史中
                const assistant_message = {
                    role: "assistant",
                    content: reply_content
                };
                if (reply_tool_calls && reply_tool_calls.length > 0) {
                    assistant_message.tool_calls = reply_tool_calls;
                }
                target_session.messages.push(assistant_message);
                target_session.updated_at = Date.now();

                if (stream) {
                    // 立即广播消息和“对话中...”状态，此时 is_waiting 为 true，锁定前端发送状态直到流式结束
                    target_session.is_waiting = true;
                    target_session.status = 'active';
                    broadcast_session_event("session_updated", target_session);
                    save_sessions_to_local();

                    // 按标点/空格切分消息并逐步输出给客户端
                    if (reply_content) {
                        await send_stream_chunks(res, reply_content);
                    }

                    // 如果有工具调用，流式发送工具调用
                    if (reply_tool_calls && reply_tool_calls.length > 0) {
                        await send_stream_tool_calls(res, reply_tool_calls);
                    } else if (reply_content) {
                        // 如果只有普通文本，发送 stop 结束帧
                        if (!res.destroyed && !res.writableEnded) {
                            const finish_payload = {
                                id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
                                object: "chat.completion.chunk",
                                created: Math.floor(Date.now() / 1000),
                                model: "fake-model",
                                choices: [
                                    {
                                        index: 0,
                                        delta: {},
                                        finish_reason: "stop"
                                    }
                                ]
                            };
                            res.write(`data: ${JSON.stringify(finish_payload)}\n\n`);
                        }
                    }

                    // 发送完该片段后，检查连接是否已断开
                    if (!res.destroyed && !res.writableEnded) {
                        // 结束流式，设为非等待中，通知前端释放输入框锁
                        target_session.is_waiting = false;

                        // 广播消息更新通知给前端，使前端脱离发送等待状态，恢复可编辑模式
                        broadcast_session_event("session_updated", target_session);
                        // 客服本次回复成功写入流并记录，更新本地存盘
                        save_sessions_to_local();

                        // 重置事件通知对象，准备等待下一条输入
                        client_event.reset_event();
                    } else {
                        console.log(`[流式发送] 检测到连接已关闭，中止后续状态更新，会话ID: ${target_session.session_id}`);
                        break;
                    }
                } else {
                    // 非流式（JSON）模式仅能做单次响应，发送后直接退出循环以关闭连接
                    const response_json = {
                        id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
                        object: "chat.completion",
                        created: Math.floor(Date.now() / 1000),
                        model: "fake-model",
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: "assistant",
                                    content: reply_content
                                },
                                finish_reason: reply_tool_calls && reply_tool_calls.length > 0 ? "tool_calls" : "stop"
                            }
                        ],
                        usage: {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                            total_tokens: 0
                        }
                    };

                    if (reply_tool_calls && reply_tool_calls.length > 0) {
                        response_json.choices[0].message.tool_calls = reply_tool_calls;
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response_json));
                    target_session.is_waiting = false;
                    target_session.status = 'replied';

                    // 正常非流式回复完毕后，向前端广播最新状态
                    broadcast_session_event("session_updated", target_session);

                    // 成功完成一轮，存入本地
                    save_sessions_to_local();
                    break;
                }
            }

            // 循环自然退出后，如果是流式输出且客户端连接仍然存活，写入 DONE 结束标志并断开
            if (stream && !res.writableEnded && !res.destroyed) {
                res.write(`data: [DONE]\n\n`);
                res.end();
                console.log(`会话正常结束，已向客户端发送 DONE 并关闭连接，会话ID: ${target_session.session_id}`);
                // 如果是手动点“结束会话”，状态已经更新，这里重新把最终结果同步本地 JSON
                save_sessions_to_local();
            }

        } catch (error) {
            console.error("处理 HTTP 请求发生异常:", error);
            if (!res.writableEnded) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "服务器内部错误" }));
            }
        }
    } else {
        // 解析静态请求文件的后缀和物理定位，消除 query 参数影响
        const safe_suffix = path.normalize(req.url.split('?')[0]);
        let target_file_path = path.join(public_dir, safe_suffix === '/' ? 'index.html' : safe_suffix);

        // 目录穿越安全检查
        if (!target_file_path.startsWith(public_dir)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end("403 禁止访问外部物理目录");
            return;
        }

        // 检查文件是否存在并流式返回给浏览器
        fs.stat(target_file_path, (err, stats) => {
            if (err || !stats.isFile()) {
                // 静态资源文件若不存在，应直接返回 404，不应该退回至 index.html，以避免浏览器将 HTML 当做 JS/CSS 解析报错
                const ext = path.extname(target_file_path).toLowerCase();
                const is_static_asset = ext && ext !== '.html';
                
                if (is_static_asset) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end("404 静态资源未找到");
                    return;
                }

                // 如果找不到资源，则退回至 index.html 以适配前端单页路由 (SPA fallback)
                const fallback_index = path.join(public_dir, 'index.html');
                fs.stat(fallback_index, (fallback_err, fallback_stats) => {
                    if (fallback_err) {
                        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end("404 页面或资源未找到。请先运行 npm run build 进行打包编译！");
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        fs.createReadStream(fallback_index).pipe(res);
                    }
                });
                return;
            }

            // 根据扩展名自动关联对应的 Content-Type 响应头
            const ext = path.extname(target_file_path).toLowerCase();
            const mime_types = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon'
            };
            const content_type = mime_types[ext] || 'application/octet-stream';

            res.writeHead(200, { 'Content-Type': content_type });
            fs.createReadStream(target_file_path).pipe(res);
        });
    }
}

// 处理前端 WebSocket 消息通信
function handle_ws_connection(ws_socket, req) {
    let bind_key = null;
    let client_ip = '127.0.0.1';

    try {
        if (req) {
            const parsed_url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            bind_key = parsed_url.searchParams.get('key') || null;
            if (bind_key === '') bind_key = null;
            
            client_ip = clean_ip_address(req.socket.remoteAddress);
        }
    } catch (err) {
        console.error("解析 WebSocket 连接凭证与 IP 参数失败:", err);
    }

    // 挂载连接专有的隔离绑定凭证及 IP 信息
    ws_socket.bind_key = bind_key;
    ws_socket.client_ip = client_ip;

    console.log(`前端控制台已建立 WebSocket 连接。绑定Key: ${bind_key || '无'}, 来源IP: ${client_ip}`);
    ws_clients.add(ws_socket);

    // 连接成功后，仅将该前端有权查看的隔离会话列表同步过去
    ws_socket.send(JSON.stringify({
        type: "session_list",
        sessions: get_authorized_sessions_for_client(ws_socket)
    }));

    // 处理来自前端的操作指令
    ws_socket.on('message', (raw_message) => {
        try {
            const message = JSON.parse(raw_message);
            const { type, session_id } = message;

            console.log(`收到前端指令: ${type}，会话ID: ${session_id}`);

            if (type === 'send_reply') {
                const { content, tool_calls } = message;
                const session = active_sessions.find(s => s.session_id === session_id);
                if (session && (session.status === 'waiting' || session.status === 'active') && session.current_event) {
                    // 触发人工回复事件，将输入内容通知并唤醒挂起的连接
                    session.current_event.trigger_event({ content, tool_calls });
                }
            } else if (type === 'end_session') {
                const session = active_sessions.find(s => s.session_id === session_id);
                if (session) {
                    session.status = 'ended';
                    session.is_waiting = false;
                    // 如果有正在等待的请求，释放它
                    if (session.current_event) {
                        session.current_event.trigger_event(null);
                    }
                    broadcast_session_event("session_updated", session);
                    // 手动结束会话，同步存盘
                    save_sessions_to_local();
                }
            } else if (type === 'delete_session') {
                const index = active_sessions.findIndex(s => s.session_id === session_id);
                if (index !== -1) {
                    const session = active_sessions[index];
                    console.log(`收到前端删除指令，正在移除内存与本地文件会话 #${session_id.substring(8, 14)}`);
                    // 释放可能正在等待的请求
                    if (session.current_event) {
                        session.current_event.trigger_event(null);
                    }
                    active_sessions.splice(index, 1);
                    
                    // 同步写入本地
                    save_sessions_to_local();

                    // 分别向每个在线的前端重新广播各自有权查看的最新会话列表
                    for (const client of ws_clients) {
                        if (client.readyState === 1) {
                            client.send(JSON.stringify({
                                type: "session_list",
                                sessions: get_authorized_sessions_for_client(client)
                            }));
                        }
                    }
                }
            } else if (type === 'clear_all_sessions') {
                console.log(`收到前端清空会话指令。发起端绑定Key: ${ws_socket.bind_key || '无'}, 来源IP: ${ws_socket.client_ip}`);
                
                // 仅过滤出当前前端拥有隔离访问权限的会话进行清除，实现多前端防越权清空
                const target_sessions_to_clear = active_sessions.filter(session => {
                    if (session.session_key) {
                        return session.session_key === ws_socket.bind_key;
                    } else {
                        return (!ws_socket.bind_key && session.client_ip === ws_socket.client_ip);
                    }
                });

                target_sessions_to_clear.forEach(session => {
                    if (session.current_event) {
                        session.current_event.trigger_event(null);
                    }
                    const index = active_sessions.indexOf(session);
                    if (index !== -1) {
                        active_sessions.splice(index, 1);
                    }
                });
                
                // 同步清空后写入本地 sessions.json 存盘
                save_sessions_to_local();
                
                // 重新向每个在线的前端分发它们各自有权查看的最新会话列表
                for (const client of ws_clients) {
                    if (client.readyState === 1) {
                        client.send(JSON.stringify({
                            type: "session_list",
                            sessions: get_authorized_sessions_for_client(client)
                        }));
                    }
                }
            }
        } catch (error) {
            console.error("处理 WebSocket 消息异常:", error);
        }
    });

    // 连接断开时清理客户端引用
    ws_socket.on('close', () => {
        console.log("前端控制台已断开 WebSocket 连接。");
        ws_clients.delete(ws_socket);
    });
}

// 解析命令行参数或环境变量以动态决定端口号（默认为 3000）
// 支持以下传参方式：
// 1. 命令行参数：node server.js --port 8080 或 node server.js -p 8080 或 node server.js 8080
// 2. 环境变量：PORT=8080 node server.js
function get_listen_port() {
    // 优先从环境变量获取
    if (process.env.PORT) {
        const port = parseInt(process.env.PORT, 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
            return port;
        }
    }
    
    // 其次从命令行参数获取
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' || args[i] === '-p') {
            if (args[i + 1]) {
                const port = parseInt(args[i + 1], 10);
                if (!isNaN(port) && port > 0 && port < 65536) {
                    return port;
                }
            }
        }
    }
    
    // 支持纯数字的裸参数传参，如 node server.js 8080
    for (const arg of args) {
        if (/^\d+$/.test(arg)) {
            const port = parseInt(arg, 10);
            if (port > 0 && port < 65536) {
                return port;
            }
        }
    }
    
    return 3001;
}

// 服务监听的端口号常量
const listen_port = get_listen_port();

// 创建 HTTP 服务，供 API 客户端 and 前端 WebSocket 共享端口
const server_instance = http.createServer(handle_http_request);

// 捕获服务运行或启动时的异常，特别是端口占用的情况，给以友好的中英双语错误提示
server_instance.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n=========================================`);
        console.error(`【服务启动失败】错误：端口 ${listen_port} 已被占用！`);
        console.error(`请检查是否有其他 FakeModel 服务实例正在运行。`);
        console.error(`您可以稍等片刻（等待系统回收 TIME_WAIT 状态），或者`);
        console.error(`杀死占用该端口的进程后重新启动。`);
        console.error(`-----------------------------------------`);
        console.error(`[Start Failed] Error: Port ${listen_port} is already in use!`);
        console.error(`Please check if another FakeModel instance is running.`);
        console.error(`Please wait a moment for the system to reclaim TIME_WAIT state, or`);
        console.error(`terminate the process using this port and restart.`);
        console.error(`=========================================\n`);
        process.exit(1);
    } else {
        console.error(`\n=========================================`);
        console.error(`【服务器启动异常】错误信息: ${err.message || err}`);
        console.error(`-----------------------------------------`);
        console.error(`[Server Start Exception] Error: ${err.message || err}`);
        console.error(`=========================================\n`);
        process.exit(1);
    }
});

// 绑定 WebSocket 服务 to 同一个 HTTP 端口，并设置错误捕获以防止抛出未处理异常
const wss_server = new WebSocketServer({ server: server_instance });
wss_server.on('error', (err) => {
    // 忽略与 http 服务端口冲突相关的报错（http 服务的 error 已经进行了退出并友好提示）
    if (err.code === 'EADDRINUSE') {
        return;
    }
    console.error("【WebSocket 异常】/ [WebSocket Exception]:", err.message || err);
});
wss_server.on('connection', handle_ws_connection);

// 启动服务并监听端口
server_instance.listen(listen_port, () => {
    console.log(`=========================================`);
    console.log(`FakeModel 服务成功启动！/ FakeModel Service Started Successfully!`);
    console.log(`API 代理请求地址 / API Proxy URL         : http://localhost:${listen_port}/v1/chat/completions`);
    console.log(`网页接管控制台地址 / Web Control Panel URL: http://localhost:${listen_port}`);
    console.log(`WebSocket 通信端口 / WebSocket Port       : 绑定在相同端口 ${listen_port} 的 http 服务上 / Bound to same http port ${listen_port}`);
    console.log(`=========================================`);
});
