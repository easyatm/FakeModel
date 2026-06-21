import http from 'http';

/**
 * 发起模拟 OpenAI 客户端的聊天请求
 * @param {boolean} is_stream 是否开启流式传输模式
 * @param {Array} messages_history 对话历史记录
 * @param {Function} on_complete 响应完成后的回调函数，包含助手完整的回复文本
 */
function send_chat_request(is_stream = true, messages_history = [], on_complete = null) {
    const post_data = JSON.stringify({
        model: "gpt-4-turbo-custom-model",
        messages: messages_history,
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
                            city: {
                                type: "string",
                                description: "城市名称，例如：北京、上海"
                            },
                            days: {
                                type: "integer",
                                description: "需要预测的天数，最大支持 7 天"
                            }
                        },
                        required: ["city"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "calculate_distance",
                    description: "计算两个地理坐标（经纬度）之间的球物理距离",
                    parameters: {
                        type: "object",
                        properties: {
                            lat1: { type: "number", description: "起点纬度" },
                            lng1: { type: "number", description: "起点经度" },
                            lat2: { type: "number", description: "终点纬度" },
                            lng2: { type: "number", description: "终点经度" }
                        },
                        required: ["lat1", "lng1", "lat2", "lng2"]
                    }
                }
            }
        ]
    });

    const request_options = {
        hostname: 'localhost',
        port: 3001,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(post_data)
        }
    };

    console.log(`\n[测试客户端] 正在向 FakeModel 发起请求，历史消息数: ${messages_history.length}，模式: ${is_stream ? '流式' : '普通JSON'}`);
    
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
                        // 正常结束数据流
                    } else {
                        try {
                            const parsed_json = JSON.parse(raw_payload);
                            const word = parsed_json.choices[0].delta.content || '';
                            process.stdout.write(word);
                            complete_text += word;

                            // 模拟真实的客户端：一旦在数据流中收到了完整的结束标志文本（测试通过！），主动断开 HTTP 连接释放资源
                            if (complete_text.includes("测试通过！")) {
                                console.log("\n[测试客户端] 接收到完整回复，主动断开当前 HTTP 请求连接...");
                                request_instance.destroy(); // 销毁连接
                            }
                        } catch (err) {
                            // 忽略不完整包解析错误
                        }
                    }
                }
            }
        });
    });

    // 监听连接完全关闭的事件（无论是异常断开还是正常完成）
    request_instance.on('close', () => {
        console.log('[测试客户端] 当前 HTTP 连接已安全释放。');
        if (on_complete) {
            on_complete(complete_text);
        }
    });

    // 捕获主动断开连接时所抛出的普通复位错误
    request_instance.on('error', (err) => {
        // 捕获并静默，避免测试流程崩溃
    });

    request_instance.write(post_data);
    request_instance.end();
}

// 声明第一轮测试消息
const initial_messages = [
    { role: "user", content: "第一轮问题：你好，我想测试一下人工客服接管功能。" }
];

// 执行第一轮对话请求
send_chat_request(true, initial_messages, (first_reply) => {
    // 组装第二轮消息包：包含上一轮的历史对话以及最新提问
    const updated_messages = [
        ...initial_messages,
        { role: "assistant", content: first_reply },
        { role: "user", content: "第二轮问题：太好了！连接已被标为已回复，现在新一轮测试通过！" }
    ];

    // 延迟 2.5 秒后发起第二轮测试请求
    setTimeout(() => {
        send_chat_request(true, updated_messages, (second_reply) => {
            console.log("\n[测试客户端] 多轮对话已回复判定与 Tab 自动复活验证圆满结束！");
        });
    }, 2500);
});
