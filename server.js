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

// 广播消息给所有已连接的前端页面
function broadcast_message(message_data) {
    const raw_data = JSON.stringify(message_data);
    for (const ws_client of ws_clients) {
        if (ws_client.readyState === 1) { // 1 代表 WebSocket.OPEN
            ws_client.send(raw_data);
        }
    }
}

// 获取用于 WebSocket 广播传输的安全会话数据载荷 (排除 http 连接和事件等循环大对象)
function get_session_payload(session) {
    return {
        session_id: session.session_id,
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
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        try {
            const body_data = await parse_post_data(req);
            const { messages, stream = false, model = 'unknown', tools = [] } = body_data;

            if (!messages || !Array.isArray(messages)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "参数错误：messages 必须为数组" }));
                return;
            }

            // 检查 messages 数组的第一个元素，如果是 role === 'assistant'，将其角色变更为 'system'
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

                // 广播更新通知给前端
                broadcast_message({
                    type: "session_updated",
                    session: get_session_payload(target_session)
                });
                // 同步本地存储存盘
                save_sessions_to_local();
            } else {
                // 创建全新会话
                const session_id = generate_session_id();
                console.log(`接收到新会话请求，生成会话ID: ${session_id}`);
                
                target_session = {
                    session_id: session_id,
                    messages: messages,
                    is_waiting: true,
                    stream: stream,
                    status: 'waiting',
                    model: model,
                    tools: tools,
                    current_http_res: res,
                    current_event: client_event
                };
                active_sessions.push(target_session);

                // 广播新建通知给前端
                broadcast_message({
                    type: "new_session",
                    session: get_session_payload(target_session)
                });
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
                    broadcast_message({
                        type: "client_disconnected",
                        session_id: target_session.session_id
                    });
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
                        broadcast_message({
                            type: "session_updated",
                            session: get_session_payload(target_session)
                        });
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
                const reply_content = await client_event.wait_for_event();

                // 如果接收到 null，代表人工强制结束会话或者连接意外断开，跳出循环
                if (reply_content === null) {
                    break;
                }

                // 将该段人工回复的内容追加记录到会话历史中
                target_session.messages.push({
                    role: "assistant",
                    content: reply_content
                });

                if (stream) {
                    // 立即广播消息和“对话中...”状态，此时 is_waiting 为 true，锁定前端发送状态直到流式结束
                    target_session.is_waiting = true;
                    target_session.status = 'active';
                    broadcast_message({
                        type: "session_updated",
                        session: get_session_payload(target_session)
                    });
                    save_sessions_to_local();

                    // 按标点/空格切分消息并逐步输出给客户端
                    await send_stream_chunks(res, reply_content);

                    // 发送完该片段后，检查连接是否已断开
                    if (!res.destroyed && !res.writableEnded) {
                        // 结束流式，设为非等待中，通知前端释放输入框锁
                        target_session.is_waiting = false;

                        // 广播消息更新通知给前端，使前端脱离发送等待状态，恢复可编辑模式
                        broadcast_message({
                            type: "session_updated",
                            session: get_session_payload(target_session)
                        });
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
                                finish_reason: "stop"
                            }
                        ],
                        usage: {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                            total_tokens: 0
                        }
                    };
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response_json));
                    target_session.is_waiting = false;
                    target_session.status = 'replied';

                    // 正常非流式回复完毕后，向前端广播最新状态
                    broadcast_message({
                        type: "session_updated",
                        session: get_session_payload(target_session)
                    });

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
function handle_ws_connection(ws_socket) {
    console.log("前端控制台已建立 WebSocket 连接。");
    ws_clients.add(ws_socket);

    // 连接成功后，立即把现有的历史会话同步过去
    ws_socket.send(JSON.stringify({
        type: "session_list",
        sessions: get_safe_sessions()
    }));

    // 处理来自前端的操作指令
    ws_socket.on('message', (raw_message) => {
        try {
            const message = JSON.parse(raw_message);
            const { type, session_id } = message;

            console.log(`收到前端指令: ${type}，会话ID: ${session_id}`);

            if (type === 'send_reply') {
                const { content } = message;
                const session = active_sessions.find(s => s.session_id === session_id);
                if (session && (session.status === 'waiting' || session.status === 'active') && session.current_event) {
                    // 触发人工回复事件，将输入内容通知并唤醒挂起的连接
                    session.current_event.trigger_event(content);
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
                    broadcast_message({
                        type: "session_updated",
                        session: get_session_payload(session)
                    });
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

                    // 广播全量更新列表给所有前端
                    broadcast_message({
                        type: "session_list",
                        sessions: get_safe_sessions()
                    });
                }
            } else if (type === 'clear_all_sessions') {
                console.log("收到前端清空所有会话指令，开始清除所有数据并通知客户端。");
                // 释放所有当前可能被挂起的人工回复事件
                active_sessions.forEach(session => {
                    if (session.current_event) {
                        session.current_event.trigger_event(null);
                    }
                });
                active_sessions.length = 0; // 清空内存数组
                
                // 同步清空本地 sessions.json 文件内容并广播
                save_sessions_to_local();
                
                broadcast_message({
                    type: "session_list",
                    sessions: []
                });
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

// 服务监听的端口号常量
const listen_port = 3000;

// 创建 HTTP 服务，供 API 客户端 and 前端 WebSocket 共享端口
const server_instance = http.createServer(handle_http_request);

// 绑定 WebSocket 服务到同一个 HTTP 端口
const wss_server = new WebSocketServer({ server: server_instance });
wss_server.on('connection', handle_ws_connection);

// 捕获服务运行或启动时的异常，特别是端口占用的情况，给以友好的中文错误提示
server_instance.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n=========================================`);
        console.error(`【服务启动失败】错误：端口 ${listen_port} 已被占用！`);
        console.error(`请检查是否有其他 FakeModel 服务实例正在运行。`);
        console.error(`您可以稍等片刻（等待系统回收 TIME_WAIT 状态），或者`);
        console.error(`杀死占用该端口的进程后重新启动。`);
        console.error(`=========================================\n`);
        process.exit(1);
    } else {
        console.error("服务器发生未预期错误:", err);
    }
});

// 启动服务并监听端口
server_instance.listen(listen_port, () => {
    console.log(`=========================================`);
    console.log(`FakeModel 服务成功启动！`);
    console.log(`API 代理请求地址 : http://localhost:${listen_port}/v1/chat/completions`);
    console.log(`网页接管控制台地址: http://localhost:${listen_port}`);
    console.log(`WebSocket 通信端口 : 绑定在相同端口 ${listen_port} 的 http 服务上`);
    console.log(`=========================================`);
});
