<template>
  <div class="app-container">
    <!-- 左侧边栏：显示所有历史会话列表 -->
    <aside 
      class="sidebar glass-panel" 
      :style="{ width: left_sidebar_width + 'px', minWidth: left_sidebar_width + 'px', maxWidth: left_sidebar_width + 'px' }"
    >
      <div class="sidebar-header">
        <div class="brand-header-row">
          <div class="brand-info">
            <span class="brand-logo">🤖</span>
            <div>
              <h2 class="app-title">FakeModel</h2>
              <span class="status-indicator" :class="ws_status">
                {{ 
                  ws_status === 'connected' ? t('status_connected') : 
                  ws_status === 'connecting' ? t('status_connecting') : t('status_disconnected') 
                }}
              </span>
            </div>
          </div>
          
          <!-- 右上角多语言设置菜单 -->
          <div class="lang-settings-container">
            <div 
              class="btn-more-options" 
              @click.stop="toggle_lang_menu" 
              :title="t('menu_language')"
              role="button"
            >
              •••
            </div>
            <transition name="fade-scale">
              <div v-if="show_lang_menu" class="lang-dropdown-menu glass-panel" @click.stop>
                <!-- 一级菜单项：显示语言。悬停由 CSS 原生 :hover 展示二级菜单 -->
                <div class="dropdown-menu-item has-submenu" role="button">
                  <div class="menu-item-content">
                    <span>🌐 {{ t('menu_language') }}</span>
                    <!-- 旋转指示小箭头 -->
                    <span class="submenu-arrow">▶</span>
                  </div>
                  
                  <!-- 二级子菜单：具体的语言选项。由 CSS 控制显隐 -->
                  <div class="lang-submenu-menu glass-panel">
                    <div 
                      class="dropdown-submenu-item" 
                      :class="{ active: lang_mode === 'auto' }" 
                      @click.stop="change_language('auto')"
                      role="button"
                    >
                      <span class="check-mark-box">
                        <span v-if="lang_mode === 'auto'">✓</span>
                      </span>
                      <span>{{ t('lang_auto') }}</span>
                    </div>
                    <div 
                      class="dropdown-submenu-item" 
                      :class="{ active: lang_mode === 'zh' }" 
                      @click.stop="change_language('zh')"
                      role="button"
                    >
                      <span class="check-mark-box">
                        <span v-if="lang_mode === 'zh'">✓</span>
                      </span>
                      <span>{{ t('lang_zh') }}</span>
                    </div>
                    <div 
                      class="dropdown-submenu-item" 
                      :class="{ active: lang_mode === 'en' }" 
                      @click.stop="change_language('en')"
                      role="button"
                    >
                      <span class="check-mark-box">
                        <span v-if="lang_mode === 'en'">✓</span>
                      </span>
                      <span>{{ t('lang_en') }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </div>
        
        <!-- API Key 私有隔离绑定面板 -->
        <div class="key-binding-panel glass-panel">
          <div class="key-panel-title">
            <span>🔑 {{ t('bind_key_label') }}</span>
            <span class="key-mode-badge" :class="bind_key ? 'bound' : 'ip-mode'">
              {{ bind_key ? t('status_key_bound') : t('status_ip_bound') }}
            </span>
          </div>
          <div class="key-input-row">
            <div class="key-input-wrapper">
              <input 
                v-model="bind_key" 
                :type="show_key_text ? 'text' : 'password'" 
                :placeholder="t('bind_key_placeholder')"
                class="key-input"
                @keydown.enter="apply_key_binding"
              />
              <span class="btn-toggle-eye" @click="show_key_text = !show_key_text" role="button">
                {{ show_key_text ? '👁' : '👁‍🗨' }}
              </span>
            </div>
            <button class="btn-apply-key" @click="apply_key_binding">
              {{ t('btn_apply_key') }}
            </button>
          </div>
        </div>

        <!-- 全局一键清空按钮 -->
        <button 
          v-if="sessions.length > 0" 
          class="btn-clear-all" 
          @click="clear_all_sessions_locally"
          :title="t('clear_records_title')"
        >
          🧹 {{ t('clear_records') }}
        </button>
      </div>

      <!-- 会话搜索框 -->
      <div class="search-box">
        <input 
          v-model="search_query" 
          type="text" 
          :placeholder="t('search_placeholder')" 
          class="search-input"
        />
      </div>

      <!-- 会话卡片列表 -->
      <div class="sessions-list">
        <div 
          v-for="session in filtered_sessions" 
          :key="session.session_id"
          class="session-card"
          :class="{ active: session.session_id === active_session_id, 'waiting-card': session.status === 'waiting' }"
          @click="select_session(session.session_id)"
        >
          <div class="card-header">
            <span class="session-label">{{ t('session_label') }} #{{ session.session_id.startsWith('session_') ? session.session_id.substring(8, 14) : session.session_id }}</span>
            <div class="card-header-actions">
              <span class="stream-badge" v-if="session.stream">{{ t('stream_badge') }}</span>
              <!-- 单个删除按钮：使用 stop 阻止冒泡防止选中 -->
              <button 
                class="btn-delete-card" 
                @click.stop="delete_session_locally(session.session_id)"
                :title="t('delete_session_title')"
              >
                🗑️
              </button>
            </div>
          </div>
          
          <div class="card-preview">
            {{ get_session_preview(session) }}
          </div>

          <!-- 模型与工具信息行 -->
          <div class="card-meta-info">
            <span class="meta-model" :title="session.model">🤖 {{ session.model || t('unknown_model') }}</span>
            <span class="meta-tools" v-if="session.tools && session.tools.length > 0">🛠️ {{ session.tools.length }}</span>
          </div>

          <div class="card-footer">
            <span class="status-badge" :class="session.status === 'waiting' ? 'waiting' : (session.status === 'active' ? 'replied' : 'ended')">
              {{ 
                session.status === 'waiting' ? '● ' + t('status_waiting') : 
                session.status === 'active' ? t('status_active') : t('status_ended') 
              }}
            </span>
          </div>
        </div>

        <div v-if="filtered_sessions.length === 0" class="empty-state">
          {{ t('no_sessions') }}
        </div>
      </div>
      <!-- 拖拽调整左侧边栏宽度的手柄 -->
      <div class="resize-handle left-handle" @mousedown="init_left_resize"></div>
    </aside>

    <!-- 右侧主区域：显示当前对话的详细内容和编辑输入区 -->
    <main class="main-content">
      <div v-if="current_session" class="chat-container">
        <!-- 对话头部状态栏 -->
        <header class="chat-header glass-panel">
          <div class="header-info">
            <h3>{{ t('session_label') }} #{{ current_session.session_id }}</h3>
            <span class="session-meta">
              {{ t('mode_prefix') }} {{ current_session.stream ? t('mode_sse') : t('mode_json') }}
            </span>
          </div>
          <div class="header-actions">
            <button 
              v-if="current_session.status === 'waiting' || current_session.status === 'active'" 
              class="btn btn-danger btn-sm" 
              @click="terminate_session(current_session.session_id)"
            >
              {{ t('btn_terminate') }}
            </button>
          </div>
        </header>

        <!-- 对话主体区（分左右两栏，自适应展示工具函数侧边栏） -->
        <div class="chat-body">
          <!-- 左栏：对话历史与输入区 -->
          <div class="chat-main">
            <!-- 详细对话历史记录区 -->
            <div class="chat-history" ref="history_container">
              <div 
                v-for="(msg, index) in current_session.messages" 
                :key="index"
                class="message-row"
                :class="msg.role === 'assistant' ? 'message-assistant' : 'message-user'"
              >
                <div class="avatar" :class="{ 'avatar-eve': msg.role === 'assistant' }">
                  <img v-if="msg.role === 'assistant'" class="avatar-img" :src="eve_avatar" alt="EVE" />
                  <svg v-else-if="msg.role === 'system'" class="system-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                  <svg v-else class="vscode-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M23.15 6.58L17.85.1c-.28-.34-.8-.3-.88.13L13.62 6.8 5.4 1c-.34-.23-.8-.16-1.04.18L.1 7.23a.75.75 0 00.07.97l5.12 4.79L.17 17.8a.75.75 0 00-.07.97l4.26 6.05c.24.34.7.4 1.04.18l8.22-5.8 3.35 6.57c.09.43.6.47.88.13l5.3-6.48c.18-.22.28-.5.28-.79V7.37c0-.29-.1-.57-.28-.79z" fill="#007ACC"/>
                    <path d="M18 5.74v12.52l-5.06-3.85V9.6L18 5.74z" fill="#1F9CF0"/>
                    <path d="M5.48 12L1.8 8.56l3.68-3.44V12z" fill="#AE7FF2"/>
                  </svg>
                </div>
                <div class="message-bubble">
                  <div class="message-sender">
                    {{ msg.role === 'assistant' ? t('role_ai') : msg.role === 'system' ? t('role_system') : t('role_user') }}
                  </div>
                  <!-- 泡泡主体：包裹文本与右下角控制按钮 -->
                  <div class="message-bubble-body">
                    <pre 
                      :ref="el => set_message_text_ref(el, current_session.session_id + '_' + index)"
                      class="message-text"
                      :class="{ collapsed: !is_message_expanded(current_session.session_id, index) }"
                    >{{ msg.content }}</pre>
                    
                    <!-- 融合式折叠遮罩：当消息溢出且处于折叠状态时展示，自带底部渐变融合 -->
                    <div 
                      v-if="overflowed_messages[current_session.session_id + '_' + index] && !is_message_expanded(current_session.session_id, index)"
                      class="message-text-fade-mask"
                      @click="toggle_message_expand(current_session.session_id, index)"
                    >
                      <span class="btn-toggle-link">{{ t('btn_expand') }}</span>
                    </div>

                    <!-- 融合式的内联收起按钮：当消息溢出且处于展开状态时在底部展示 -->
                    <button 
                      v-else-if="overflowed_messages[current_session.session_id + '_' + index]"
                      class="btn-toggle-expand-inline"
                      @click="toggle_message_expand(current_session.session_id, index)"
                    >
                      {{ t('btn_collapse') }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- 如果当前正处于等待人工回复状态 -->
              <div v-if="current_session.status === 'waiting'" class="status-alert waiting">
                <div class="pulsate-dot"></div>
                <span>{{ t('alert_waiting') }}</span>
              </div>
              <div v-else-if="current_session.status !== 'active'" class="status-alert ended">
                <span>{{ t('alert_ended') }}</span>
              </div>
            </div>

            <!-- 底部人工输入与操作区 -->
            <footer class="chat-footer glass-panel">
              <div class="input-area">
                <textarea 
                  ref="reply_input"
                  v-model="draft_replies[current_session.session_id]"
                  :placeholder="t('input_placeholder')"
                  class="reply-textarea"
                  :disabled="current_session.status === 'ended' || current_session.status === 'disconnected'"
                  @keydown.enter.exact.prevent="submit_reply(current_session.session_id)"
                  @keydown.enter.ctrl.prevent="submit_reply_and_end(current_session.session_id)"
                ></textarea>
              </div>
            </footer>
          </div>

          <!-- 右栏：工具函数展示区 -->
          <aside 
            class="tools-sidebar glass-panel" 
            v-if="current_session.tools && current_session.tools.length > 0"
            :style="{ width: right_sidebar_width + 'px', minWidth: right_sidebar_width + 'px', maxWidth: right_sidebar_width + 'px' }"
          >
            <!-- 拖拽调整右侧边栏宽度的手柄 -->
            <div class="resize-handle right-handle" @mousedown="init_right_resize"></div>

            <div class="sidebar-section-title">🛠️ {{ t('tools_title') }} ({{ current_session.tools.length }})</div>

            <!-- 搜索过滤输入框 -->
            <div class="tool-search-box">
              <input 
                v-model="tool_search_query" 
                type="text" 
                :placeholder="t('tool_search_placeholder')" 
                class="tool-search-input"
              />
            </div>

            <div class="tools-list">
              <div 
                v-for="(tool, t_idx) in filtered_tools" 
                :key="t_idx" 
                class="tool-item" 
                @click="show_tool_detail(tool)"
                :title="tool.function.name"
              >
                <span class="tool-icon">⚡</span>
                <div class="tool-info">
                  <div class="tool-name">{{ tool.function.name }}</div>
                  <div class="tool-desc">{{ tool.function.description || t('tool_desc_empty') }}</div>
                </div>
              </div>
            </div>

            <!-- 搜索过滤结果为空时的状态 -->
            <div v-if="filtered_tools.length === 0" class="tool-empty-state">
              {{ t('tool_empty') }}
            </div>
          </aside>
        </div>
      </div>

      <!-- 无活跃会话时的默认欢迎页面（已去除对话框卡片样式，改为平铺状态） -->
      <div v-else class="welcome-container">
        <div class="welcome-card glass-panel">
          <!-- 悬浮发光的能量核心 Logo 结构 -->
          <div class="welcome-logo-wrapper">
            <div class="logo-orbit-ring ring-1"></div>
            <div class="logo-orbit-ring ring-2"></div>
            <div class="welcome-icon-glow">
              <span class="welcome-icon">⚡</span>
            </div>
          </div>
          <h2>{{ t('welcome_title') }}</h2>
          <p class="welcome-description">{{ t('welcome_desc') }}</p>
          <div class="info-badges-grid">
            <!-- 服务地址卡片 -->
            <div class="info-badge-card glass-panel">
              <div class="badge-card-header">
                <span class="badge-label">📡 {{ t('welcome_server') }}</span>
                <!-- 复制成功时的状态反馈提示 -->
                <transition name="fade-scale">
                  <span v-if="copy_success" class="copy-tooltip">{{ t('copy_success_text') }}</span>
                </transition>
              </div>
              <div class="badge-value-wrapper">
                <span class="badge-value highlight">{{ server_url }}/v1/chat/completions</span>
                <button 
                  class="btn-copy" 
                  @click="copy_address_to_clipboard" 
                  :title="t('copy_title')"
                  role="button"
                >
                  📋
                </button>
              </div>
            </div>
            <!-- WS 连接状态卡片 -->
            <div class="info-badge-card glass-panel">
              <span class="badge-label">⚡ {{ t('welcome_ws') }}</span>
              <div class="badge-value-wrapper">
                <span class="badge-value" :class="{ 'connected': ws_status === 'connected', 'disconnected': ws_status !== 'connected' }">
                  <!-- 呼吸灯 -->
                  <span class="status-glow-dot" :class="ws_status"></span>
                  {{ ws_status === 'connected' ? t('welcome_ws_connected') : t('welcome_ws_disconnected') }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
    <!-- 工具函数详细信息弹窗 (已拓宽一倍，双栏布局) -->
    <transition name="fade-scale">
      <div v-if="show_modal && selected_tool" class="modal-backdrop" @click="close_tool_modal">
        <div class="modal-card glass-panel" @click.stop>
          <header class="modal-card-header">
            <span class="modal-title">🛠️ {{ t('modal_title') }}</span>
            <button class="btn-close-modal" @click="close_tool_modal">✕</button>
          </header>
          <section class="modal-card-body split-body">
            <!-- 左栏：基本元数据与函数描述 -->
            <div class="modal-body-left">
              <div class="detail-row">
                <span class="detail-label">{{ t('modal_type') }}</span>
                <span class="detail-value-badge">{{ selected_tool.type }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">{{ t('modal_name') }}</span>
                <span class="detail-value highlight">{{ selected_tool.function.name }}</span>
              </div>
              <div class="detail-row flex-column">
                <span class="detail-label">{{ t('modal_desc') }}</span>
                <pre class="detail-text-box">{{ selected_tool.function.description || t('tool_desc_none') }}</pre>
              </div>
            </div>
            <!-- 右栏：参数结构 Schema -->
            <div class="modal-body-right">
              <div class="detail-row flex-column h-100">
                <span class="detail-label">{{ t('modal_params') }}</span>
                <pre class="code-box-json">{{ format_json(selected_tool.function.parameters) }}</pre>
              </div>
            </div>
          </section>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import eve_avatar from './assets/eve_avatar.png';



// 会话数据状态列表
const sessions = ref([]);
// 当前处于激活状态的会话ID
const active_session_id = ref('');
// 检索关键词
const search_query = ref('');
// 保存各个会话的未发送输入草稿，键为 session_id，值为文本字符串
const draft_replies = ref({});
// WebSocket 连接状态: 'connecting', 'connected', 'disconnected'
const ws_status = ref('disconnected');
// 对话历史滚动容器引用
const history_container = ref(null);
// 标记当前是否正在向后端发送数据流，发送中进行界面锁定
const is_submitting = ref(false);
// 绑定编辑框的 DOM 引用
const reply_input = ref(null);

// 选中的工具函数，用于弹窗详细信息展示
const selected_tool = ref(null);
// 控制工具详情弹窗的开启与关闭
const show_modal = ref(false);

// 左右侧边栏初始宽度（单位：像素）
const left_sidebar_width = ref(340);
const right_sidebar_width = ref(280);
// 工具过滤检索词
const tool_search_query = ref('');

// 存储已被展开的消息的标识，键为 session_id + '_' + index
const expanded_messages = ref({});
// 存储是否需要显示展开按钮的标识，键为 session_id + '_' + index
const overflowed_messages = ref({});

// 语言选项显隐状态
const show_lang_menu = ref(false);
// 语言模式: 'auto' | 'zh' | 'en'
const lang_mode = ref('auto');

// 复制操作成功状态标识
const copy_success = ref(false);

// 动态获取当前服务的 HTTP 地址前缀
const server_url = computed(() => {
  const current_port = window.location.port ? `:${window.location.port}` : '';
  return `${window.location.protocol}//${window.location.hostname}${current_port}`;
});

// 用于会话隔离绑定的 API Key
const bind_key = ref('');
// 切换 Key 密文可见性状态
const show_key_text = ref(false);

/**
 * 保存并应用 API Key 隔离绑定，重连 WebSocket 建立专有接管通道
 */
function apply_key_binding() {
  const clean_key = bind_key.value.trim();
  localStorage.setItem('fake_model_bind_key', clean_key);
  console.log(`API Key 绑定已保存为 "${clean_key ? clean_key.substring(0, 8) + '...' : '空'}"，正在重连服务...`);
  
  if (ws_socket) {
    // 标记为手动关闭以避开常规延时重连
    ws_socket.manual_closing = true;
    ws_socket.close();
  }
  // 立即重连，无需等待
  connect_to_server();
}

/**
 * 一键复制 API 服务端地址到系统剪贴板
 */
function copy_address_to_clipboard() {
  const current_port = window.location.port ? `:${window.location.port}` : '';
  const current_url = `${window.location.protocol}//${window.location.hostname}${current_port}/v1/chat/completions`;
  navigator.clipboard.writeText(current_url)
    .then(() => {
      copy_success.value = true;
      // 输出中文日志以记录操作状态
      console.log("服务器地址已复制到剪切板。");
      // 1.5 秒后清除成功提示状态
      setTimeout(() => {
        copy_success.value = false;
      }, 1500);
    })
    .catch((err) => {
      // 输出中文日志以记录复制失败状态
      console.error('复制失败：', err);
    });
}

// 国际化文本对照字典
const locales = {
  zh: {
    status_connected: "服务已连接",
    status_connecting: "正在连接服务...",
    status_disconnected: "服务已断开",
    clear_records: "清空记录",
    clear_records_title: "清空本地所有历史对话记录",
    search_placeholder: "搜索对话记录...",
    no_sessions: "暂无相关对话记录",
    session_label: "会话",
    stream_badge: "流式",
    delete_session_title: "删除该会话记录",
    status_waiting: "等待回复",
    status_active: "对话中...",
    status_ended: "已结束",
    mode_prefix: "模式:",
    mode_sse: "SSE 流式传输",
    mode_json: "标准 JSON",
    btn_terminate: "结束该会话",
    alert_waiting: "系统挂起中：正在等待您输入回复以响应客户端...",
    alert_ended: "ℹ️ 该会话已结束 (连接已关闭)。",
    input_placeholder: "请输入您要回复的内容... (Enter 发送，Ctrl+Enter 发送并结束，编辑框为空时直接结束会话)",
    tools_title: "挂载的工具函数",
    tool_search_placeholder: "过滤工具函数...",
    tool_desc_empty: "无详细描述说明",
    tool_empty: "无匹配的工具函数",
    welcome_title: "FakeModel 控制中心",
    welcome_desc: "当前无待处理的 API 请求。当有新的 OpenAI API 请求到达 Server 服务时，系统将在此处自动开启一个新的 tab 页进行实时人工接管回复。",
    welcome_server: "服务地址",
    welcome_ws: "WS 连接",
    welcome_ws_connected: "正常",
    welcome_ws_disconnected: "未连接",
    modal_title: "工具函数详情",
    modal_type: "类型 (Type)",
    modal_name: "函数名 (Name)",
    modal_desc: "函数说明 (Description)",
    tool_desc_none: "暂无说明",
    modal_params: "参数格式 (Parameters Schema)",
    btn_collapse: "收起 ⬆",
    btn_expand: "全部展开 ⬇",
    role_ai: "假装是AI",
    role_system: "系统消息",
    role_user: "客户端用户",
    confirm_clear_all: "确定要清空所有的历史对话记录吗？",
    menu_language: "显示语言",
    lang_auto: "自动 (Auto)",
    lang_zh: "中文 (Chinese)",
    lang_en: "English (English)",
    unknown_model: "未知模型",
    copy_success_text: "已成功复制到剪贴板！",
    copy_title: "一键复制服务地址",
    bind_key_label: "API Key 隔离绑定",
    bind_key_placeholder: "输入用于隔离的 API Key...",
    btn_apply_key: "应用",
    status_key_bound: "Key 隔离",
    status_ip_bound: "IP 隔离"
  },
  en: {
    status_connected: "Service Connected",
    status_connecting: "Connecting to Service...",
    status_disconnected: "Service Disconnected",
    clear_records: "Clear History",
    clear_records_title: "Clear all local history conversation records",
    search_placeholder: "Search chat logs...",
    no_sessions: "No related chat records found",
    session_label: "Session",
    stream_badge: "Stream",
    delete_session_title: "Delete this chat record",
    status_waiting: "Waiting",
    status_active: "In Conversation...",
    status_ended: "Ended",
    mode_prefix: "Mode:",
    mode_sse: "SSE Stream",
    mode_json: "Standard JSON",
    btn_terminate: "End Session",
    alert_waiting: "System suspended: Waiting for your input to reply to the client...",
    alert_ended: "ℹ️ This session has ended (Connection closed).",
    input_placeholder: "Type reply... (Enter to send, Ctrl+Enter to send & end, directly end session if input is empty)",
    tools_title: "Mounted Tools",
    tool_search_placeholder: "Filter tools...",
    tool_desc_empty: "No description provided",
    tool_empty: "No matching tools found",
    welcome_title: "FakeModel Control Panel",
    welcome_desc: "No pending API requests at the moment. When a new OpenAI API request reaches the server, a new tab will automatically open here for real-time manual takeover.",
    welcome_server: "Server Address",
    welcome_ws: "WS Connection",
    welcome_ws_connected: "Normal",
    welcome_ws_disconnected: "Not Connected",
    modal_title: "Tool Details",
    modal_type: "Type",
    modal_name: "Name",
    modal_desc: "Description",
    tool_desc_none: "No description available",
    modal_params: "Parameters Schema",
    btn_collapse: "Collapse ⬆",
    btn_expand: "Expand All ⬇",
    role_ai: "Pretend as AI",
    role_system: "System Message",
    role_user: "Client User",
    confirm_clear_all: "Are you sure you want to clear all history chat logs?",
    menu_language: "Display Language",
    lang_auto: "Auto (Auto)",
    lang_zh: "中文 (Chinese)",
    lang_en: "English (English)",
    unknown_model: "unknown",
    copy_success_text: "Copied to clipboard!",
    copy_title: "Copy Server Address",
    bind_key_label: "API Key Binding",
    bind_key_placeholder: "Enter API Key...",
    btn_apply_key: "Apply",
    status_key_bound: "Key Mode",
    status_ip_bound: "IP Mode"
  }
};

// 计算属性：判定当前实际生效的语言代码 ('zh' 或 'en')
const current_lang = computed(() => {
  if (lang_mode.value === 'auto') {
    const browser_lang = navigator.language || navigator.userLanguage || 'zh';
    return browser_lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  return lang_mode.value;
});

// 监听当前语言的变化，动态同步更新浏览器标签页的网页标题
watch(current_lang, (new_lang) => {
  document.title = t('welcome_title');
}, { immediate: true });

/**
 * 翻译检索辅助宏函数
 * @param {string} key 翻译索引键
 * @returns {string} 本地化文本内容
 */
function t(key) {
  const lang = current_lang.value;
  return locales[lang][key] || locales['zh'][key] || key;
}

/**
 * 切换右上角多语言设置菜单显隐状态
 */
function toggle_lang_menu() {
  show_lang_menu.value = !show_lang_menu.value;
  if (show_lang_menu.value) {
    nextTick(() => {
      window.addEventListener('click', close_lang_menu_globally);
    });
  }
}

/**
 * 全局点击遮罩外侧关闭下拉菜单
 */
function close_lang_menu_globally() {
  show_lang_menu.value = false;
  window.removeEventListener('click', close_lang_menu_globally);
}

/**
 * 前端语言切换触发并写入本地存储持久化
 * @param {string} mode 语言选择 ('auto' | 'zh' | 'en')
 */
function change_language(mode) {
  lang_mode.value = mode;
  localStorage.setItem('fake_model_lang_mode', mode);
  show_lang_menu.value = false;
  window.removeEventListener('click', close_lang_menu_globally);
}




// 用于暂存消息 DOM 的引用字典，键为 session_id + '_' + index
const message_texts_map = {};

/**
 * 收集消息气泡 DOM 元素引用
 * @param {Element} el DOM 元素
 * @param {string} key 唯一键
 */
function set_message_text_ref(el, key) {
  if (el) {
    message_texts_map[key] = el;
  } else {
    delete message_texts_map[key];
  }
}

/**
 * 判断某条消息是否应当处于展开状态
 * 规则：如果用户手动设置过展开/折叠，以用户的设置为主；
 * 否则，如果它是当前会话的最后一条消息，则默认展开；
 * 其它消息默认折叠（收起）。
 * @param {string} session_id 会话ID
 * @param {number} index 消息索引值
 * @returns {boolean} 是否展开
 */
function is_message_expanded(session_id, index) {
  const key = `${session_id}_${index}`;
  if (expanded_messages.value[key] !== undefined) {
    return expanded_messages.value[key];
  }
  const session = sessions.value.find(s => s.session_id === session_id);
  if (session && session.messages) {
    return index === session.messages.length - 1;
  }
  return false;
}

/**
 * 切换消息折叠展开状态
 * @param {string} session_id 会话ID
 * @param {number} index 消息索引值
 */
function toggle_message_expand(session_id, index) {
  const key = `${session_id}_${index}`;
  // 切换用户的显式展开意图
  expanded_messages.value[key] = !is_message_expanded(session_id, index);
}

/**
 * 动态检测消息内容高度，判定是否超出行数限制而产生溢出
 */
function check_messages_overflow() {
  nextTick(() => {
    if (!current_session.value) return;
    const session_id = current_session.value.session_id;
    current_session.value.messages.forEach((msg, index) => {
      const key = `${session_id}_${index}`;
      const el = message_texts_map[key];
      if (el) {
        // 为了在任何展开/折叠状态下都能准确判定在折叠状态时是否溢出，
        // 临时为没有 collapsed 的元素追加 collapsed 样式类来进行一次 clientHeight 高度探测
        const was_collapsed = el.classList.contains('collapsed');
        if (!was_collapsed) {
          el.classList.add('collapsed');
        }
        
        const has_overflow = el.scrollHeight > el.clientHeight;
        
        if (!was_collapsed) {
          el.classList.remove('collapsed');
        }
        
        overflowed_messages.value[key] = has_overflow;
      }
    });
  });
}

/**
 * 格式化 JSON 数据用于页面美观展示
 * @param {Object} obj JSON 对象
 * @returns {string} 格式化后的字符串
 */
function format_json(obj) {
  if (!obj) return '无参数';
  try {
    return JSON.stringify(obj, null, 2);
  } catch (err) {
    return String(obj);
  }
}

/**
 * 开启并展示工具函数详细信息模态弹窗
 * @param {Object} tool 工具函数对象
 */
function show_tool_detail(tool) {
  selected_tool.value = tool;
  show_modal.value = true;
}

/**
 * 关闭工具函数详细信息模态弹窗
 */
function close_tool_modal() {
  show_modal.value = false;
  selected_tool.value = null;
}

/**
 * 初始化左侧边栏的宽度调整拖拽逻辑
 * @param {MouseEvent} event 鼠标按下事件对象
 */
function init_left_resize(event) {
  event.preventDefault();
  const start_x = event.clientX;
  const start_width = left_sidebar_width.value;

  function handle_mousemove(move_event) {
    const delta_x = move_event.clientX - start_x;
    // 限制宽度范围：200px ~ 600px
    const new_width = Math.max(200, Math.min(600, start_width + delta_x));
    left_sidebar_width.value = new_width;
  }

  function handle_mouseup() {
    window.removeEventListener('mousemove', handle_mousemove);
    window.removeEventListener('mouseup', handle_mouseup);
    // 保存至本地存储以进行持久化恢复
    localStorage.setItem('fake_model_left_sidebar_width', left_sidebar_width.value.toString());
    console.log(`左侧边栏宽度已更新并保存为: ${left_sidebar_width.value}px`);
  }

  window.addEventListener('mousemove', handle_mousemove);
  window.addEventListener('mouseup', handle_mouseup);
}

/**
 * 初始化右侧边栏的宽度调整拖拽逻辑
 * @param {MouseEvent} event 鼠标按下事件对象
 */
function init_right_resize(event) {
  event.preventDefault();
  const start_x = event.clientX;
  const start_width = right_sidebar_width.value;

  function handle_mousemove(move_event) {
    // 拖拽右边栏的左边缘，向左拉（clientX变小）宽度会变大
    const delta_x = start_x - move_event.clientX;
    // 限制宽度范围：200px ~ 600px
    const new_width = Math.max(200, Math.min(600, start_width + delta_x));
    right_sidebar_width.value = new_width;
  }

  function handle_mouseup() {
    window.removeEventListener('mousemove', handle_mousemove);
    window.removeEventListener('mouseup', handle_mouseup);
    // 保存至本地存储以进行持久化恢复
    localStorage.setItem('fake_model_right_sidebar_width', right_sidebar_width.value.toString());
    console.log(`右侧边栏宽度已更新并保存为: ${right_sidebar_width.value}px`);
  }

  window.addEventListener('mousemove', handle_mousemove);
  window.addEventListener('mouseup', handle_mouseup);
}

// 计算属性：根据工具过滤词匹配当前会话下的工具函数
const filtered_tools = computed(() => {
  if (!current_session.value || !current_session.value.tools) {
    return [];
  }
  if (!tool_search_query.value.trim()) {
    return current_session.value.tools;
  }
  const query = tool_search_query.value.toLowerCase();
  return current_session.value.tools.filter(tool => {
    const name = tool.function?.name || '';
    const desc = tool.function?.description || '';
    return name.toLowerCase().includes(query) || desc.toLowerCase().includes(query);
  });
});


// 自动使编辑框获取焦点的辅助函数
function focus_textarea() {
  nextTick(() => {
    if (reply_input.value) {
      reply_input.value.focus();
    }
  });
}

// 保存 WebSocket 对象
let ws_socket = null;

// 获取当前正激活的会话对象
const current_session = computed(() => {
  return sessions.value.find(s => s.session_id === active_session_id.value) || null;
});

// 计算属性：根据搜索关键词过滤会话列表
const filtered_sessions = computed(() => {
  if (!search_query.value.trim()) {
    return sessions.value;
  }
  const query = search_query.value.toLowerCase();
  return sessions.value.filter(session => {
    // 匹配会话ID或任何消息内容
    return session.session_id.toLowerCase().includes(query) || 
           session.messages.some(msg => msg.content.toLowerCase().includes(query));
  });
});

// 监听当前活跃会话的变化，自动将聊天区域滚动到底部
watch(active_session_id, () => {
  scroll_to_bottom();
  check_messages_overflow();
});

// 监听当前活跃会话的消息更新，自动滚动到底部
watch(() => current_session.value?.messages, () => {
  scroll_to_bottom();
  check_messages_overflow();
}, { deep: true });



/**
 * 前端本地主动删除单条会话卡片，并通知后端释放连接
 * @param {string} session_id 会话ID
 */
function delete_session_locally(session_id) {
  // 直接发送 WS 指令给后端删除，前端不私自更新本地，等待后端广播刷新
  if (ws_socket && ws_socket.readyState === WebSocket.OPEN) {
    ws_socket.send(JSON.stringify({
      type: 'delete_session',
      session_id: session_id
    }));
  }
}

/**
 * 前端清空所有历史对话记录，并通知后端释放所有挂起连接
 */
function clear_all_sessions_locally() {
  if (confirm(t('confirm_clear_all'))) {
    if (ws_socket && ws_socket.readyState === WebSocket.OPEN) {
      ws_socket.send(JSON.stringify({
        type: 'clear_all_sessions'
      }));
    }
  }
}

/**
 * 自动滚动对话历史视图区域至底部以显示最新消息
 */
function scroll_to_bottom() {
  nextTick(() => {
    if (history_container.value) {
      history_container.value.scrollTop = history_container.value.scrollHeight;
    }
  });
}

/**
 * 提取会话的最新一条用户消息作为列表卡片的预览摘要
 * @param {Object} session 会话对象
 * @returns {string} 消息摘要
 */
function get_session_preview(session) {
  if (!session.messages || session.messages.length === 0) {
    return '暂无消息内容';
  }
  // 查找最后一条用户消息
  const user_messages = session.messages.filter(m => m.role === 'user');
  if (user_messages.length > 0) {
    return user_messages[user_messages.length - 1].content;
  }
  return session.messages[session.messages.length - 1].content;
}

/**
 * 前端手动切换并选中会话卡片
 * @param {string} session_id 会话ID
 */
function select_session(session_id) {
  active_session_id.value = session_id;
  // 切换 Tab 时重置发送状态锁定
  is_submitting.value = false;
  // 如果当前会话没有草稿，则初始化为空
  if (draft_replies.value[session_id] === undefined) {
    draft_replies.value[session_id] = '';
  }
  // 切换会话时自动重置工具搜索词
  tool_search_query.value = '';
  // 切换会话后自动将焦点移回编辑框
  focus_textarea();
}

/**
 * 人工提交回复内容给后端，并清空输入草稿
 * @param {string} session_id 会话ID
 */
function submit_reply(session_id) {
  const content = draft_replies.value[session_id] || '';
  const session = sessions.value.find(s => s.session_id === session_id);
  if (!session || (session.status !== 'waiting' && session.status !== 'active') || is_submitting.value) {
    return;
  }
  if (!content.trim() || !ws_socket || ws_socket.readyState !== WebSocket.OPEN) {
    return;
  }

  // 开启发送状态锁，避免流式响应中重复发送
  is_submitting.value = true;

  // 发送指令回复给后端
  ws_socket.send(JSON.stringify({
    type: 'send_reply',
    session_id: session_id,
    content: content
  }));

  // 发送后清空当前会话的草稿
  draft_replies.value[session_id] = '';
}

/**
 * 人工提交回复内容给后端，并立刻结束当前会话 (支持 ctrl+enter 触发)
 * 如果编辑框为空，则不发送回复直接结束会话
 * @param {string} session_id 会话ID
 */
function submit_reply_and_end(session_id) {
  const content = draft_replies.value[session_id] || '';
  const session = sessions.value.find(s => s.session_id === session_id);
  if (!session || (session.status !== 'waiting' && session.status !== 'active') || is_submitting.value) {
    return;
  }

  if (!content.trim()) {
    // 编辑框为空，不发送消息直接结束会话
    terminate_session(session_id);
  } else {
    // 编辑框不为空，先提呈回复，再结束会话
    submit_reply(session_id);
    
    // TCP 在 WS 链路上保序，延迟 50ms 触发以确保先后到达更稳健
    setTimeout(() => {
      terminate_session(session_id);
    }, 50);
  }
}

/**
 * 手动强制结束当前挂起的 API 会话请求
 * @param {string} session_id 会话ID
 */
function terminate_session(session_id) {
  if (!ws_socket || ws_socket.readyState !== WebSocket.OPEN) {
    return;
  }

  // 发送结束指令给后端
  ws_socket.send(JSON.stringify({
    type: 'end_session',
    session_id: session_id
  }));
}

/**
 * 建立与 Server 的 WebSocket 双向通信通道，并挂载消息监听器
 */
function connect_to_server() {
  ws_status.value = 'connecting';
  
  // 动态使用当前网页的端口建立 WS 连接
  const key_param = bind_key.value.trim() ? `?key=${encodeURIComponent(bind_key.value.trim())}` : '';
  const current_port = window.location.port ? `:${window.location.port}` : '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws_socket = new WebSocket(`${protocol}//${window.location.hostname}${current_port}${key_param}`);

  ws_socket.onopen = () => {
    console.log("WebSocket 成功连接到 FakeModel 服务端！");
    ws_status.value = 'connected';
  };

  ws_socket.onmessage = (event) => {
    try {
      const message_data = JSON.parse(event.data);
      handle_ws_message(message_data);
    } catch (err) {
      console.error("处理服务端 WS 消息发生解析错误:", err);
    }
  };

  const socket_instance = ws_socket;
  ws_socket.onclose = () => {
    // 如果是手动关闭，则跳过常规重连（因为手动关闭逻辑中已经立即重连了）
    if (socket_instance && socket_instance.manual_closing) {
      return;
    }
    console.log("WebSocket 连接已断开，1秒后尝试重连...");
    ws_status.value = 'disconnected';
    setTimeout(connect_to_server, 1000);
  };

  ws_socket.onerror = (err) => {
    console.error("WebSocket 发生通信错误:", err);
  };
}

/**
 * 处理从后端推送过来的各类 WebSocket 指令消息
 * @param {Object} message_data 解析后的消息载荷
 */
function handle_ws_message(message_data) {
  const { type } = message_data;

  if (type === 'session_list') {
    // 纯后端状态驱动：直接覆盖本地会话列表，不进行 localStorage 合并
    sessions.value = message_data.sessions || [];
    
    // 如果当前选中的 active_session_id 在最新列表中已经不存在，重置为空
    if (active_session_id.value && !sessions.value.some(s => s.session_id === active_session_id.value)) {
      active_session_id.value = '';
    }
    
    // 如果没有选中的 tab 且有活跃会话，默认激活第一个等待回复的会话
    if (!active_session_id.value && sessions.value.length > 0) {
      const waiting_session = sessions.value.find(s => s.status === 'waiting');
      if (waiting_session) {
        select_session(waiting_session.session_id);
      } else {
        select_session(sessions.value[0].session_id);
      }
    }
  } else if (type === 'new_session') {
    // 新对话创建：追加或覆盖会话，并自动切换到当前会话
    const exists = sessions.value.some(s => s.session_id === message_data.session.session_id);
    if (!exists) {
      sessions.value.push(message_data.session);
    } else {
      const index = sessions.value.findIndex(s => s.session_id === message_data.session.session_id);
      sessions.value.splice(index, 1, message_data.session);
    }
    select_session(message_data.session.session_id);
    scroll_to_bottom();
  } else if (type === 'session_updated') {
    // 对话更新：替换或合并消息列表
    const index = sessions.value.findIndex(s => s.session_id === message_data.session.session_id);
    if (index !== -1) {
      sessions.value.splice(index, 1, message_data.session);
    } else {
      sessions.value.push(message_data.session);
    }
    
    // 如果是当前选中的会话更新且完成了等待状态（流式传输结束），释放发送状态锁
    if (message_data.session.session_id === active_session_id.value && !message_data.session.is_waiting) {
      is_submitting.value = false;
    }

    // 如果有新的请求更新，并且处于 waiting 状态，自动激活该 tab 页并解锁
    if (message_data.session.status === 'waiting') {
      select_session(message_data.session.session_id);
      is_submitting.value = false;
    }
    scroll_to_bottom();
  } else if (type === 'client_disconnected') {
    // 客户端主动断开连接
    const index = sessions.value.findIndex(s => s.session_id === message_data.session_id);
    if (index !== -1) {
      const updated_session = {
        ...sessions.value[index],
        status: 'disconnected',
        is_waiting: false
      };
      sessions.value.splice(index, 1, updated_session);
    }
    // 如果是当前选中的会话断开了，释放可能处于发送中的锁，允许重置输入框状态
    if (message_data.session_id === active_session_id.value) {
      is_submitting.value = false;
    }
  }
}

// 组件挂载时首先从本地恢复，并开启 WS
onMounted(() => {
  // 从 localStorage 载入已保存的左右边栏宽度数据
  const saved_left_width = localStorage.getItem('fake_model_left_sidebar_width');
  if (saved_left_width) {
    const parsed = parseInt(saved_left_width, 10);
    if (!isNaN(parsed) && parsed >= 200 && parsed <= 600) {
      left_sidebar_width.value = parsed;
    }
  }

  const saved_right_width = localStorage.getItem('fake_model_right_sidebar_width');
  if (saved_right_width) {
    const parsed = parseInt(saved_right_width, 10);
    if (!isNaN(parsed) && parsed >= 200 && parsed <= 600) {
      right_sidebar_width.value = parsed;
    }
  }

  // 从 localStorage 恢复已保存的语言设置
  const saved_lang_mode = localStorage.getItem('fake_model_lang_mode');
  if (saved_lang_mode) {
    lang_mode.value = saved_lang_mode;
  }

  // 从 localStorage 恢复已保存的 API Key 绑定
  const saved_bind_key = localStorage.getItem('fake_model_bind_key');
  if (saved_bind_key) {
    bind_key.value = saved_bind_key;
  }

  connect_to_server();
});

// 组件卸载时断开连接，释放句柄
onUnmounted(() => {
  if (ws_socket) {
    ws_socket.close();
  }
  window.removeEventListener('click', close_lang_menu_globally);
});
</script>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: #080b13;
  background-image: 
    radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.18) 0px, transparent 55%),
    radial-gradient(at 100% 100%, rgba(167, 139, 250, 0.12) 0px, transparent 55%),
    radial-gradient(at 50% 50%, rgba(244, 114, 182, 0.04) 0px, transparent 60%);
  position: relative;
  overflow: hidden;
}

/* 增加背景极光漫游动画，以达到动感太空体验 */
.app-container::before {
  content: "";
  position: absolute;
  top: -20%;
  left: -20%;
  width: 140%;
  height: 140%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, rgba(167, 139, 250, 0.03) 40%, transparent 70%);
  animation: aurora_float 25s infinite linear;
  pointer-events: none;
  z-index: 1;
}

@keyframes aurora_float {
  0% {
    transform: translate(0, 0) rotate(0deg);
  }
  50% {
    transform: translate(-5%, 5%) rotate(180deg);
  }
  100% {
    transform: translate(0, 0) rotate(360deg);
  }
}

/* 侧边栏样式 */
.sidebar {
  position: relative; /* 为拖拽手柄提供绝对定位参考 */
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  height: 100%;
  z-index: 10; /* 提升层叠上下文层级，确保超出的下拉菜单在 X > 340px 区域不被 main-content 遮挡并能响应事件 */
}

.sidebar-header {
  padding: 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.brand-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo {
  font-size: 28px;
}

.app-title {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #a5b4fc, #c084fc);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.status-indicator {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.status-indicator.connected {
  color: #34d399;
}

.status-indicator.connecting {
  color: #fbbf24;
}

.status-indicator.disconnected {
  color: #f87171;
}

/* 一键清空历史会话按钮 */
.btn-clear-all {
  width: 100%;
  padding: 8px;
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 8px;
  color: #f87171;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
}

.btn-clear-all:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
  color: #fff;
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.2);
}

/* 搜索框 */
.search-box {
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.search-input {
  width: 100%;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  outline: none;
  transition: all 0.3s ease;
}

.search-input:focus {
  border-color: #6366f1;
  background: rgba(255, 255, 255, 0.07);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
}

/* 会话列表卡片 */
.sessions-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  overflow: hidden;
}

.session-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  transform: translateY(-2px);
}

.session-card.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.4);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15);
}

/* 等待回复卡片的闪烁呼吸边框效果 */
.session-card.waiting-card {
  border-color: rgba(245, 158, 11, 0.35);
  animation: waiting_border_glow 2.5s infinite ease-in-out;
}

@keyframes waiting_border_glow {
  0% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.1);
  }
  50% {
    box-shadow: 0 0 12px 2px rgba(245, 158, 11, 0.25);
    border-color: rgba(245, 158, 11, 0.6);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.1);
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.session-label {
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
}

.card-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stream-badge {
  font-size: 10px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
}

/* 单个删除按钮 */
.btn-delete-card {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 12px;
  border-radius: 4px;
  transition: all 0.2s ease;
  opacity: 0; /* 默认隐藏，防杂乱 */
  outline: none;
}

.session-card:hover .btn-delete-card {
  opacity: 1; /* 鼠标移入卡片时显现 */
}

.btn-delete-card:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  transform: scale(1.1);
}

.card-preview {
  font-size: 12px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-footer {
  display: flex;
  justify-content: flex-end;
}

.status-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 0;
  display: flex;
  align-items: center;
  gap: 5px;
}

.status-badge.waiting {
  color: #fbbf24;
}

.status-badge.replied {
  color: #34d399;
}

.status-badge.ended {
  color: #94a3b8;
}

.status-badge.disconnected {
  color: #f87171;
}

.empty-state {
  text-align: center;
  color: #64748b;
  font-size: 13px;
  padding: 40px 0;
}

/* 右侧主聊天区 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-header {
  height: 70px;
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  z-index: 10;
}

.chat-header h3 {
  font-size: 16px;
  color: #fff;
}

.session-meta {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
  display: block;
}

/* 对话历史记录区域 */
.chat-history {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.message-row {
  display: flex;
  gap: 16px;
  max-width: 85%;
}

.message-user {
  align-self: flex-start;
}

.message-assistant {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden; /* 保证子元素圆角不溢出 */
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.vscode-icon {
  width: 20px;
  height: 20px;
}

.system-icon {
  width: 18px;
  height: 18px;
  color: #94a3b8;
}

.avatar-eve {
  background: #0d0e12;
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: 0 0 10px rgba(99, 102, 241, 0.2);
}

.message-user .avatar {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.2);
}

.message-assistant .avatar {
  background: rgba(167, 139, 250, 0.1);
  border-color: rgba(167, 139, 250, 0.2);
}

.message-bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: calc(100% - 52px);
}

.message-sender {
  font-size: 11px;
  color: #64748b;
  padding: 0 4px;
}

.message-assistant .message-sender {
  text-align: right;
}

.message-bubble-body {
  display: flex;
  flex-direction: column;
  padding: 14px 18px;
  border-radius: 16px;
  position: relative;
  transition: all 0.3s ease;
}

.message-user .message-bubble-body {
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  border-top-left-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.message-assistant .message-bubble-body {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
  border-top-right-radius: 2px;
  box-shadow: 0 4px 15px rgba(99, 102, 241, 0.2);
}

.message-text {
  padding: 0;
  margin: 0;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 警示与状态提示条 */
.status-alert {
  padding: 14px 20px;
  border-radius: 10px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 0;
}

.status-alert.waiting {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.status-alert.disconnected {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.status-alert.ended {
  background: rgba(148, 163, 184, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}

.pulsate-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #fbbf24;
  animation: pulsate_keyframe 1.5s infinite ease-in-out;
}

/* 底部输入框与控制区 */
.chat-footer {
  padding: 24px 32px 32px 32px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.input-area {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.reply-textarea {
  width: 100%;
  height: 100px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
  transition: all 0.3s ease;
}

.reply-textarea:focus:not(:disabled):not([readonly]) {
  border-color: #6366f1;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

.reply-textarea[readonly] {
  background: rgba(255, 255, 255, 0.03);
  color: #94a3b8;
  border-color: rgba(99, 102, 241, 0.25);
  cursor: wait;
}

.reply-textarea:disabled {
  background: rgba(255, 255, 255, 0.01);
  color: #4b5563;
  border-color: rgba(255, 255, 255, 0.03);
  cursor: not-allowed;
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 按钮基础样式 */
.btn {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  border: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
}

.btn-primary {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.3);
}

.btn-primary:disabled {
  background: rgba(255, 255, 255, 0.05);
  color: #4b5563;
  box-shadow: none;
  cursor: not-allowed;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.btn-secondary:disabled {
  background: rgba(255, 255, 255, 0.01);
  color: #4b5563;
  border-color: rgba(255, 255, 255, 0.02);
  cursor: not-allowed;
}

.btn-danger {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: #fff;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
}

.btn-danger:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(239, 68, 68, 0.3);
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

/* 欢迎引导页样式（升级为高级玻璃拟态和动感布局） */
.welcome-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  z-index: 2; /* 确保在背景极光层上方 */
}

.welcome-card {
  max-width: 680px;
  width: 100%;
  padding: 50px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  border-radius: 24px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.welcome-card:hover {
  transform: translateY(-4px);
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: 0 24px 60px rgba(99, 102, 241, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

/* 能量核心 Logo 环形动效外框 */
.welcome-logo-wrapper {
  position: relative;
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.welcome-icon-glow {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, rgba(99, 102, 241, 0.05) 70%);
  border: 1px solid rgba(99, 102, 241, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 25px rgba(99, 102, 241, 0.35);
  z-index: 3;
}

.welcome-icon {
  font-size: 38px;
  filter: drop-shadow(0 0 10px rgba(245, 158, 11, 0.8));
  animation: float_icon 3s infinite ease-in-out;
}

/* 轨道环动效 */
.logo-orbit-ring {
  position: absolute;
  border-radius: 50%;
  border: 1.5px dashed rgba(165, 180, 252, 0.3);
  pointer-events: none;
}

.logo-orbit-ring.ring-1 {
  width: 100px;
  height: 100px;
  animation: rotate_orbit_clockwise 12s infinite linear;
  z-index: 1;
}

.logo-orbit-ring.ring-2 {
  width: 88px;
  height: 88px;
  border: 1.2px dotted rgba(244, 114, 182, 0.25);
  animation: rotate_orbit_counter_clockwise 8s infinite linear;
  z-index: 2;
}

@keyframes float_icon {
  0%, 100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-4px) scale(1.05);
  }
}

@keyframes rotate_orbit_clockwise {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes rotate_orbit_counter_clockwise {
  from {
    transform: rotate(360deg);
  }
  to {
    transform: rotate(0deg);
  }
}

.welcome-card h2 {
  font-size: 28px;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #fff 30%, #c7d2fe 70%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.welcome-card .welcome-description {
  font-size: 14.5px;
  line-height: 1.7;
  color: #94a3b8;
  max-width: 520px;
}

/* 双栏自适应网格 */
.info-badges-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  width: 100%;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .info-badges-grid {
    grid-template-columns: 1fr;
  }
}

/* 精致卡片面板 */
.info-badge-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 18px 22px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  text-align: left;
}

.info-badge-card:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(99, 102, 241, 0.2);
  transform: translateY(-2px);
}

.badge-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  position: relative;
}

.badge-label {
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.badge-value-wrapper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}

.badge-value {
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 13px;
  color: #cbd5e1;
  word-break: break-all;
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge-value.highlight {
  color: #a5b4fc;
}

/* 复制按钮样式 */
.btn-copy {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 12px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-copy:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.35);
  color: #fff;
  transform: scale(1.05);
}

.btn-copy:active {
  transform: scale(0.95);
}

/* 气泡文字提示样式 */
.copy-tooltip {
  position: absolute;
  right: 0;
  bottom: 0;
  font-size: 11px;
  color: #34d399;
  background: rgba(52, 211, 153, 0.1);
  border: 1px solid rgba(52, 211, 153, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

/* 状态呼吸灯核心样式 */
.status-glow-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.status-glow-dot.connected {
  background-color: #34d399;
  box-shadow: 0 0 10px #34d399;
  animation: glow_pulse_green 2s infinite ease-in-out;
}

.status-glow-dot.disconnected, .status-glow-dot.connecting {
  background-color: #f87171;
  box-shadow: 0 0 10px #f87171;
  animation: glow_pulse_red 2s infinite ease-in-out;
}

@keyframes glow_pulse_green {
  0%, 100% {
    opacity: 0.6;
    box-shadow: 0 0 4px rgba(52, 211, 153, 0.4);
  }
  50% {
    opacity: 1;
    box-shadow: 0 0 12px rgba(52, 211, 153, 0.85);
  }
}

@keyframes glow_pulse_red {
  0%, 100% {
    opacity: 0.6;
    box-shadow: 0 0 4px rgba(248, 113, 113, 0.4);
  }
  50% {
    opacity: 1;
    box-shadow: 0 0 12px rgba(248, 113, 113, 0.85);
  }
}

/* 新增：会话卡片上的模型与工具 Meta 信息 */
.card-meta-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed rgba(255, 255, 255, 0.04);
}

.meta-model {
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #a5b4fc;
}

.meta-tools {
  background: rgba(99, 102, 241, 0.15);
  color: #c084fc;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
  border: 1px solid rgba(99, 102, 241, 0.2);
}

/* 新增：聊天区域左右分栏布局 */
.chat-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 新增：右侧工具函数侧边栏 */
.tools-sidebar {
  position: relative; /* 为拖拽手柄提供绝对定位参考 */
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(11, 15, 25, 0.4);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  padding: 24px 20px;
  overflow-y: auto;
  gap: 16px;
}

.sidebar-section-title {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #a5b4fc, #c084fc);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-item {
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tool-item:hover {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
  transform: translateY(-2px);
}

.tool-icon {
  font-size: 14px;
  color: #f59e0b;
  margin-top: 2px;
}

.tool-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-desc {
  font-size: 11px;
  color: #64748b;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
}

/* 新增：工具详情模态弹窗 */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(5, 8, 15, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  width: 1200px; /* 宽度增加一倍 */
  max-width: 95%; /* 在较小屏幕上限制最大宽度 */
  max-height: 85vh;
  border-radius: 16px;
  background: rgba(17, 24, 39, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-card-header {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
}

.btn-close-modal {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 18px;
  cursor: pointer;
  transition: color 0.2s ease;
  outline: none;
}

.btn-close-modal:hover {
  color: #fff;
}

.modal-card-body {
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 工具弹窗双栏分屏样式 */
.modal-card-body.split-body {
  display: flex;
  flex-direction: row;
  gap: 24px;
  overflow: hidden;
  height: 100%;
}

.modal-body-left {
  flex: 4;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding-right: 8px;
}

.modal-body-right {
  flex: 6;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.modal-body-right .h-100 {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.modal-body-right .code-box-json {
  flex: 1;
  max-height: none;
  margin: 0;
  overflow-y: auto;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-row.flex-column {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.detail-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  min-width: 90px;
}

.detail-value-badge {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: #cbd5e1;
}

.detail-value.highlight {
  font-family: monospace;
  font-size: 14px;
  color: #f472b6;
  font-weight: 600;
}

.detail-text-box {
  width: 100%;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  color: #cbd5e1;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: inherit;
}

.code-box-json {
  width: 100%;
  max-height: 250px;
  overflow-y: auto;
  background: #090d16;
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 14px;
  border-radius: 8px;
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 12px;
  color: #34d399;
  line-height: 1.5;
  white-space: pre-wrap;
}

/* 动效 */
.fade-scale-enter-active, .fade-scale-leave-active {
  transition: all 0.3s ease;
}

.fade-scale-enter-from, .fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* 拖拽手柄样式 */
.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 100;
  transition: background-color 0.25s ease;
}

.resize-handle:hover {
  background-color: rgba(99, 102, 241, 0.4);
}

.left-handle {
  right: -3px; /* 左侧边栏的右边界 */
}

.right-handle {
  left: -3px; /* 右侧边栏的左边界 */
}

/* 工具函数搜索与过滤 */
.tool-search-box {
  width: 100%;
  padding-bottom: 8px;
}

.tool-search-input {
  width: 100%;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  outline: none;
  transition: all 0.25s ease;
}

.tool-search-input:focus {
  border-color: #a5b4fc;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 0 0 2px rgba(165, 180, 252, 0.2);
}

.tool-empty-state {
  text-align: center;
  color: #64748b;
  font-size: 12px;
  padding: 24px 0;
}

/* 消息最大行数限制与溢出控制 */
.message-text.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 8; /* 默认最大显示 8 行 */
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 融合式折叠渐变遮罩 */
.message-text-fade-mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 65px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding-right: 18px;
  padding-bottom: 8px;
  cursor: pointer;
  border-bottom-left-radius: 16px;
  border-bottom-right-radius: 16px;
  transition: all 0.3s ease;
}

/* 消息泡泡底部圆角自适应 */
.message-user .message-text-fade-mask {
  border-bottom-left-radius: 2px;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, rgba(15, 23, 42, 0.85) 50%, rgba(15, 23, 42, 0.98) 100%);
}

.message-assistant .message-text-fade-mask {
  border-bottom-right-radius: 2px;
  background: linear-gradient(to bottom, rgba(99, 102, 241, 0) 0%, rgba(79, 70, 229, 0.85) 50%, rgba(79, 70, 229, 0.98) 100%);
}

/* 遮罩上的文字链接 */
.btn-toggle-link {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  padding: 2px 0;
  transition: all 0.2s ease;
  background: transparent !important;
  border: none !important;
}

.message-user .btn-toggle-link {
  color: rgba(255, 255, 255, 0.5);
}

.message-user .message-text-fade-mask:hover .btn-toggle-link {
  color: #a5b4fc;
}

.message-assistant .btn-toggle-link {
  color: rgba(255, 255, 255, 0.7);
}

.message-assistant .message-text-fade-mask:hover .btn-toggle-link {
  color: #fff;
}

/* 展开状态下的内联收起按钮 */
.btn-toggle-expand-inline {
  background: transparent;
  border: none;
  box-shadow: none;
  align-self: flex-end;
  margin-top: 8px;
  padding: 2px 0;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  outline: none;
}

.message-user .btn-toggle-expand-inline {
  color: rgba(255, 255, 255, 0.4);
}

.message-user .btn-toggle-expand-inline:hover {
  color: #a5b4fc;
}

.message-assistant .btn-toggle-expand-inline {
  color: rgba(255, 255, 255, 0.7);
}

.message-assistant .btn-toggle-expand-inline:hover {
  color: #fff;
}

/* 品牌头部右上角布局重构 */
.brand-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.lang-settings-container {
  position: relative;
}

.btn-more-options {
  background: transparent;
  border: none;
  box-shadow: none;
  color: #64748b;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.btn-more-options:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

/* 一级下拉菜单：定位在按钮正右下方 */
.lang-dropdown-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: max-content;
  min-width: 200px; /* 自适应且保证足够宽度防英文换行 */
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 200;
  backdrop-filter: blur(16px);
}

/* 一级菜单项 */
.dropdown-menu-item {
  color: #94a3b8;
  font-size: 13px;
  text-align: left;
  padding: 10px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;
  box-sizing: border-box;
  display: block; /* 设为 block 布局，消除 flex 带来的 left 定位偏差 */
  position: relative; /* 确保子菜单的 100% 宽度物理定位准确 */
  user-select: none;
  white-space: nowrap; /* 防长词换行 */
}

/* 一级项悬停或二级菜单激活时高亮 */
.dropdown-menu-item:hover,
.dropdown-menu-item.hover_active {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.dropdown-menu-item.has-submenu {
  position: relative;
}

.menu-item-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 16px;
}

.submenu-arrow {
  font-size: 10px;
  color: #64748b;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 鼠标悬停在一级菜单项时，箭头旋转动效 */
.dropdown-menu-item:hover .submenu-arrow {
  transform: rotate(90deg);
  color: #fff;
}

/* 二级子菜单面板：在右侧贴合展示，微重叠 2px 消除滑动间隙 */
.lang-submenu-menu {
  display: none; /* 默认隐藏，由下方 hover 规则驱动显示 */
  position: absolute;
  top: 0;
  left: calc(100% - 2px); /* 无缝紧贴重合，消除 8px/4px 间隙导致的 mouseleave Bug */
  width: max-content;
  min-width: 180px; /* 自适应英文宽度 */
  background: rgba(15, 23, 42, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  box-shadow: 10px 10px 25px -5px rgba(0, 0, 0, 0.6);
  padding: 6px;
  flex-direction: column;
  gap: 4px;
  z-index: 300;
  backdrop-filter: blur(16px);
}

/* 鼠标悬停在一级菜单项上时，显示二级菜单 */
.dropdown-menu-item:hover .lang-submenu-menu {
  display: flex;
}

/* 二级菜单项 */
.dropdown-submenu-item {
  color: #94a3b8;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  user-select: none;
  white-space: nowrap;
}

.dropdown-submenu-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.dropdown-submenu-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: #a5b4fc;
  font-weight: 600;
}

.check-mark-box {
  width: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: bold;
  color: #a5b4fc;
}

/* API Key 隔离绑定面板玻璃态样式 */
.key-binding-panel {
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.key-panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  margin-bottom: 8px;
}

.key-mode-badge {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
}

.key-mode-badge.bound {
  background: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.25);
}

.key-mode-badge.ip-mode {
  background: rgba(52, 211, 153, 0.1);
  color: #34d399;
  border: 1px solid rgba(52, 211, 153, 0.15);
}

.key-input-row {
  display: flex;
  gap: 8px;
}

.key-input-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}

.key-input {
  width: 100%;
  padding: 6px 28px 6px 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: #fff;
  font-size: 11px;
  outline: none;
  transition: all 0.3s ease;
}

.key-input:focus {
  border-color: #6366f1;
  background: rgba(0, 0, 0, 0.3);
}

.btn-toggle-eye {
  position: absolute;
  right: 8px;
  cursor: pointer;
  font-size: 11px;
  user-select: none;
  opacity: 0.6;
  transition: opacity 0.2s ease;
}

.btn-toggle-eye:hover {
  opacity: 1;
}

.btn-apply-key {
  padding: 6px 10px;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 6px;
  color: #a5b4fc;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
}

.btn-apply-key:hover {
  background: rgba(99, 102, 241, 0.3);
  border-color: #6366f1;
  color: #fff;
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
}
</style>
