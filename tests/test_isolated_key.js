import http from 'http';
import WebSocket from 'ws';

/**
 * 发起模拟 OpenAI 客户端的聊天请求，可选择是否携带 API Key
 * @param {string|null} api_key - 用于验证 of API Key
 * @param {boolean} is_stream - 是否开启流式传输模式
 * @param {Array} messages_history - 对话历史记录
 * @param {Function} on_complete - 响应完成后的回调函数，包含助手完整的回复文本
 */
function send_chat_request_with_key(api_key, is_stream = true, messages_history = [], on_complete = null) {
    const post_data = JSON.stringify({
        model: "gpt-4-turbo-custom-model",
        messages: messages_history,
        stream: is_stream
    });

    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(post_data)
    };

    if (api_key) {
        headers['Authorization'] = `Bearer ${api_key}`;
    }

    const request_options = {
        hostname: 'localhost',
        port: 3001,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: headers
    };

    console.log(`\n[测试客户端] 发起请求 -> Key: ${api_key || '无'}，流式: ${is_stream}`);
    
    let complete_text = '';
    const request_instance = http.request(request_options, (response_res) => {
        response_res.setEncoding('utf8');
        response_res.on('data', (data_chunk) => {
            const lines = data_chunk.split('\n');
            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line.startsWith('data: ')) {
                    const raw_payload = line.slice(6);
                    if (raw_payload.trim() === '[DONE]') {
                        request_instance.destroy();
                    } else {
                        try {
                            const parsed_json = JSON.parse(raw_payload);
                            const word = parsed_json.choices[0].delta.content || '';
                            complete_text += word;
                        } catch (err) {
                            // 忽略不完整包解析错误
                        }
                    }
                } else {
                    try {
                        const parsed_json = JSON.parse(data_chunk);
                        const word = parsed_json.choices[0].message.content || '';
                        complete_text += word;
                        request_instance.destroy();
                    } catch (err) {
                        // 忽略非 JSON 数据
                    }
                }
            }

            // 安全防御机制：一旦接收到的内容包含了预期的关键提示，主动断开长连接以流转到下一步
            if (complete_text.includes('隔离接管成功') || complete_text.includes('FakeModel 警告')) {
                request_instance.destroy();
            }
        });
    });

    request_instance.on('close', () => {
        if (on_complete) {
            on_complete(complete_text);
        }
    });

    request_instance.on('error', (err) => {
        // 静默处理 ECONNRESET 错误
    });

    request_instance.write(post_data);
    request_instance.end();
}

/**
 * 启动一个模拟的前端控制台，指定绑定 Key
 * @param {string|null} bind_key - 绑定的 API Key
 * @param {Function} on_connected - 连接成功的回调函数
 * @param {Function} on_message_custom - 自定义消息处理回调
 * @returns {WebSocket} WebSocket 连接实例
 */
function start_simulated_frontend(bind_key, on_connected = null, on_message_custom = null) {
    const key_param = bind_key ? `?key=${encodeURIComponent(bind_key)}` : '';
    const ws_url = `ws://localhost:3001${key_param}`;
    
    const ws_connection = new WebSocket(ws_url);

    ws_connection.on('open', () => {
        console.log(`[前端模拟器] 已连接 -> Key: ${bind_key || '无'}`);
        if (on_connected) {
            on_connected(ws_connection);
        }
    });

    ws_connection.on('message', (raw_message) => {
        try {
            const parsed_data = JSON.parse(raw_message.toString());
            if (on_message_custom) {
                on_message_custom(ws_connection, parsed_data);
                return;
            }
            
            const { type, session } = parsed_data;
            if ((type === 'new_session' || type === 'session_updated') && session && session.status === 'waiting') {
                const messages = session.messages || [];
                const current_len = messages.length;
                if (current_len > 0 && messages[current_len - 1].role === 'user') {
                    // 模拟人工回复
                    setTimeout(() => {
                        const reply_payload = {
                            type: 'send_reply',
                            session_id: session.session_id,
                            content: `[客服回复] 使用 Key "${bind_key}" 隔离接管成功！`
                        };
                        ws_connection.send(JSON.stringify(reply_payload));
                    }, 200);
                }
            }
        } catch (err) {
            console.error('[前端模拟器] 消息处理异常:', err);
        }
    });

    return ws_connection;
}

/**
 * 运行集成测试流程
 */
async function run_integration_tests() {
    console.log('=== 开始执行 API Key 隔离绑定安全机制测试 ===');

    // 1. 测试未连接 GUI 控制台时发起带 Key 请求（应拦截并警告）
    console.log('\n--- 步骤 1: 未连接任何前端时，发送带 Key 请求（期待被拦截警告） ---');
    await new Promise((resolve) => {
        send_chat_request_with_key('my-isolated-key-999', true, [{ role: 'user', content: '你好' }], (reply) => {
            console.log(`收到回复: "${reply.substring(0, 45)}..."`);
            const passed = reply.includes('未检测到绑定的前端控制台连接');
            console.log(`测试结果: ${passed ? '通过 ✅' : '失败 ❌'}`);
            resolve();
        });
    });

    // 2. 启动带 Key 的前端控制台
    console.log('\n--- 步骤 2: 启动绑定了 Key "my-isolated-key-999" 的前端模拟器 ---');
    const ws_frontend = await new Promise((resolve) => {
        const ws = start_simulated_frontend('my-isolated-key-999', () => resolve(ws));
    });

    // 3. 发送对应 Key 的客户端请求（应接管并回复）
    console.log('\n--- 步骤 3: 发送带对应 Key "my-isolated-key-999" 的客户端请求（期待成功接管回复） ---');
    await new Promise((resolve) => {
        send_chat_request_with_key('my-isolated-key-999', true, [{ role: 'user', content: '测试接管' }], (reply) => {
            console.log(`收到回复: "${reply}"`);
            const passed = reply.includes('隔离接管成功');
            console.log(`测试结果: ${passed ? '通过 ✅' : '失败 ❌'}`);
            resolve();
        });
    });

    // 4. 发送不同 Key 的客户端请求（应拦截并警告）
    console.log('\n--- 步骤 4: 发送不同 Key "different-key-888" 的客户端请求（期待被拦截警告） ---');
    await new Promise((resolve) => {
        send_chat_request_with_key('different-key-888', true, [{ role: 'user', content: '测试隔离' }], (reply) => {
            console.log(`收到回复: "${reply.substring(0, 45)}..."`);
            const passed = reply.includes('未检测到绑定的前端控制台连接');
            console.log(`测试结果: ${passed ? '通过 ✅' : '失败 ❌'}`);
            resolve();
        });
    });

    // 5. 关闭前端模拟器，再次发送带 Key 请求（应拦截并警告）
    console.log('\n--- 步骤 5: 关闭前端模拟器，再次发送带 Key "my-isolated-key-999" 的客户端请求（期待被拦截警告） ---');
    ws_frontend.close();
    await new Promise((resolve) => {
        setTimeout(() => {
            send_chat_request_with_key('my-isolated-key-999', true, [{ role: 'user', content: '测试断开后拦截' }], (reply) => {
                console.log(`收到回复: "${reply.substring(0, 45)}..."`);
                const passed = reply.includes('未检测到绑定的前端控制台连接');
                console.log(`测试结果: ${passed ? '通过 ✅' : '失败 ❌'}`);
                resolve();
            });
        }, 500);
    });

    // 6. 测试 Ctrl+Enter 发送内容并结束会话
    console.log('\n--- 步骤 6: 启动前端模拟器，测试 Ctrl+Enter 发送内容并结束会话 ---');
    const ws_ctrl_enter_1 = await new Promise((resolve) => {
        const ws = start_simulated_frontend('ctrl-enter-key-1', () => resolve(ws), (ws_conn, parsed_data) => {
            const { type, session } = parsed_data;
            if ((type === 'new_session' || type === 'session_updated') && session && session.status === 'waiting') {
                // 模拟有内容的 Ctrl+Enter 行为
                console.log('[前端模拟器] 收到等待回复消息，模拟 Ctrl+Enter（发送内容 + 结束）');
                // 1. 发送回复
                ws_conn.send(JSON.stringify({
                    type: 'send_reply',
                    session_id: session.session_id,
                    content: '这是 Ctrl+Enter 发送的内容回复'
                }));
                // 2. 50ms后发送结束指令
                setTimeout(() => {
                    ws_conn.send(JSON.stringify({
                        type: 'end_session',
                        session_id: session.session_id
                    }));
                }, 50);
            }
        });
    });

    await new Promise((resolve) => {
        send_chat_request_with_key('ctrl-enter-key-1', true, [{ role: 'user', content: '测试快捷发送并结束' }], (reply) => {
            console.log(`收到回复: "${reply}"`);
            const passed = reply.includes('这是 Ctrl+Enter 发送的内容回复');
            console.log(`测试结果: ${passed ? '通过 ✅' : '失败 ❌'}`);
            ws_ctrl_enter_1.close();
            resolve();
        });
    });

    // 7. 测试 Ctrl+Enter 编辑框为空直接结束会话
    console.log('\n--- 步骤 7: 启动前端模拟器，测试 Ctrl+Enter 空输入直接结束会话 ---');
    const ws_ctrl_enter_2 = await new Promise((resolve) => {
        const ws = start_simulated_frontend('ctrl-enter-key-2', () => resolve(ws), (ws_conn, parsed_data) => {
            const { type, session } = parsed_data;
            if ((type === 'new_session' || type === 'session_updated') && session && session.status === 'waiting') {
                // 模拟空内容的 Ctrl+Enter 行为：直接发送结束指令，不发送任何内容
                console.log('[前端模拟器] 收到等待回复消息，模拟 Ctrl+Enter（空输入，直接结束）');
                ws_conn.send(JSON.stringify({
                    type: 'end_session',
                    session_id: session.session_id
                }));
            }
        });
    });

    await new Promise((resolve) => {
        send_chat_request_with_key('ctrl-enter-key-2', true, [{ role: 'user', content: '测试快捷空结束' }], (reply) => {
            console.log(`收到回复: "${reply}"`);
            // 因为空输入直接结束，所以客户端应该没有收到客服的任何回复文本，直接收到了 DONE 结束
            const passed = reply === '';
            console.log(`测试结果: ${passed ? '通过 ✅' : '失败 ❌'}`);
            ws_ctrl_enter_2.close();
            resolve();
        });
    });

    console.log('\n=== API Key 隔离绑定安全机制测试全部完成！ ===');
}

run_integration_tests();
