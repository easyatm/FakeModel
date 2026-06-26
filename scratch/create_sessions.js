// 创建测试会话的脚本，用于手动验证前端卡片在各种会话类型下的概要提取与三行紧凑排版效果。
import http from 'http';

/**
 * 发起模拟客户端请求以在后端创建会话
 * @param {Object} body - 请求载荷
 * @param {string} description - 请求说明
 */
function send_request(body, description) {
    const post_data = JSON.stringify(body);
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

    console.log(`[生成会话] 正在发起请求: ${description}...`);
    const req = http.request(request_options, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            console.log(`[${description}] 收到数据: ${chunk.substring(0, 100)}...`);
        });
    });

    req.on('error', (err) => {
        console.error(`[${description}] 请求失败:`, err);
    });

    req.write(post_data);
    req.end();
}

/**
 * 主执行函数，生成三种典型类型的测试会话
 */
function generate_all_test_sessions() {
    // 1. 普通文本消息会话
    send_request({
        model: "gpt-4-text-test",
        messages: [
            { role: "user", content: "你好，我想咨询一下这款系统怎么部署。" }
        ],
        stream: false
    }, "1_普通文本会话");

    // 2. 带 <userRequest> 标记的会话
    setTimeout(() => {
        send_request({
            model: "gpt-4-tag-test",
            messages: [
                { role: "user", content: "请帮我分析以下需求：\n<userRequest>\n需要实现一个可视化参数的工具调用控制中心，要求卡片精简为3行，支持对工具名和参数的智能提取。\n</userRequest>" }
            ],
            stream: false
        }, "2_标签提取会话");
    }, 500);

    // 3. 函数调用反馈会话 (role: 'tool')
    setTimeout(() => {
        send_request({
            model: "gpt-4-tool-test",
            messages: [
                { role: "user", content: "帮我查询下天气" },
                { 
                    role: "assistant", 
                    content: "", 
                    tool_calls: [
                        {
                            id: "call_weather_999",
                            type: "function",
                            function: {
                                name: "get_weather_forecast",
                                arguments: '{"city":"上海","days":7}'
                            }
                        }
                    ]
                },
                {
                    role: "tool",
                    name: "get_weather_forecast",
                    tool_call_id: "call_weather_999",
                    content: '{"temp": 28, "status": "sunny"}'
                }
            ],
            stream: false
        }, "3_工具调用反馈会话");
    }, 1000);
}

// 启动测试会话生成
generate_all_test_sessions();
