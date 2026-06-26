import http from 'http';
import WebSocket from 'ws';

// 服务配置参数
const server_host = 'localhost';
const server_port = 3001;
const ws_url = `ws://${server_host}:${server_port}`;

/**
 * 模拟前端向后端发送包含工具调用的回复内容
 * @param {WebSocket} ws_connection - WebSocket 连接实例
 * @param {string} session_id - 会话 ID
 * @param {string} reply_content - 包含 [call:...] 标记的回复草稿
 */
function send_simulated_reply(ws_connection, session_id, reply_content) {
    // 模拟前端解析正则提取 tool_calls
    const tool_calls = [];
    const call_regex = /\[call:(\w+)(\{.*?\})\]/g;
    let match;
    while ((match = call_regex.exec(reply_content)) !== null) {
        const tool_name = match[1];
        const tool_args = match[2];
        tool_calls.push({
            id: "call_" + Math.random().toString(36).substr(2, 9),
            type: "function",
            function: {
                name: tool_name,
                arguments: tool_args
            }
        });
    }

    const content_without_calls = reply_content.replace(/\[call:\w+\{.*?\}\]/g, '').trim();

    const payload = {
        type: 'send_reply',
        session_id: session_id,
        content: content_without_calls,
        tool_calls: tool_calls.length > 0 ? tool_calls : undefined
    };

    console.log(`\n[前端模拟] 正在发送回复 (Content: "${content_without_calls}", ToolCalls: ${JSON.stringify(tool_calls)})`);
    ws_connection.send(JSON.stringify(payload));
}

/**
 * 启动测试用客户端请求
 * @param {boolean} is_stream - 是否是流式传输模式
 * @returns {Promise<void>}
 */
function run_client_request(is_stream = true) {
    return new Promise((resolve_callback) => {
        const post_data = JSON.stringify({
            model: "gpt-4-turbo-custom-model",
            messages: [
                { role: "user", content: `测试 ${is_stream ? '流式' : '非流式 JSON'} 工具调用功能` }
            ],
            stream: is_stream,
            tools: [
                {
                    type: "function",
                    function: {
                        name: "get_weather_forecast",
                        description: "查询指定城市的未来天气预报信息",
                        parameters: {
                            type: "object",
                            properties: {
                                city: { type: "string" },
                                days: { type: "integer" }
                            },
                            required: ["city"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "calculate_distance",
                        description: "计算坐标距离",
                        parameters: {
                            type: "object",
                            properties: {
                                lat1: { type: "number" },
                                lng1: { type: "number" }
                            },
                            required: ["lat1", "lng1"]
                        }
                    }
                }
            ]
        });

        const request_options = {
            hostname: server_host,
            port: server_port,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(post_data)
            }
        };

        const request_instance = http.request(request_options, (response_res) => {
            console.log(`\n[测试客户端] 收到响应状态码: ${response_res.statusCode}`);
            response_res.setEncoding('utf8');
            
            response_res.on('data', (chunk) => {
                console.log(`[测试客户端] 接收到原始响应数据:\n${chunk}`);
                // 如果是流式传输，且收到了 finish_reason: tool_calls，主动断开以推动测试进入下一阶段
                if (is_stream && chunk.includes('"finish_reason":"tool_calls"')) {
                    console.log("[测试客户端] 检测到流式回复结束，主动断开当前 HTTP 请求连接...");
                    request_instance.destroy();
                }
            });

            response_res.on('end', () => {
                console.log('[测试客户端] 连接已正常释放。');
            });
        });

        request_instance.on('error', (err) => {
            if (err.code !== 'ECONNRESET') {
                console.error('[测试客户端] 请求发生错误:', err);
            }
        });

        request_instance.on('close', () => {
            console.log('[测试客户端] 当前连接已安全关闭。');
            resolve_callback();
        });

        request_instance.write(post_data);
        request_instance.end();
    });
}

// 主流程启动
async function start_test() {
    console.log("[测试套件] 正在启动测试 WebSocket 监听...");
    const ws_client = new WebSocket(ws_url);

    ws_client.on('open', () => {
        console.log("[前端模拟] WebSocket 通道已开启。");
    });

    ws_client.on('message', (raw_msg) => {
        try {
            const data = JSON.parse(raw_msg.toString());
            // 监听到新会话到达
            if (data.type === 'new_session' || (data.type === 'session_updated' && data.session.status === 'waiting')) {
                const session = data.session;
                console.log(`[前端模拟] 捕获到待接管会话: #${session.session_id} (模型: ${session.model})`);
                
                // 1 秒后模拟客服在输入框输入混合内容并发送
                setTimeout(() => {
                    const sim_reply_text = '为您查到了相关结果。[call:get_weather_forecast{"city":"北京","days":3}][call:calculate_distance{"lat1":39.9,"lng1":116.4}]';
                    send_simulated_reply(ws_client, session.session_id, sim_reply_text);
                }, 1000);
            }
        } catch (err) {
            console.error("[前端模拟] 解析 WS 消息报错:", err);
        }
    });

    // 延迟 500ms 发起第一轮流式测试
    setTimeout(async () => {
        console.log("\n=================== 1. 流式 (SSE) 测试开始 ===================");
        await run_client_request(true);

        // 延迟 1 秒后发起第二轮非流式测试
        setTimeout(async () => {
            console.log("\n=================== 2. 非流式 (JSON) 测试开始 ===================");
            await run_client_request(false);

            // 测试完毕后关闭 WS 连接，安全退出
            setTimeout(() => {
                console.log("\n[测试套件] 所有用例测试完毕，关闭连接。");
                ws_client.close();
                process.exit(0);
            }, 1000);
        }, 1000);
    }, 1000);
}

start_test();
