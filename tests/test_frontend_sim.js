import WebSocket from 'ws';

// 建立与 FakeModel 后端的 WebSocket 连接
const ws_url = 'ws://localhost:3001';
console.log(`[前端模拟器] 正在连接 WebSocket: ${ws_url}`);
const ws_connection = new WebSocket(ws_url);

/**
 * 模拟前端向后端发送人工回复内容
 * @param {string} session_id 会话ID
 * @param {string} reply_content 回复内容
 */
function send_simulated_reply(session_id, reply_content) {
    const payload = {
        type: 'send_reply',
        session_id: session_id,
        content: reply_content
    };
    console.log(`[前端模拟器] 正在对会话 #${session_id.substring(8, 14)} 发送模拟回复: ${reply_content}`);
    ws_connection.send(JSON.stringify(payload));
}

// 记录每个会话 ID 已自动回复过的最大消息数组长度，防止针对同一轮问题重复触发回复
const replied_lengths = new Map();

/**
 * 检查当前会话状态并执行自动人工回复
 * @param {Object} session 会话对象
 */
function check_and_auto_reply(session) {
    if (!session || session.status !== 'waiting') return;

    const messages = session.messages || [];
    const current_len = messages.length;

    // 如果没有消息，或者最后一条消息不是用户发送的，不进行自动回复
    if (current_len === 0 || messages[current_len - 1].role !== 'user') return;

    // 获取之前已回复过的最大长度
    const last_replied_len = replied_lengths.get(session.session_id) || 0;
    if (current_len <= last_replied_len) {
        return; // 该轮问题已回复过，直接返回
    }

    // 记录该长度，标记为已处理
    replied_lengths.set(session.session_id, current_len);

    if (current_len === 1) {
        console.log(`[前端模拟器] 监听到第一轮用户提问，执行第一轮自动回复: ${session.session_id}`);
        // 1 秒后发送第一轮人工回复（带测试通过！标志以让客户端知道接收完成）
        setTimeout(() => {
            send_simulated_reply(session.session_id, "第一轮人工回复：您好，我是人工客服！我已经成功接管了该会话，第一轮测试通过！");
        }, 1000);
    } else if (current_len === 3) {
        console.log(`[前端模拟器] 监听到第二轮用户提问，执行第二轮自动回复: ${session.session_id}`);
        // 1.5 秒后发送第二轮人工回复
        setTimeout(() => {
            send_simulated_reply(session.session_id, "第二轮人工回复：您好，第二轮提问我们也已经成功接收并接管，目前一切运行良好，多轮复活测试通过！");
        }, 1500);
    }
}

// 监听 WebSocket 的打开事件
ws_connection.on('open', () => {
    console.log('[前端模拟器] 已成功连接到后端 WebSocket 通道，正在等待待回复会话...');
});

// 监听 WebSocket 接收到的服务器消息
ws_connection.on('message', (raw_message) => {
    try {
        const parsed_data = JSON.parse(raw_message.toString());
        const { type } = parsed_data;
        
        if (type === 'new_session') {
            check_and_auto_reply(parsed_data.session);
        } else if (type === 'session_updated') {
            check_and_auto_reply(parsed_data.session);
        }
    } catch (err) {
        console.error('[前端模拟器] 解析消息失败:', err);
    }
});

// 监听连接关闭事件
ws_connection.on('close', () => {
    console.log('[前端模拟器] WebSocket 连接已关闭。');
});

// 监听错误事件
ws_connection.on('error', (err) => {
    console.error('[前端模拟器] 通信发生错误:', err.message);
});
