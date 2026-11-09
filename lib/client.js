/**
 * dsh-topic-graph — 会话话题图谱（Client 半）
 *
 * dsh 模块加载器的私有 bundle 格式：window.__ModuleLoader__.load({ id, factory })。
 * factory 是浏览器 CJS 形状，必须自行声明 module/exports；react 由 shell 提供。
 *
 * 注册进 conversation.view（session 级 list 槽位，「对话 / 轨迹」之后的新视图），
 * 渲染一个可拖动 / 可缩放 / 可收起的悬浮窗，含两个 Tab：
 *   1. 链式：阶段 → 话题（含子话题）→ 轮次明细（token、工具、Agent 耗时与占比）；
 *   2. 图谱：阶段 / 话题 / 子话题的树状图，Ctrl+滚轮缩放、滚轮上下滚动、
 *      鼠标悬停显示完整信息。
 *
 * 数据全部来自 Host 半的 /plugins/topic-graph/* 路由；样式只使用
 * --dsw-alias-* 主题 token（带兜底值），跟随明暗主题。
 */
window.__ModuleLoader__.load({
  id: 'dsh-topic-graph',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var useMemo = React.useMemo;
    var useCallback = React.useCallback;
    var h = React.createElement;

    var ROUTE = '/plugins/topic-graph';
    var CLIENT_VERSION = '0.6.42';
    var LOC_NS = 'dsh-topic-graph';
    var UI_KEY = 'dsh-topic-graph.ui.v2';
    var UI_KEY_V1 = 'dsh-topic-graph.ui.v1';
    var DEFAULT_PANEL_W = 900;
    var DEFAULT_PANEL_H = 680;

    // ── 文案（同时注册进 dsh 的 locale 服务） ────────────────────────────────
    var DICT = {
      zh: {
        title: '话题图谱（Topic Graph）',
        panelTitle: '话题',
        tabChain: '话题·工作流',
        tabGraph: '话题·图谱',
        followLatest: '跟随左侧当前会话',
        pickSession: '选择会话',
        noSession: '没有可用的会话',
        loading: '加载中…',
        noTurns: '本会话还没有轮次',
        noTopics: '还没有切分话题',
        segmenting: 'AI 正在切分…',
        waitSegment: '等待 AI 切分',
        pendingTurns: '待切分 {n} 轮',
        aiFailed: 'AI 切分失败',
        retry: '重试',
        segNow: '增量切分',
        resegment: '全部重切',
        collapsed: '已收起',
        expand: '展开',
        collapse: '收起',
        refresh: '刷新',
        zoomIn: '放大',
        zoomOut: '缩小',
        zoomReset: '重置缩放',
        graphHint: 'Ctrl+滚轮缩放 · 滚轮上下滑动 · 悬停看详情',
        modelLabel: '模型',
        modelDefault: '默认（配置）',
        workflowEmpty: '点击左侧话题或阶段查看详情',
        turns: '轮次',
        topics: '话题',
        tokens: 'tokens',
        toolCalls: '工具调用',
        agentTime: 'Agent 耗时',
        stepTime: '步骤活动时间',
        requestCount: '模型调用',
        steps: '步骤',
        statusActive: '进行中',
        statusDone: '已完成',
        statusAborted: '被中断',
        statusError: '出错',
        statusOpen: '运行中',
        sourceLlm: 'AI',
        sourceRule: '规则',
        stage: '阶段',
        topic: '话题',
        subtopics: '子话题',
        tokenBreakdown: 'Token 明细',
        input: '输入',
        output: '输出',
        cacheRead: '缓存读',
        cacheWrite: '缓存写',
        toolErrors: '工具错误',
        prompt: '用户输入',
        assistant: 'AI 回复',
        emptyPrompt: '（无文本输入）',
        toolDistribution: '工具分布',
        range: '轮次',
        ratioOfTotal: '占会话',
        sessionStats: '{turns} 轮 · {topics} 话题 · {tokens} tokens',
        updatedAt: '更新于 {time}',
        aiMode: '切分模式：{mode}',
        noTopicsYet: 'AI 正在为这个会话生成话题结构…',
        ruleFallback: '当前为规则切分（未使用 AI）',
        turnLabel: '轮 {n}',
        openTurn: '进行中',
        sessionPickerSearch: '筛选会话…',
        unnamed: '未命名会话',
        dragHint: '可拖动标题栏移动，右下角拖拽缩放',
        subagent: '子智能体',
        subagents: '子智能体',
        subagentCount: '子智能体 {n}',
        branchTurns: '{n} 轮',
        branchOpen: '查看该子智能体会话',
        backToParent: '返回父会话',
        relations: '关联话题',
        relationFrom: '→ {title} · {label}',
        relationTo: '← {title} · {label}',
        edgeNext: '顺序',
        edgeBelong: '归属',
        edgeRelation: '关联',
        edgeDelegate: '委托',
        parentTopic: '挂靠话题',
        childTopics: '子话题',
        branchTopics: '话题',
        branchPending: '切分中…',
        subagentTotals: '子智能体合计',
        graphLegendNext: 'next 顺序',
        graphLegendBelong: 'belongTo 归属',
        graphLegendRelation: 'has_relation 关联',
        graphModeTimeline: '时间线',
        graphModeTree: '结构图',
        graphLegendDelegate: 'delegates 委托',
        statsBar: '统计',
        statTurns: '轮次',
        statTopics: '话题',
        statStage: '阶段',
        statTokens: 'Token',
        statTools: '工具',
        totalSteps: '总步数',
        jumpToTurn: '跳转到对话',
        expandAll: '全部展开',
        collapseAll: '全部收缩',
        viewWorkflow: '工作流',
        viewGraph: '图谱',
        noSessionTitle: '未选择会话',
        statStepTime: '步骤耗时',
        statWallTime: '总耗时',
        statRelations: '关联',
        stageTopicRelations: '阶段内话题关系',
        settingsTitle: 'Topic Graph',
        settingsDesc: '控制插件后端服务与界面语言。',
        settingsService: '后端服务',
        settingsServiceDesc: '关闭后停止自动切分与 AI 分析，已有数据仍可查看。',
        settingsEnabled: '已启用',
        settingsDisabled: '已停用',
        settingsLanguage: '界面语言',
        settingsLanguageDesc: '选择插件界面语言；「跟随 dsh」使用 dsh 的全局语言。',
        settingsLanguageNote: '切换语言后，已生成的话题/阶段名称不会自动翻译；可点「全部重切」按新语言重新生成。',
        settingsLangAuto: '跟随 dsh',
        settingsLangZh: '中文',
        settingsLangEn: 'English',
        settingsSaved: '已保存',
        settingsSaveFailed: '保存失败',
        disabledBanner: '后端服务已停用',
        disabledHint: '在「设置 → 话题图谱」里重新启用。',
        turnRange: '轮{start}-{end}',
        stepFallback: '步骤',
        stepCountUnit: ' 步',
        parentTurn: '父轮',
        clickSubagentHint: '点击查看该子智能体会话',
        routeNoResponse: '：{route} 无响应',
        aiCostHint: '（仅切分/关系分析，不含主对话）',


        statSubagentTokens: '子智能体 Token',
        detailTitle: '话题详情',
        detailOpen: '查看详情',
        openAtFirstTurn: '在对话中打开首轮',
        locating: '正在定位…',
        located: '已在对话中定位到该轮',
        openedOnly: '已打开会话（历史未完全加载，未能自动定位）',
        detailStage: '所属阶段',
        detailParent: '父话题',
        detailChildren: '子话题',
        detailBranches: '子智能体分支',
        detailRelated: '关联话题',
        detailTurns: '本轮话题的轮次',
        close: '关闭',
        jumpHint: '点击话题打开详情；详情内可跳回该话题首轮',
        collapseStage: '收起阶段下的内容',
        expandStage: '展开阶段下的内容',
        collapseTopic: '收起子话题',
        expandTopic: '展开子话题',
        collapseBranch: '收起分支内的话题',
        expandBranch: '展开分支内的话题',
        statIncludesSubtopic: '统计含子话题',
        aiCost: 'AI 切分消耗',
        aiCallsUnit: '次',
        analyzeTurn: 'AI 分析',
        reanalyzeTurn: '重新分析',
        analyzing: 'AI 分析中…',
        analyzeFailed: 'AI 分析失败',
        howtoTitle: '这一轮做了什么（AI 生成）',
        howtoEmpty: '暂无分析，点「AI 分析」生成一份通俗的分步说明',
        stepTools: '工具',
      },
      en: {
        title: 'Topic Graph',
        panelTitle: 'Topics',
        tabChain: 'Topics · Workflow',
        tabGraph: 'Topics · Graph',
        followLatest: 'Follow sidebar session',
        pickSession: 'Sessions',
        noSession: 'No sessions available',
        loading: 'Loading…',
        modelLabel: 'Model',
        modelDefault: 'Default (config)',
        workflowEmpty: 'Click a topic or stage on the left to see details',
        noTurns: 'This session has no turns yet',
        noTopics: 'No topics segmented yet',
        segmenting: 'AI is segmenting…',
        waitSegment: 'Waiting for AI segmentation',
        pendingTurns: '{n} turns pending',
        aiFailed: 'AI segmentation failed',
        retry: 'Retry',
        segNow: 'Incremental',
        resegment: 'Re-segment all',
        collapsed: 'Collapsed',
        expand: 'Expand',
        collapse: 'Collapse',
        refresh: 'Refresh',
        zoomIn: 'Zoom in',
        zoomOut: 'Zoom out',
        zoomReset: 'Reset zoom',
        graphHint: 'Ctrl+wheel to zoom · wheel to scroll · hover for details',
        turns: 'turns',
        topics: 'topics',
        tokens: 'tokens',
        toolCalls: 'Tool calls',
        agentTime: 'Agent time',
        stepTime: 'Step active time',
        requestCount: 'Model calls',
        steps: 'Steps',
        statusActive: 'Active',
        statusDone: 'Done',
        statusAborted: 'Aborted',
        statusError: 'Error',
        statusOpen: 'Running',
        sourceLlm: 'AI',
        sourceRule: 'Rule',
        stage: 'Stage',
        topic: 'Topic',
        subtopics: 'subtopics',
        tokenBreakdown: 'Token breakdown',
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache read',
        cacheWrite: 'Cache write',
        toolErrors: 'Tool errors',
        prompt: 'User',
        assistant: 'AI',
        emptyPrompt: '(no text input)',
        toolDistribution: 'Tool distribution',
        range: 'Turns',
        ratioOfTotal: 'of session',
        sessionStats: '{turns} turns · {topics} topics · {tokens} tokens',
        updatedAt: 'updated {time}',
        aiMode: 'Mode: {mode}',
        noTopicsYet: 'AI is building the topic structure for this session…',
        ruleFallback: 'Rule-based segmentation (AI not used)',
        turnLabel: 'Turn {n}',
        openTurn: 'running',
        sessionPickerSearch: 'Filter sessions…',
        unnamed: 'Untitled session',
        dragHint: 'Drag the header to move, drag the corner to resize',
        subagent: 'Subagent',
        subagents: 'Subagents',
        subagentCount: '{n} subagents',
        branchTurns: '{n} turns',
        branchOpen: 'Open this subagent session',
        backToParent: 'Back to parent',
        relations: 'Related topics',
        relationFrom: '→ {title} · {label}',
        relationTo: '← {title} · {label}',
        edgeNext: 'next',
        edgeBelong: 'belongTo',
        edgeRelation: 'has_relation',
        edgeDelegate: 'delegates',
        parentTopic: 'attached topic',
        childTopics: 'Subtopics',
        branchTopics: 'topics',
        branchPending: 'segmenting…',
        subagentTotals: 'Subagent totals',
        graphLegendNext: 'next',
        graphLegendBelong: 'belongTo',
        graphLegendRelation: 'has_relation',
        graphModeTimeline: 'Timeline',
        graphModeTree: 'Structure',
        graphLegendDelegate: 'delegates',
        statsBar: 'Stats',
        statTurns: 'Turns',
        statTopics: 'Topics',
        statStage: 'Stages',
        statTokens: 'Tokens',
        statTools: 'Tools',
        totalSteps: 'Steps',
        jumpToTurn: 'Jump to chat',
        expandAll: 'Expand all',
        collapseAll: 'Collapse all',
        viewWorkflow: 'Workflow',
        viewGraph: 'Graph',
        noSessionTitle: 'No session',
        statStepTime: 'Step time',
        statWallTime: 'Wall time',
        statRelations: 'Relations',
        stageTopicRelations: 'Topic relations in this stage',
        settingsTitle: 'Topic Graph',
        settingsDesc: 'Control the plugin backend service and UI language.',
        settingsService: 'Backend service',
        settingsServiceDesc: 'When off, automatic segmentation and AI analysis stop; existing data stays viewable.',
        settingsEnabled: 'Enabled',
        settingsDisabled: 'Disabled',
        settingsLanguage: 'UI language',
        settingsLanguageDesc: 'Language for this plugin. "Follow dsh" uses the dsh global language.',
        settingsLanguageNote: 'Existing topic/stage names are not translated automatically; use "Re-segment all" to regenerate them in the new language.',
        settingsLangAuto: 'Follow dsh',
        settingsLangZh: '中文',
        settingsLangEn: 'English',
        settingsSaved: 'Saved',
        settingsSaveFailed: 'Save failed',
        disabledBanner: 'Backend service is disabled',
        disabledHint: 'Re-enable it in Settings → Topic Graph.',
        turnRange: 'turn {start}-{end}',
        stepFallback: 'Step',
        stepCountUnit: ' steps',
        parentTurn: 'Parent turn',
        clickSubagentHint: 'Click to open this subagent session',
        routeNoResponse: ': {route} not responding',
        aiCostHint: ' (segmentation / relation analysis only, not the main conversation)',


        statSubagentTokens: 'Subagent tokens',
        detailTitle: 'Topic detail',
        detailOpen: 'Details',
        openAtFirstTurn: 'Open first turn in chat',
        locating: 'Locating…',
        located: 'Located in chat',
        openedOnly: 'Session opened (history not fully loaded; could not locate)',
        detailStage: 'Stage',
        detailParent: 'Parent topic',
        detailChildren: 'Subtopics',
        detailBranches: 'Subagent branches',
        detailRelated: 'Related topics',
        detailTurns: 'Turns in this topic',
        close: 'Close',
        jumpHint: 'Click a topic for details; jump to its first turn from there',
        collapseStage: 'Collapse topics in this stage',
        expandStage: 'Expand topics in this stage',
        collapseTopic: 'Collapse subtopics',
        expandTopic: 'Expand subtopics',
        collapseBranch: 'Collapse branch topics',
        expandBranch: 'Expand branch topics',
        statIncludesSubtopic: 'incl. subtopics',
        aiCost: 'AI cost',
        aiCallsUnit: 'calls',
        analyzeTurn: 'AI analyze',
        reanalyzeTurn: 'Re-analyze',
        analyzing: 'Analyzing…',
        analyzeFailed: 'AI analysis failed',
        howtoTitle: 'What this turn did (AI)',
        howtoEmpty: 'No analysis yet. Click "AI analyze" for a plain-language step-by-step.',
        stepTools: 'Tools',
      },
    };

    var localeService = null;
    var translate = null;
    var appCtx = null;

    /**
     * 左侧工作区当前选中的会话由 shell 持久化在 localStorage 的 `dsh.sessions.current`
     * （快照存储的 persist 名称），值形如 { sessionId, subagentAddress? }。
     * 这里只读取这一个公开持久化键，轮询即可跟随左侧切换。
     */
    function readSidebarCurrentSession() {
      try {
        var raw = localStorage.getItem('dsh.sessions.current');
        if (!raw) return null;
        var value = JSON.parse(raw);
        var id = value && (value.sessionId || (value.state && value.state.sessionId));
        return typeof id === 'string' && id ? id : null;
      } catch (error) {
        return null;
      }
    }

    function summarizeText(text, max) {
      var value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
      if (value.length <= max) return value;
      return value.slice(0, max) + '…';
    }

    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /** 找聊天区的滚动容器（从聊天 DOM 反查最近的可滚动祖先，只用于跳转定位）。 */
    function findChatScroller() {
      try {
        var el = document.querySelector('[data-chat-flow]') || document.querySelector('[data-chat-turn]');
        while (el && el !== document.body) {
          var style = null;
          try { style = window.getComputedStyle(el); } catch (error) { style = null; }
          if (style && /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 40) return el;
          el = el.parentElement;
        }
      } catch (error) { /* ignore */ }
      return null;
    }

    /** 尽力把聊天滚到某一轮：轮次未加载时反复滚动顶部触发历史分页。 */
    async function revealChatTurn(turnNumber) {
      if (turnNumber == null) return false;
      for (var attempt = 0; attempt < 16; attempt += 1) {
        var target = null;
        try { target = document.querySelector('[data-chat-turn="' + String(turnNumber) + '"]'); } catch (error) { target = null; }
        if (target) {
          try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (error) { try { target.scrollIntoView(); } catch (e2) { /* ignore */ } }
          return true;
        }
        var scroller = findChatScroller();
        if (scroller) {
          try { scroller.scrollTop = 0; } catch (error) { /* ignore */ }
        }
        await sleep(attempt < 4 ? 220 : 380);
      }
      return false;
    }

    function initLocale(ctx) {
      try {
        var service = typeof ctx.get === 'function' ? ctx.get('locale') : ctx.locale;
        if (service && typeof service.register === 'function') {
          localeService = service;
          service.register(LOC_NS, DICT);
          if (typeof service.bind === 'function') translate = service.bind(LOC_NS);
        }
      } catch (error) {
        localeService = null;
        translate = null;
      }
    }

    function localeId() {
      try {
        if (localeService && typeof localeService.getSnapshot === 'function') {
          var snap = localeService.getSnapshot();
          var active = snap && snap.active ? String(snap.active) : '';
          if (active) return active.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
        }
      } catch (error) { /* 忽略 */ }
      try {
        return String(navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
      } catch (error) {
        return 'zh';
      }
    }

    // ── 设备级设置（启用后端服务 / 界面语言），由「设置 → 话题图谱」读写 ──
    var uiSettings = { enabled: true, uiLocale: 'auto' };
    var uiSettingsLoaded = false;
    var uiSettingsListeners = [];

    function normalizeSettings(data) {
      if (!data || data.ok === false) return null;
      return {
        enabled: data.enabled !== false,
        uiLocale: data.uiLocale === 'zh' || data.uiLocale === 'en' ? data.uiLocale : 'auto',
      };
    }

    function setUiSettings(next) {
      var merged = normalizeSettings(next);
      if (!merged) return;
      uiSettings = merged;
      uiSettingsListeners.slice().forEach(function (fn) { try { fn(); } catch (error) { /* ignore */ } });
    }

    async function fetchUiSettings() {
      var res = await fetch(ROUTE + '/settings');
      if (!res.ok) return null;
      return normalizeSettings(await res.json());
    }

    async function saveUiSettings(patch) {
      var res = await fetch(ROUTE + '/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch || {}),
      });
      var data = await res.json();
      var merged = normalizeSettings(data);
      if (!merged) throw new Error((data && data.error) || 'save failed');
      return merged;
    }

    /** 订阅插件设置：返回当前设置，并在设置页保存后触发重渲染。 */
    function useUiSettings() {
      var state = useState(uiSettings);
      var setter = state[1];
      useEffect(function () {
        var fn = function () { setter(uiSettings); };
        uiSettingsListeners.push(fn);
        fn();
        if (!uiSettingsLoaded) {
          uiSettingsLoaded = true;
          fetchUiSettings().then(function (data) { if (data) setUiSettings(data); }).catch(function () { /* ignore */ });
        }
        return function () {
          var index = uiSettingsListeners.indexOf(fn);
          if (index !== -1) uiSettingsListeners.splice(index, 1);
        };
      }, []);
      return state[0];
    }

    /** 文案：优先走 dsh locale 服务（已注册同名 namespace），无服务时用内置字典兜底。
     *  设置页选了固定语言时，直接使用该语言的字典（覆盖 dsh 全局语言）。 */
    function t(key, params) {
      var current = uiSettings || { enabled: true, uiLocale: 'auto' };
      var override = current.uiLocale === 'zh' || current.uiLocale === 'en' ? current.uiLocale : '';
      var value = '';
      if (!override && translate) {
        try { value = translate(key, params); } catch (error) { value = ''; }
      }
      if (!value || value === key) {
        var active = override || localeId();
        var dict = DICT[active] || DICT.zh;
        value = dict[key] != null ? dict[key] : (DICT.zh[key] != null ? DICT.zh[key] : key);
      }
      if (params && typeof value === 'string') {
        value = value.replace(/\{(\w+)\}/g, function (match, name) {
          return params[name] != null ? String(params[name]) : match;
        });
      }
      return value;
    }

    /** 轮次范围文案：轮{start}-{end} / turn {start}-{end}。 */
    function turnRange(start, end) {
      if (start == null) return '';
      return t('turnRange', { start: start, end: end });
    }

    /** 订阅 locale 变化：切换语言后重渲染。 */
    function useLocaleTick() {
      var subscribe = useCallback(function (onChange) {
        if (!localeService || typeof localeService.subscribe !== 'function') return function () {};
        try { return localeService.subscribe(onChange); } catch (error) { return function () {}; }
      }, []);
      var snapshot = useCallback(function () {
        try {
          if (localeService && typeof localeService.getSnapshot === 'function') {
            var snap = localeService.getSnapshot();
            return snap && snap.revision != null ? snap.revision : 0;
          }
        } catch (error) { /* 忽略 */ }
        return 0;
      }, []);
      if (typeof React.useSyncExternalStore === 'function') {
        try { React.useSyncExternalStore(subscribe, snapshot, snapshot); } catch (error) { /* 忽略 */ }
      }
    }

    // ── 小工具 ──────────────────────────────────────────────────────────────
    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function fmtK(value) {
      var n = Number(value) || 0;
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
      return String(Math.round(n));
    }

    function fmtPct(ratio) {
      var n = Number(ratio);
      if (!Number.isFinite(n) || n <= 0) return '0%';
      var pct = n * 100;
      if (pct >= 10) return pct.toFixed(0) + '%';
      if (pct >= 1) return pct.toFixed(1) + '%';
      return pct.toFixed(2) + '%';
    }

    function fmtDuration(ms) {
      var n = Number(ms);
      if (!Number.isFinite(n) || n <= 0) return '0s';
      var sec = Math.round(n / 1000);
      if (sec < 60) return sec + 's';
      var min = Math.floor(sec / 60);
      var rem = sec % 60;
      if (min < 60) return min + 'm' + (rem ? String(rem).padStart(2, '0') + 's' : '');
      var hr = Math.floor(min / 60);
      return hr + 'h' + String(min % 60).padStart(2, '0') + 'm';
    }

    function fmtClock(ms) {
      if (!ms) return '';
      try {
        var d = new Date(ms);
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        return hh + ':' + mm;
      } catch (error) { return ''; }
    }

    function sessionShortId(id) {
      return String(id || '').replace(/^session-/, '').slice(0, 8);
    }

    function sameSession(a, b) {
      return String(a || '').replace(/^session-/, '') === String(b || '').replace(/^session-/, '');
    }

    /** 面板默认宽度：尽量宽（用户反馈可以加倍），小屏时自动收进视口。 */
    function defaultPanelWidth() {
      try {
        return clamp(Math.min(DEFAULT_PANEL_W, window.innerWidth - 48), 380, 1600);
      } catch (error) {
        return DEFAULT_PANEL_W;
      }
    }

    function loadUi() {
      var fallback = {
        x: null, y: null, w: defaultPanelWidth(),
        h: clamp(DEFAULT_PANEL_H, 320, Math.max(360, (window.innerHeight || 900) - 16)),
        collapsed: false, tab: 'chain', pinned: null,
        graphCollapsed: { stages: {}, topics: {}, branches: {} },
        scale: 1,
      };
      function normalize(raw, keepWidth) {
        if (!raw || typeof raw !== 'object') return fallback;
        var width = defaultPanelWidth();
        if (keepWidth) {
          width = clamp(Number(raw.w) || width, 380, Math.max(420, (window.innerWidth || 1200) - 16));
        }
        // 迁移旧版窄面板的位置：宽度变大后要收进视口，否则会跑到屏幕外
        var maxX = Math.max(4, (window.innerWidth || 1200) - width - 8);
        var rawCollapsed = raw.graphCollapsed;
        var graphCollapsed = {
          stages: (rawCollapsed && typeof rawCollapsed.stages === 'object' && rawCollapsed.stages) || {},
          topics: (rawCollapsed && typeof rawCollapsed.topics === 'object' && rawCollapsed.topics) || {},
          branches: (rawCollapsed && typeof rawCollapsed.branches === 'object' && rawCollapsed.branches) || {},
        };
        return {
          x: typeof raw.x === 'number' ? clamp(raw.x, 4, maxX) : null,
          y: typeof raw.y === 'number' ? clamp(raw.y, 4, Math.max(4, (window.innerHeight || 900) - 60)) : null,
          w: width,
          h: clamp(Number(raw.h) || DEFAULT_PANEL_H, 320, Math.max(360, (window.innerHeight || 900) - 16)),
          collapsed: raw.collapsed === true,
          tab: raw.tab === 'graph' ? 'graph' : 'chain',
          pinned: typeof raw.pinned === 'string' && raw.pinned ? raw.pinned : null,
          graphCollapsed: graphCollapsed,
          scale: (typeof raw.scale === 'number' && raw.scale >= 0.35 && raw.scale <= 2.5) ? raw.scale : 1,
        };
      }
      try {
        var raw = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
        if (raw && typeof raw === 'object') return normalize(raw, true);
        // v1 → v2：保留位置 / 收起 / 标签 / 固定会话，但宽度改用新的默认宽度（旧默认太窄）
        var old = JSON.parse(localStorage.getItem(UI_KEY_V1) || 'null');
        if (old && typeof old === 'object') return normalize(old, false);
        return fallback;
      } catch (error) {
        return fallback;
      }
    }

    function saveUi(ui) {
      try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (error) { /* 忽略 */ }
    }

    async function fetchJson(url) {
      try {
        var response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) return null;
        return await response.json();
      } catch (error) {
        return null;
      }
    }

    async function postJson(url, body) {
      try {
        var response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body || {}),
        });
        if (!response.ok) return null;
        return await response.json();
      } catch (error) {
        return null;
      }
    }

    // ── 图谱布局（纯函数） ──────────────────────────────────────────────────
    var LAYOUT = {
      padX: 22,
      indent: 30,
      nodeH: 44,
      gap: 16,
      branchW: 300,
      branchHead: 26,
      childNodeH: 46,
      childGap: 8,
      childIndent: 14,
      railW: 56,
      railGap: 12,
      stageHead: 36,
      stageGap: 24,
      width: 1000,
    };

    /**
     * 图谱布局：左侧主列是阶段 → 根话题 → 子话题的树；右侧把子智能体会话
     * 展开成「分支框 + 子智能体自己的话题树」，与主图同屏显示。
     * 同时把 Host 的逻辑边（next / belongTo / has_relation / delegates）
     * 以及子智能体内部的话题归属换算成 SVG 路径。
     */
    function buildLayout(graph, options) {
      var opts = options || {};
      var canvasW = Number(opts.width) > 0 ? Math.max(620, Number(opts.width)) : LAYOUT.width;
      // 兼容两种传法：{ stages, topics, branches } 或 { collapsedStages, ... }
      var collapsedStages = opts.stages || opts.collapsedStages || {};
      var collapsedTopics = opts.topics || opts.collapsedTopics || {};
      var collapsedBranches = opts.branches || opts.collapsedBranches || {};
      var topics = Array.isArray(graph && graph.topics) ? graph.topics : [];
      var stages = Array.isArray(graph && graph.stages) ? graph.stages : [];
      var branchList = Array.isArray(graph && graph.branches) ? graph.branches : [];
      var graphEdges = (Array.isArray(graph && graph.edges) ? graph.edges : []).filter(function (edge) {
        return !(edge.type === 'has_relation' && edge.kind === 'extension');
      });
      if (!graphEdges.length && topics.length) {
        var rootList = topics.filter(function (topic) { return !topic.parentId; });
        graphEdges = [];
        for (var ri = 0; ri < rootList.length; ri += 1) {
          var rootNode = rootList[ri];
          if (rootNode.stageId) graphEdges.push({ id: 'belong:' + rootNode.id, type: 'belongTo', kind: 'stage', from: rootNode.id, to: rootNode.stageId });
          if (ri > 0) graphEdges.push({ id: 'next:' + rootList[ri - 1].id + '>' + rootNode.id, type: 'next', from: rootList[ri - 1].id, to: rootNode.id });
        }
        topics.forEach(function (topic) {
          if (topic.parentId) graphEdges.push({ id: 'belong:' + topic.id, type: 'belongTo', kind: 'topic', from: topic.id, to: topic.parentId });
          (Array.isArray(topic.branchIds) ? topic.branchIds : []).forEach(function (sessionId) {
            graphEdges.push({ id: 'deleg:' + topic.id + '>' + sessionId, type: 'delegates', from: topic.id, to: sessionId, label: t('subagent') });
          });
        });
      }
      var byId = {};
      topics.forEach(function (topic) { byId[topic.id] = topic; });
      var branchBySession = {};
      branchList.forEach(function (branch) { branchBySession[branch.sessionId] = branch; });
      var children = {};
      topics.forEach(function (topic) {
        if (!topic.parentId || !byId[topic.parentId]) return;
        if (!children[topic.parentId]) children[topic.parentId] = [];
        children[topic.parentId].push(topic);
      });
      var hasBranches = branchList.length > 0;
      var branchW = hasBranches ? LAYOUT.branchW : 0;
      var mainW = Math.min(canvasW - 8 - branchW - LAYOUT.railGap * 2 - LAYOUT.railW, 660);
      var railLeft = mainW + LAYOUT.railGap;
      var railRight = railLeft + LAYOUT.railW;
      var railX = (railLeft + railRight) / 2;
      var branchLeft = railRight + LAYOUT.railGap;
      var nodes = [];
      var branchNodes = [];
      var branchBoxes = [];
      var stageBoxes = [];
      var synthesizedEdges = [];
      var y = 14;

      function branchesOf(topic) {
        var out = [];
        (Array.isArray(topic.branchIds) ? topic.branchIds : []).forEach(function (sessionId) {
          if (branchBySession[sessionId] && out.indexOf(branchBySession[sessionId]) === -1) out.push(branchBySession[sessionId]);
        });
        branchList.forEach(function (branch) {
          if (branch.parentTopicId === topic.id && out.indexOf(branch) === -1) out.push(branch);
        });
        return out;
      }

      /** 子智能体分支：头部节点 + 它自己的话题树。返回该分支占用的高度。 */
      function layoutBranch(branch, parentNode, top) {
        var left = branchLeft;
        var header = {
          kind: 'branchHeader',
          id: 'branchh:' + branch.sessionId,
          branch: branch,
          parentNodeId: parentNode.id,
          x: left,
          y: top,
          w: LAYOUT.branchW,
          h: LAYOUT.branchHead,
          depth: parentNode.depth + 1,
        };
        var branchCollapsed = collapsedBranches[branch.sessionId] === true;
        header.collapsed = branchCollapsed;
        header.topicCount = Array.isArray(branch.topics) ? branch.topics.length : 0;
        branchNodes.push(header);
        var branchTopics = Array.isArray(branch.topics) ? branch.topics : [];
        var childById = {};
        branchTopics.forEach(function (topic) { childById[topic.id] = topic; });
        var childChildren = {};
        branchTopics.forEach(function (topic) {
          if (!topic.parentId || !childById[topic.parentId]) return;
          if (!childChildren[topic.parentId]) childChildren[topic.parentId] = [];
          childChildren[topic.parentId].push(topic);
        });
        var cursor = top + LAYOUT.branchHead + (branchTopics.length ? 6 : 2);
        var childNodeById = {};
        function layoutChild(topic, depth) {
          var node = {
            kind: 'branchTopic',
            id: 'brancht:' + branch.sessionId + ':' + topic.id,
            branch: branch,
            topic: topic,
            parentNodeId: parentNode.id,
            x: left + 8 + depth * LAYOUT.childIndent,
            y: cursor,
            w: LAYOUT.branchW - 16 - depth * LAYOUT.childIndent,
            h: LAYOUT.childNodeH,
            depth: parentNode.depth + 1 + depth,
            childDepth: depth,
          };
          branchNodes.push(node);
          childNodeById[topic.id] = node;
          cursor += LAYOUT.childNodeH + LAYOUT.childGap;
          (childChildren[topic.id] || []).forEach(function (child) {
            var childNode = layoutChild(child, depth + 1);
            synthesizedEdges.push({ id: 'belong:' + node.id + '>' + childNode.id, type: 'belongTo', kind: 'topic', path: directPath(node, childNode) });
          });
          return node;
        }
        var roots = branchTopics.filter(function (topic) { return !topic.parentId || !childById[topic.parentId]; });
        if (!branchCollapsed) {
          roots.forEach(function (topic) {
            var childNode = layoutChild(topic, 0);
            synthesizedEdges.push({ id: 'belong:' + header.id + '>' + childNode.id, type: 'belongTo', kind: 'branch', path: headerToChildPath(header, childNode) });
          });
        }
        (branch.relations || []).forEach(function (rel) {
          var fromNode = childNodeById[rel.from];
          var toNode = childNodeById[rel.to];
          if (!fromNode || !toNode) return;
          var fY = fromNode.y + fromNode.h / 2;
          var tY = toNode.y + toNode.h / 2;
          synthesizedEdges.push({
            id: 'rel:' + branch.sessionId + ':' + rel.from + '>' + rel.to,
            type: 'has_relation',
            label: rel.label,
            marker: 'rel',
            path: railElbow(fromNode.x, fY, toNode.x, tY),
            labelX: railX + 6,
            labelY: (fY + tY) / 2 + 3,
            labelBg: labelBox(rel.label, railX, (fY + tY) / 2),
          });
        });
        var bottom = Math.max(cursor - LAYOUT.childGap + 3, header.y + LAYOUT.branchHead + 4);
        branchBoxes.push({
          kind: 'branchBox',
          id: 'branchb:' + branch.sessionId,
          branch: branch,
          x: left,
          y: top - 4,
          w: LAYOUT.branchW,
          h: bottom - top + 8,
        });
        return bottom - top;
      }

      function directPath(parent, child) {
        var y1 = parent.y + parent.h;
        var y2 = child.y;
        var dy = Math.max(12, (y2 - y1) / 2);
        return 'M ' + (parent.x + 18) + ' ' + y1
          + ' C ' + (parent.x + 18) + ' ' + (y1 + dy) + ', ' + (child.x + 18) + ' ' + (y2 - dy) + ', ' + (child.x + 18) + ' ' + y2;
      }

      function headerToChildPath(header, child) {
        var y1 = header.y + header.h;
        var y2 = child.y;
        var dy = Math.max(10, (y2 - y1) / 2);
        return 'M ' + (header.x + 16) + ' ' + y1
          + ' C ' + (header.x + 16) + ' ' + (y1 + dy) + ', ' + (child.x + 16) + ' ' + (y2 - dy) + ', ' + (child.x + 16) + ' ' + y2;
      }

      function layoutTopic(topic, depth) {
        var collapsed = collapsedTopics[topic.id] === true;
        var node = {
          kind: 'topic',
          id: topic.id,
          topic: topic,
          collapsed: collapsed,
          childCount: (children[topic.id] || []).length,
          x: LAYOUT.padX + depth * LAYOUT.indent,
          y: y,
          w: Math.min(mainW - LAYOUT.padX * 2 - depth * LAYOUT.indent, 560),
          h: LAYOUT.nodeH,
          depth: depth,
        };
        nodes.push(node);
        var attached = branchesOf(topic);
        var branchStack = 0;
        var branchTop = node.y + 4;
        attached.forEach(function (branch) {
          branchStack += layoutBranch(branch, node, branchTop) + 26;
          branchTop = node.y + 4 + branchStack;
        });
        y = node.y + Math.max(node.h, branchStack) + LAYOUT.gap;
        if (!collapsed) {
          (children[topic.id] || []).forEach(function (child) {
            layoutTopic(child, depth + 1);
          });
        }
        return node;
      }

      stages.forEach(function (stage) {
        var collapsed = collapsedStages[stage.id] === true;
        var roots = (stage.topicIds || []).map(function (id) { return byId[id]; }).filter(Boolean);
        var top = y;
        y += LAYOUT.stageHead + 4;
        if (!collapsed) {
          roots.forEach(function (root) { layoutTopic(root, 0); });
        }
        var bottom = collapsed
          ? top + LAYOUT.stageHead + 8
          : Math.max(y - LAYOUT.gap + 10, top + LAYOUT.stageHead + 8);
        stageBoxes.push({
          kind: 'stage',
          id: stage.id,
          stage: stage,
          collapsed: collapsed,
          topicCount: roots.length,
          x: 8,
          y: top,
          w: mainW - 8,
          h: bottom - top,
          depth: 0,
        });
        y = bottom + LAYOUT.stageGap;
      });

      var nodeByTopic = {};
      nodes.forEach(function (node) { nodeByTopic[node.id] = node; });
      var boxByStage = {};
      stageBoxes.forEach(function (box) { boxByStage[box.id] = box; });
      var headerByBranch = {};
      branchNodes.forEach(function (node) { if (node.kind === 'branchHeader') headerByBranch[node.branch.sessionId] = node; });

      /** 平滑曲线：端点先向轨道方向伸展，再平滑折回另一端点（单段三次贝塞尔）。 */
      function railElbow(x1, y1, x2, y2) {
        return 'M ' + x1 + ' ' + y1
          + ' C ' + railX + ' ' + y1
          + ', ' + railX + ' ' + y2
          + ', ' + x2 + ' ' + y2;
      }

      /** 关系标签的底框（按字符宽度估算）。 */
      function labelBox(text, x, y) {
        var str = String(text == null ? '' : text);
        var w = 10;
        for (var i = 0; i < str.length; i += 1) {
          w += str.charCodeAt(i) > 0x2e80 ? 10 : 6;
        }
        return { x: x - w / 2, y: y - 8, w: w, h: 16 };
      }

      function curve(x1, y1, x2, y2, horizontal) {
        if (horizontal) {
          var dx = Math.max(24, Math.abs(x2 - x1) / 2);
          return 'M ' + x1 + ' ' + y1
            + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
        }
        var dy = Math.max(24, Math.abs(y2 - y1) / 2);
        return 'M ' + x1 + ' ' + y1
          + ' C ' + x1 + ' ' + (y1 + dy) + ', ' + x2 + ' ' + (y2 - dy) + ', ' + x2 + ' ' + y2;
      }

      var edges = []
      graphEdges.forEach(function (edge, index) {
        if (!edge || !edge.type) return;
        var out = { id: edge.id || ('e' + index), type: edge.type, label: edge.label || '' };
        if (edge.type === 'next') {
          var a = nodeByTopic[edge.from];
          var b = nodeByTopic[edge.to];
          if (!a || !b) return;
          out.path = railElbow(a.x + a.w, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2);
          out.marker = 'next';
        } else if (edge.type === 'belongTo' && edge.kind === 'stage') {
          var node = nodeByTopic[edge.from];
          var box = boxByStage[edge.to];
          if (!node || !box) return;
          out.path = 'M ' + (box.x + 10) + ' ' + (node.y + 16) + ' L ' + node.x + ' ' + (node.y + 16);
        } else if (edge.type === 'belongTo') {
          var parent = nodeByTopic[edge.to];
          var child = nodeByTopic[edge.from];
          if (!parent || !child) return;
          out.path = curve(parent.x + 26, parent.y + parent.h, child.x + 26, child.y, false);
        } else if (edge.type === 'has_relation') {
          var src = nodeByTopic[edge.from];
          var dst = nodeByTopic[edge.to];
          if (!src || !dst) return;
          var srcY = src.y + src.h / 2;
          var dstY = dst.y + dst.h / 2;
          out.path = railElbow(src.x + src.w, srcY, dst.x + dst.w, dstY);
          out.marker = 'rel';
          out.label = edge.label || '';
          out.labelX = railX;
          out.labelY = (srcY + dstY) / 2 + 3;
          out.labelBg = labelBox(out.label, railX, (srcY + dstY) / 2);
        } else if (edge.type === 'delegates') {
          var sourceNode = nodeByTopic[edge.from];
          var headerNode = headerByBranch[edge.to];
          if (!sourceNode || !headerNode) return;
          var sY = sourceNode.y + sourceNode.h / 2;
          var hY = headerNode.y + headerNode.h / 2;
          out.path = railElbow(sourceNode.x + sourceNode.w, sY, headerNode.x, hY);
          out.marker = 'deleg';
          out.label = edge.label || '';
          out.labelX = railX;
          out.labelY = (sY + hY) / 2 + 3;
          out.labelBg = labelBox(out.label, railX, (sY + hY) / 2);
        } else {
          return;
        }
        edges.push(out);
      });
      synthesizedEdges.forEach(function (edge) { edges.push(edge); });

      return {
        width: canvasW,
        height: Math.max(y + 10, 240),
        nodes: nodes,
        branchNodes: branchNodes,
        branchBoxes: branchBoxes,
        edges: edges,
        stageBoxes: stageBoxes,
        edgeTypes: edges.map(function (edge) { return edge.type; }),
      };
    }

    var TIMELINE_PALETTE = ['#679efe', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899'];

    /** 时间线布局：X = 轮次（时间），Y = 阶段泳道；话题是按其轮次跨度定位的细横线/点。 */
    function buildTimelineLayout(graph, viewportWidth) {
      var topics = Array.isArray(graph && graph.topics) ? graph.topics : [];
      var stages = Array.isArray(graph && graph.stages) ? graph.stages : [];
      var edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
      var roots = topics.filter(function (t) { return !t.parentId; })
        .sort(function (a, b) { return (a.turnStart || 0) - (b.turnStart || 0); });
      var indexById = {};
      roots.forEach(function (t, i) { indexById[t.id] = i + 1; });
      var padLeft = 16;
      var padRight = 16;
      var rulerH = 22;
      var laneH = 38;
      var barH = 4;
      var totalTurns = 1;
      topics.forEach(function (t) { totalTurns = Math.max(totalTurns, t.turnEnd || t.turnStart || 1); });
      // 尽量一页显示：按可视宽度反推每轮像素
      var avail = Math.max(320, (viewportWidth || 900) - padLeft - padRight);
      var turnW = Math.min(40, Math.max(2.5, avail / Math.max(1, totalTurns)));
      var width = padLeft + totalTurns * turnW + padRight;
      var lanes = [];
      var posById = {};
      stages.forEach(function (stage, si) {
        var laneTopics = roots.filter(function (t) { return t.stageId === stage.id; });
        var y = rulerH + si * laneH;
        lanes.push({ stage: stage, index: si, y: y, h: laneH, topics: laneTopics });
        laneTopics.forEach(function (topic) {
          var startTurn = topic.turnStart || 1;
          var endTurn = topic.turnEnd || startTurn;
          var span = Math.max(1, endTurn - startTurn + 1);
          posById[topic.id] = {
            x: padLeft + (startTurn - 1) * turnW + 0.5,
            y: y + (laneH - barH) / 2,
            w: Math.max(6, span * turnW - 1),
            h: barH,
            topic: topic,
            stage: stage,
            index: indexById[topic.id],
          };
        });
      });
      var height = rulerH + Math.max(lanes.length, 1) * laneH + 10;
      var rawStep = Math.max(1, 56 / turnW);
      var niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
      var step = niceSteps.filter(function (n) { return n >= rawStep; })[0] || 500;
      var ticks = [];
      for (var tn = 1; tn <= totalTurns; tn += step) ticks.push({ turn: tn, x: padLeft + (tn - 1) * turnW });
      var relations = [];
      function bez(t, p0, p1, p2, p3) {
        var mt = 1 - t;
        return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
      }
      // 时间上相邻的 topic 对（同阶段相邻 / 相邻阶段首尾）：若它们之间只有 1 条关系边，视为冗余不画
      var adjacentPairs = {};
      for (var ap = 0; ap < roots.length - 1; ap += 1) {
        adjacentPairs[roots[ap].id + '>' + roots[ap + 1].id] = true;
        adjacentPairs[roots[ap + 1].id + '>' + roots[ap].id] = true;
      }
      var relEdges = edges.filter(function (e) { return e.type === 'has_relation'; });
      var pairCount = {};
      relEdges.forEach(function (e) {
        var pairKey = [e.from, e.to].sort().join('>');
        pairCount[pairKey] = (pairCount[pairKey] || 0) + 1;
      });
      relEdges = relEdges.filter(function (e) {
        var pairKey = [e.from, e.to].sort().join('>');
        var isAdjacent = adjacentPairs[e.from + '>' + e.to] === true;
        if (isAdjacent && pairCount[pairKey] <= 1) return false;
        return true;
      });
      relEdges.forEach(function (e) {
        var a = posById[e.from];
        var b = posById[e.to];
        if (!a || !b) return;
        var startX;
        var startY;
        var endX;
        var endY;
        var c1y;
        var c2y;
        var path;
        var sameLane = a.stage === b.stage;
        if (sameLane) {
          if (b.x >= a.x) { startX = a.x + a.w + 2; endX = b.x - 2; }
          else { startX = a.x - 2; endX = b.x + b.w + 2; }
          startY = a.y + a.h / 2;
          endY = b.y + b.h / 2;
          var lift = 14;
          c1y = startY - lift;
          c2y = endY - lift;
          path = 'M ' + startX + ' ' + startY + ' C ' + startX + ' ' + c1y + ', ' + endX + ' ' + c2y + ', ' + endX + ' ' + endY;
        } else {
          var down = b.y > a.y;
          startX = a.x + a.w / 2;
          endX = b.x + b.w / 2;
          startY = down ? a.y + a.h + 2 : a.y - 2;
          endY = down ? b.y - 2 : b.y + b.h + 2;
          var spanY = endY - startY;
          c1y = startY + spanY * 0.45;
          c2y = endY - spanY * 0.45;
          path = 'M ' + startX + ' ' + startY + ' C ' + startX + ' ' + c1y + ', ' + endX + ' ' + c2y + ', ' + endX + ' ' + endY;
        }
        // 标签沿曲线错开分布 + 向右偏移，避免压线/互相重叠
        var idx = relations.length;
        var t = 0.3 + ((idx * 0.173) % 0.4);
        var labelX = bez(t, startX, startX, endX, endX) + 10;
        var labelY = bez(t, startY, c1y, c2y, endY) - 2;
        relations.push({
          id: e.id || ('tlrel:' + e.from + '>' + e.to),
          path: path,
          label: e.label || '',
          labelX: labelX,
          labelY: labelY,
          from: e.from,
          to: e.to,
          sameLane: sameLane,
        });
      });
      var nexts = [];
      edges.filter(function (e) { return e.type === 'next'; }).forEach(function (e) {
        var a = posById[e.from];
        var b = posById[e.to];
        if (!a || !b) return;
        var ax = a.x + a.w;
        var ay = a.y + a.h / 2;
        var bx = b.x;
        var by = b.y + b.h / 2;
        nexts.push({ id: e.id || ('tlnext:' + e.from + '>' + e.to), path: 'M ' + ax + ' ' + ay + ' C ' + (ax + 8) + ' ' + ay + ', ' + (bx - 8) + ' ' + by + ', ' + bx + ' ' + by });
      });
      return {
        width: width, height: height, lanes: lanes, posById: posById,
        relations: relations, nexts: nexts, ticks: ticks,
        rulerH: rulerH, laneH: laneH, barH: barH, padLeft: padLeft, turnW: turnW,
        totalTurns: totalTurns, indexById: indexById,
      };
    }

    // ── 样式（只使用主题 token，带兜底值） ─────────────────────────────────
    var CSS = [
      '[class*="viewArea"]:has(> .tg-root),:has(> .tg-root){flex:1 1 0% !important;min-height:0 !important;overflow:hidden !important}',
      '.tg-root{position:relative;width:100%;height:100%;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;',
      '  background:transparent;color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-debug-banner{position:fixed;top:0;left:0;z-index:99999;background:#e11;color:#fff;padding:3px 8px;font-size:11px;font-weight:700}',
      '.tg-root-docked{position:relative;left:auto;top:auto;width:100%;height:100%;flex:1;min-height:0;z-index:auto;',
      '  border-radius:0;border:0;box-shadow:none;overflow:hidden;background:transparent}',
      '.tg-head-docked{cursor:default}',
      '.tg-model-select{flex:none;max-width:220px;height:26px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));',
      '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:var(--dsw-alias-label-primary,#f4f4f5);font-size:11px;padding:0 6px}',
      '.tg-topbar{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}',
      '.tg-topbar-row{display:flex;align-items:center;gap:8px;padding:9px 12px}',
      '.tg-topbar-spacer{flex:1}',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif}',
      '.tg-root *{box-sizing:border-box}',
      '.tg-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:move;user-select:none;',
      '  background:linear-gradient(180deg,rgba(127,127,127,.10),rgba(127,127,127,.02));',
      '  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}',
      '.tg-logo{width:22px;height:22px;border-radius:7px;flex:none;display:flex;align-items:center;justify-content:center;',
      '  background:linear-gradient(135deg,var(--dsw-alias-brand-primary,#679efe),#2563eb);color:#fff;font-size:12px;font-weight:700}',
      '.tg-title{font-weight:600;font-size:13px;letter-spacing:.2px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-head-sub{font-size:10px;font-weight:500;color:var(--dsw-alias-label-secondary,#adb2b8);margin-left:6px}',
      '.tg-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary,#8b8f96)}',
      '.tg-dot.running{background:var(--dsw-alias-state-warn-primary,#eab308);animation:tg-pulse 1.1s ease-in-out infinite}',
      '.tg-dot.error{background:var(--dsw-alias-state-error-primary,#ef4444)}',
      '.tg-dot.ok{background:var(--dsw-alias-state-success-primary,#22c55e)}',
      '@keyframes tg-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '.tg-btn{border:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#adb2b8);border-radius:7px;',
      '  min-width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;padding:0 6px;flex:none;',
      '  transition:background .12s ease,color .12s ease}',
      '.tg-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-btn:active{opacity:.75}',
      '.tg-btn.primary{color:var(--dsw-alias-brand-primary,#679efe);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 35%,transparent)}',
      '.tg-btn.primary:hover{background:var(--dsw-alias-bg-layer-2,rgba(103,158,254,.14))}',
      '.tg-session-row{display:flex;align-items:center;gap:6px;padding:8px 10px 6px;position:relative}',
      '.tg-session-btn{flex:1;min-width:0;display:flex;align-items:center;gap:6px;cursor:pointer;background:transparent;border:0;',
      '  color:var(--dsw-alias-label-primary,#f4f4f5);font-size:12px;padding:4px 6px;border-radius:8px;text-align:left}',
      '.tg-session-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      '.tg-session-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}',
      '.tg-session-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap}',
      '.tg-pin{font-size:10px;color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-picker{position:absolute;left:8px;right:8px;top:100%;z-index:20;max-height:320px;overflow-y:auto;padding:6px;',
      '  border-radius:12px;background:var(--dsw-alias-bg-overlay,#2c2c2e);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));',
      '  box-shadow:0 16px 40px rgba(0,0,0,.4)}',
      '.tg-picker input{width:100%;box-sizing:border-box;margin-bottom:5px;padding:5px 8px;border-radius:7px;font-size:12px;outline:none;',
      '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));',
      '  color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-picker-item{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;cursor:pointer;font-size:12px;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,#e6e8ea)}',
      '.tg-picker-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}',
      '.tg-picker-item.sel{background:var(--dsw-alias-bg-layer-2,rgba(103,158,254,.16));color:var(--dsw-alias-brand-primary,#a8c2ff)}',
      '.tg-picker-item .tg-picker-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.tg-picker-item .tg-picker-time{font-size:10px;color:var(--dsw-alias-label-secondary,#adb2b8);flex:none}',
      '.tg-tabs{display:flex;gap:4px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}',
      '.tg-tab{flex:1;border:0;background:transparent;cursor:pointer;padding:8px 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#adb2b8);',
      '  border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .12s ease,border-color .12s ease}',
      '.tg-tab.active{color:var(--dsw-alias-brand-primary,#679efe);border-bottom-color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-tab .tg-tab-badge{display:inline-block;margin-left:5px;font-size:10px;padding:0 5px;border-radius:8px;',
      '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-body{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}',
      '.tg-workflow{flex:1;min-height:0;display:flex;overflow:hidden}',
      '.tg-workflow-tree{flex:none;width:300px;min-width:200px;max-width:46%;min-height:0;border-right:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));',
      '  overflow-y:auto;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04))}',
      '.tg-workflow-tree::-webkit-scrollbar{width:8px}',
      '.tg-workflow-tree::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:4px}',
      '.tg-workflow-detail{flex:1;min-width:0;min-height:0;overflow-y:auto}',
      '.tg-workflow-detail::-webkit-scrollbar{width:8px}',
      '.tg-workflow-detail::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:4px}',
      '.tg-wf-stage{margin:6px 8px}',
      '.tg-wf-stage-head{display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:7px 8px;border-radius:9px;cursor:pointer;user-select:none;',
      '  background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 9%,transparent),color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 4%,transparent));',
      '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}',
      '.tg-wf-stage-head.active{border-color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-wf-stage-idx{flex:none;width:17px;height:17px;border-radius:5px;display:flex;align-items:center;justify-content:center;',
      '  background:var(--dsw-alias-brand-primary,#679efe);color:#fff;font-size:10px;font-weight:700}',
      '.tg-wf-stage-title{flex:1;min-width:0;font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-wf-stage-meta{flex:none;font-size:9.5px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-wf-stage-title-row{display:flex;align-items:center;gap:6px}',
      '.tg-wf-stage-metrics{display:flex;flex-wrap:wrap;justify-content:flex-end;text-align:right;gap:2px 10px;font-size:9px;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8);padding:0 2px}',
      '.tg-wf-stage-toggle{flex:none;display:inline-flex;align-items:center;cursor:pointer;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-wf-stage-toggle:hover{color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-wf-tree-head{display:flex;align-items:center;gap:5px;padding:7px 8px 5px;font-size:9.5px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-wf-tree-head-title{flex:1;min-width:0}',
      '.tg-wf-tree-btn{font-size:9.5px;padding:0 6px;height:20px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
      '.tg-wf-metric{font-variant-numeric:tabular-nums}',
      '.tg-wf-metric-time{color:var(--dsw-alias-state-success-primary,#34d399)}',
      '.tg-wf-stage-topics{margin:4px 0 2px}',
      '.tg-wf-topic{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;cursor:pointer;user-select:none;min-width:0}',
      '.tg-wf-topic:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}',
      '.tg-wf-topic.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 3%,transparent)}',
      '.tg-wf-topic-title{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-primary,#e6e8ea);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-wf-topic.active .tg-wf-topic-title{color:var(--dsw-alias-brand-primary,#679efe);font-weight:600}',
      '.tg-wf-topic-meta{flex:none;font-size:9px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-wf-empty{padding:18px 14px;font-size:11px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-wf-stage-detail{padding:12px 14px}',
      '.tg-wf-stage-detail-title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#f4f4f5);margin-bottom:6px}',
      '.tg-wf-stage-detail-summary{font-size:11px;color:var(--dsw-alias-label-secondary,#c2c6cc);line-height:1.6;margin-bottom:8px}',
      '.tg-wf-stage-detail-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary,#adb2b8);margin-bottom:10px}',
      '.tg-wf-stage-topics{display:flex;flex-direction:column;gap:8px;margin-top:10px}',
      '.tg-wf-topic-card{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));border-radius:10px;overflow:hidden;',
      '  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.03))}',
      '.tg-wf-topic-card.open{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}',
      '.tg-wf-topic-card-head{display:flex;align-items:center;gap:7px;padding:8px 10px;user-select:none}',
      '.tg-wf-topic-card-toggle{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;max-width:72%;cursor:pointer}',
      '.tg-wf-topic-card-toggle:hover .tg-wf-topic-card-title{color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-wf-topic-card-head:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}',
      '.tg-wf-topic-card-title{flex:0 1 auto;min-width:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e8ea);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-wf-topic-card-meta{flex:none;margin-left:auto;font-size:9.5px;color:var(--dsw-alias-label-secondary,#adb2b8);font-variant-numeric:tabular-nums}',
      '.tg-wf-topic-card-body{padding:4px 10px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}',
      '.tg-wf-topic-summary{font-size:11px;color:var(--dsw-alias-label-secondary,#c2c6cc);line-height:1.6;margin:6px 0;white-space:pre-wrap;word-break:break-word}',
      '.tg-wf-mini-wrap{margin:10px 0 4px;padding:8px 10px;border-radius:10px;',
      '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04))}',
      '.tg-wf-mini-title{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary,#adb2b8);margin-bottom:2px}',
      '.tg-wf-mini{overflow:visible}',
      '.tg-wf-mini-base{stroke:var(--dsw-alias-border-l2,rgba(127,127,127,.3));stroke-width:1}',
      '.tg-wf-mini-arc path{fill:none;stroke:var(--dsw-alias-brand-primary,#679efe);stroke-width:1.2;opacity:.3;stroke-dasharray:3 3;',
      '  transition:opacity .12s ease,stroke-width .12s ease}',
      '.tg-wf-mini-arc.active path{opacity:1;stroke-width:2;stroke-dasharray:none}',
      '.tg-wf-mini-arc text{font-size:8px;fill:var(--dsw-alias-brand-primary,#679efe);text-anchor:middle;opacity:.45;font-weight:600}',
      '.tg-wf-mini-arc.active text{opacity:1;fill:var(--dsw-alias-state-warn-primary,#eab308)}',
      '.tg-wf-mini-dot{cursor:pointer}',
      '.tg-wf-mini-dot circle{opacity:.8;transition:opacity .12s ease,stroke .12s ease}',
      '.tg-wf-mini-dot:hover circle,.tg-wf-mini-dot.active circle{opacity:1;stroke:var(--dsw-alias-label-primary,#f4f4f5);stroke-width:1.5}',
      '.tg-wf-mini-idx{font-size:8px;fill:var(--dsw-alias-label-secondary,#adb2b8);text-anchor:middle}',
      '.tg-wf-statgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 6px}',
      '.tg-wf-stat{padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));',
      '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04))}',
      '.tg-wf-stat-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px;font-size:9.5px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-wf-stat-top b{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-wf-bar{height:5px;border-radius:3px;overflow:hidden;background:var(--dsw-alias-border-l1,rgba(127,127,127,.16));margin:6px 0 3px}',
      '.tg-wf-bar i{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-wf-bar i.green{background:var(--dsw-alias-state-success-primary,#34d399)}',
      '.tg-wf-bar i.warn{background:var(--dsw-alias-state-warn-primary,#eab308)}',
      '.tg-wf-stat-ratio{font-size:9.5px;color:var(--dsw-alias-label-secondary,#adb2b8);font-variant-numeric:tabular-nums}',
      '.tg-jump-link{color:var(--dsw-alias-brand-primary,#679efe);cursor:pointer;font-size:10px;white-space:nowrap}',
      '.tg-jump-link:hover{text-decoration:underline}',
      '.tg-howto-foot{display:flex;align-items:center;gap:10px;margin-top:6px;font-size:10px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-scroll{flex:1;min-height:0;overflow-y:auto;padding:8px 10px 10px}',
      '.tg-scroll::-webkit-scrollbar{width:8px;height:8px}',
      '.tg-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:4px}',
      '.tg-scroll::-webkit-scrollbar-track{background:transparent}',
      '.tg-banner{margin:8px 10px 0;padding:7px 10px;border-radius:9px;font-size:11px;display:flex;align-items:center;gap:6px;',
      '  background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 12%,transparent);',
      '  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 28%,transparent);',
      '  color:var(--dsw-alias-state-error-primary,#ef4444)}',
      '.tg-banner.info{background:var(--dsw-alias-bg-layer-2,rgba(103,158,254,.10));border-color:var(--dsw-alias-border-l1,rgba(103,158,254,.24));color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-banner .tg-banner-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tg-banner button{border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font-size:11px;padding:0}',
      '.tg-empty{padding:26px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-empty .tg-spin{margin:0 auto 10px}',
      '.tg-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));',
      '  border-top-color:var(--dsw-alias-brand-primary,#679efe);animation:tg-spin .8s linear infinite}',
      '@keyframes tg-spin{to{transform:rotate(360deg)}}',
      // 阶段
      '.tg-stage{margin-bottom:10px}',
      '.tg-stage-head{display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:10px;cursor:pointer;user-select:none;',
      '  background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 13%,transparent),var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06)));',
      '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}',
      '.tg-stage-head:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.32))}',
      '.tg-stage-index{width:19px;height:19px;border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center;',
      '  background:var(--dsw-alias-brand-primary,#679efe);color:#fff;font-size:10.5px;font-weight:700}',
      '.tg-stage-title{font-weight:700;font-size:12.5px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-stage-chips{display:flex;gap:4px;flex:none;font-size:10px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-chip{padding:1px 6px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));white-space:nowrap}',
      '.tg-chev{font-size:9px;color:var(--dsw-alias-label-secondary,#adb2b8);transition:transform .15s ease;flex:none}',
      '.tg-chev.open{transform:rotate(90deg)}',
      '.tg-stage-body{padding:7px 0 0 4px}',
      // 话题
      '.tg-topic{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));border-radius:10px;margin:0 0 7px;overflow:hidden;',
      '  background:var(--dsw-alias-bg-layer-1,transparent)}',
      '.tg-topic-head{display:flex;align-items:center;gap:6px;padding:7px 9px;cursor:pointer;user-select:none}',
      '.tg-topic-head:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}',
      '.tg-topic-main{flex:1;min-width:0}',
      '.tg-topic-title{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-topic-sub{margin-top:2px;display:flex;gap:5px;align-items:center;font-size:10.5px;color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap;overflow:hidden}',
      '.tg-topic-metrics{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:10px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-topic-metrics b{color:var(--dsw-alias-label-primary,#f4f4f5);font-weight:600;font-size:11px}',
      '.tg-badge{display:inline-flex;align-items:center;padding:0 5px;border-radius:7px;font-size:9.5px;line-height:16px;flex:none;',
      '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-badge.active{color:var(--dsw-alias-state-success-primary,#22c55e);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 14%,transparent)}',
      '.tg-badge.llm{color:var(--dsw-alias-brand-primary,#679efe);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 13%,transparent)}',
      '.tg-topic-body{padding:0 9px 9px}',
      '.tg-topic-summary{font-size:11.5px;color:var(--dsw-alias-label-secondary,#adb2b8);margin:0 0 7px}',
      '.tg-statgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}',
      '.tg-stat{border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));min-width:0}',
      '.tg-stat-label{font-size:9.5px;color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-stat-value{font-size:12px;font-weight:600;margin-top:1px;display:flex;align-items:baseline;gap:4px;flex-wrap:wrap}',
      '.tg-stat-value span.ratio{font-size:10px;font-weight:500;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-bar{height:3px;border-radius:2px;margin-top:4px;overflow:hidden;background:var(--dsw-alias-border-l1,rgba(127,127,127,.18))}',
      '.tg-bar i{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary,#679efe);opacity:.85}',
      '.tg-bar.tool i{background:var(--dsw-alias-state-warn-primary,#eab308)}',
      '.tg-bar.time i{background:var(--dsw-alias-state-success-primary,#22c55e)}',
      '.tg-turn{border-radius:8px;margin-bottom:5px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));overflow:hidden;',
      '  border:1px solid transparent;cursor:pointer}',
      '.tg-turn:hover{border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.22))}',
      '.tg-turn.running{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 40%,transparent)}',
      '.tg-turn-row{display:flex;align-items:center;gap:6px;padding:5px 7px;min-width:0}',
      '.tg-turn-no{flex:none;font-size:10px;font-weight:700;color:var(--dsw-alias-brand-primary,#679efe);min-width:26px}',
      '.tg-turn-prompt{flex:1;min-width:0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,#e6e8ea)}',
      '.tg-turn-meta{flex:none;display:flex;gap:5px;font-size:9.5px;color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap}',
      '.tg-turn-meta b{font-weight:600;color:var(--dsw-alias-label-primary,#d4d4d8)}',
      '.tg-turn-detail{padding:2px 8px 8px;display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:10.5px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-turn-detail .full{grid-column:1/-1;white-space:pre-wrap;word-break:break-word;line-height:1.5;',
      '  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.10));border-radius:6px;padding:5px 7px;max-height:120px;overflow:hidden}',
      '.tg-turn-detail .full b{color:var(--dsw-alias-label-primary,#d4d4d8);display:block;margin-bottom:1px;font-size:10px;font-weight:600}',
      '.tg-turn-detail .kv{display:flex;justify-content:space-between;gap:6px}',
      '.tg-turn-detail .kv span:last-child{color:var(--dsw-alias-label-primary,#d4d4d8);font-weight:600;text-align:right}',
      '.tg-turn-analysis{grid-column:1/-1;margin-top:6px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.18))}',
      '.tg-turn-analysis-head{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-primary,#d4d4d8);margin-bottom:6px}',
      '.tg-howto-steps{list-style:none;margin:0 0 6px;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.tg-howto-steps li{padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));',
      '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}',
      '.tg-howto-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e8ea)}',
      '.tg-howto-detail{font-size:10.5px;color:var(--dsw-alias-label-secondary,#c2c6cc);margin-top:2px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.tg-howto-tools{font-size:9.5px;color:var(--dsw-alias-brand-primary,#679efe);margin-top:3px}',
      '.tg-howto-outcome{font-size:10px;color:var(--dsw-alias-state-success-primary,#34d399);margin-top:3px}',
      '.tg-howto-error{font-size:10.5px;color:var(--dsw-alias-state-error-primary,#ef4444);margin-bottom:4px}',
      '.tg-howto-empty{font-size:10.5px;color:var(--dsw-alias-label-secondary,#adb2b8);margin-bottom:4px}',
      '.tg-turn-toggle{display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer}',
      '.tg-turn-toggle:hover .tg-turn-prompt,.tg-turn-toggle:hover .tg-turn-no{color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-howto-stepcount{margin-left:6px;font-size:9px;font-weight:600;color:var(--dsw-alias-brand-primary,#679efe);',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 12%,transparent);border-radius:6px;padding:0 5px}',
      '.tg-analyze-btn{margin-top:2px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));font-size:10.5px;padding:0 8px;height:24px}',
      // 图谱
      '.tg-graph{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.tg-graph-toolbar{display:flex;align-items:center;gap:5px;padding:6px 10px;font-size:10px;color:var(--dsw-alias-label-secondary,#adb2b8);',
      '  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
      '.tg-graph-hint{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-graph-modes{display:inline-flex;gap:2px;padding:2px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}',
      '.tg-mode-btn{border:0;background:transparent;cursor:pointer;font-size:10px;font-family:inherit;padding:2px 8px;border-radius:5px;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap}',
      '.tg-mode-btn:hover{color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-mode-btn.active{background:var(--dsw-alias-brand-primary,#679efe);color:#fff;font-weight:600}',
      '.tg-tl-split{flex:1;min-height:0;display:flex;overflow:hidden}',
      '.tg-tl-outline{flex:none;width:236px;min-height:0;overflow-y:auto;border-right:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));padding:6px}',
      '.tg-tl-outline::-webkit-scrollbar{width:8px}',
      '.tg-tl-outline::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:4px}',
      '.tg-tl-stage{margin-bottom:6px}',
      '.tg-tl-stage-head{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));',
      '  font-weight:600;font-size:10px;color:var(--dsw-alias-label-primary,#e6e8ea)}',
      '.tg-tl-stage-idx{width:16px;height:16px;border-radius:5px;display:flex;align-items:center;justify-content:center;flex:none;',
      '  background:var(--dsw-alias-brand-primary,#679efe);color:#fff;font-size:9px;font-weight:700}',
      '.tg-tl-stage-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-tl-topic{display:flex;align-items:center;gap:6px;padding:3px 6px 3px 14px;border-radius:6px;cursor:pointer;font-size:10px;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-tl-topic:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-tl-topic.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 8%,transparent);',
      '  color:var(--dsw-alias-brand-primary,#679efe);font-weight:600}',
      '.tg-tl-topic-idx{flex:none;font-size:8.5px;font-weight:700;color:var(--dsw-alias-brand-primary,#679efe);opacity:.85}',
      '.tg-tl-topic-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-tl-scroll{flex:1;min-width:0;min-height:0;overflow:auto;position:relative;padding-bottom:150px}',
      '.tg-tl-scroll::-webkit-scrollbar{width:9px;height:9px}',
      '.tg-tl-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:5px}',
      '.tg-tl-svg{display:block;overflow:visible}',
      '.tg-tl-grid{stroke:var(--dsw-alias-border-l1,rgba(127,127,127,.12));stroke-width:1}',
      '.tg-tl-tick{font-size:8px;fill:var(--dsw-alias-label-secondary,#adb2b8);text-anchor:middle}',
      '.tg-tl-lane{fill:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.03))}',
      '.tg-tl-lane.alt{fill:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07))}',
      '.tg-tl-lane-label{font-size:8px;fill:var(--dsw-alias-label-secondary,#adb2b8);opacity:.75}',
      '.tg-tl-next{fill:none;stroke:var(--dsw-alias-border-l2,rgba(127,127,127,.3));stroke-width:1;stroke-dasharray:2 3;opacity:.5}',
      '.tg-tl-arrow{fill:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-tl-rel-hit{fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke;cursor:pointer}',
      '.tg-tl-rel-path{fill:none;stroke:var(--dsw-alias-brand-primary,#679efe);stroke-width:1.2;opacity:.42;stroke-dasharray:4 3;',
      '  transition:opacity .12s ease,stroke-width .12s ease}',
      '.tg-tl-rel.same-lane .tg-tl-rel-path{opacity:.52}',
      '.tg-tl-rel.active .tg-tl-rel-path{opacity:1;stroke-width:2.2;stroke-dasharray:none}',
      '.tg-tl-rel-label{font-size:8px;fill:var(--dsw-alias-brand-primary,#679efe);text-anchor:middle;opacity:.18;font-weight:600;',
      '  transition:opacity .12s ease,fill .12s ease}',
      '.tg-tl-svg.has-active .tg-tl-rel:not(.active) .tg-tl-rel-label{opacity:0}',
      '.tg-tl-rel.same-lane .tg-tl-rel-label{opacity:0}',
      '.tg-tl-rel.active .tg-tl-rel-label{opacity:1;fill:var(--dsw-alias-state-warn-primary,#eab308);font-weight:700}',
      '.tg-tl-bar{cursor:pointer}',
      '.tg-tl-bar-rect{fill:var(--tg-bar-color,var(--dsw-alias-brand-primary,#679efe));opacity:.85;stroke:none;',
      '  transition:opacity .12s ease,filter .12s ease}',
      '.tg-tl-bar:hover .tg-tl-bar-rect,.tg-tl-bar.active .tg-tl-bar-rect{',
      '  opacity:1;filter:brightness(1.25) drop-shadow(0 0 3px var(--tg-bar-color,rgba(103,158,254,.7)))}',
      '.tg-tl-bar-label{font-size:8.5px;fill:var(--dsw-alias-label-primary,#f4f4f5);text-anchor:middle;font-weight:700;pointer-events:none}',
      '.tg-tl-tip{position:fixed;z-index:9999;max-width:300px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-overlay,#26262a);',
      '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none}',
      '.tg-tl-tip-title{font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary,#f4f4f5);margin-bottom:3px}',
      '.tg-tl-tip-line{font-size:10px;color:var(--dsw-alias-label-secondary,#adb2b8);line-height:1.5}',
      '.tg-tl-tip-rels{color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-zoom-pct{min-width:38px;text-align:right;font-variant-numeric:tabular-nums}',
      '.tg-graph-viewport{padding-bottom:150px;flex:1;min-height:0;overflow:auto;position:relative;overscroll-behavior:contain}',
      '.tg-graph-viewport::-webkit-scrollbar{width:9px;height:9px}',
      '.tg-graph-viewport::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:5px}',
      '.tg-graph-canvas{position:relative;overflow:hidden}',
      '.tg-graph-content{position:absolute;left:0;top:0;transform-origin:0 0}',
      '.tg-edges{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:1}',
      '.tg-edges path{fill:none;stroke:var(--dsw-alias-border-l2,rgba(127,127,127,.45));stroke-width:1.4}',
      '.tg-stage-box{position:absolute;border-radius:13px;pointer-events:none;z-index:0;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.3));',
      '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04))}',
      '.tg-stage-box-head{position:absolute;left:12px;right:12px;top:8px;height:24px;display:flex;align-items:center;gap:6px;',
      '  pointer-events:none;font-size:11.5px;font-weight:700;color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-stage-toggle{pointer-events:auto;flex:none;font-size:9px;line-height:1;padding:3px;border-radius:4px;cursor:pointer;opacity:.6;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-stage-toggle:hover{opacity:1;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16))}',
      '.tg-stage-box-idx{width:16px;height:16px;border-radius:5px;background:var(--dsw-alias-brand-primary,#679efe);color:#fff;',
      '  display:flex;align-items:center;justify-content:center;font-size:9.5px;flex:none}',
      '.tg-stage-box-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-stage-box-chip{font-size:9.5px;font-weight:500;color:var(--dsw-alias-label-secondary,#adb2b8);flex:none}',
      '.tg-node{position:absolute;border-radius:10px;padding:4px 9px;cursor:pointer;overflow:hidden;z-index:2;',
      '  background:var(--dsw-alias-bg-layer-1,#2c2c2e);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.26));',
      '  box-shadow:0 2px 10px rgba(0,0,0,.16);transition:border-color .12s ease,transform .12s ease}',
      '.tg-node:hover{border-color:var(--dsw-alias-brand-primary,#679efe);transform:translateY(-1px)}',
      '.tg-node.active{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 45%,transparent)}',
      '.tg-node-title{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:650;color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-node-title-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-node-toggle{flex:none;font-size:9px;line-height:1;padding:2px;border-radius:4px;cursor:pointer;opacity:.55;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8);transition:opacity .12s ease,background .12s ease}',
      '.tg-node-toggle:hover{opacity:1;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16))}',
      '.tg-node-meta{display:flex;align-items:center;gap:6px;font-size:9px;color:var(--dsw-alias-label-secondary,#adb2b8);margin-top:2px;white-space:nowrap;overflow:hidden}',
      '.tg-node-meta b{color:var(--dsw-alias-label-primary,#e4e4e7);font-weight:600}',
      '.tg-node-bar{height:3px;border-radius:2px;margin-top:3px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.2));overflow:hidden}',
      '.tg-node-bar i{display:block;height:100%;background:var(--dsw-alias-brand-primary,#679efe);opacity:.85}',
      '.tg-node-depth-tag{font-size:9px;padding:0 4px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));color:var(--dsw-alias-label-secondary,#adb2b8)}',
      // 图谱边（next / belongTo / has_relation / delegates）
      '.tg-edge{fill:none;stroke-linecap:round}',
      '.tg-edge-hit{fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke;cursor:pointer}',
      '.tg-edge.selected{stroke:#22d3ee;stroke-width:3.4;opacity:1;filter:drop-shadow(0 0 3px rgba(34,211,238,.85))}',
      '.tg-edge-next{stroke:var(--dsw-alias-label-secondary,#8b8f96);stroke-width:1.6;opacity:.55}',
      '.tg-edge-belongTo{stroke:var(--dsw-alias-border-l2,rgba(127,127,127,.45));stroke-width:1.1;stroke-dasharray:3 4;opacity:.75}',
      '.tg-edge-has_relation{stroke:var(--dsw-alias-brand-primary,#679efe);stroke-width:1.8;stroke-dasharray:3 3;opacity:1}',
      '.tg-edge-delegates{stroke:var(--dsw-alias-state-warn-primary,#eab308);stroke-width:1.4;stroke-dasharray:5 4;opacity:.9}',
      '.tg-edge-label{font-size:9.5px;fill:var(--dsw-alias-brand-primary,#679efe);text-anchor:start;',
      '  pointer-events:none;user-select:none;font-weight:600;text-anchor:middle}',
      '.tg-edge-label-bg{fill:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#26262a));',
      '  stroke:var(--dsw-alias-border-l1,rgba(127,127,127,.22));cursor:pointer}',
      '.tg-edge-label-bg.selected{stroke:#22d3ee;stroke-width:1.5}',
      '.tg-edge-label.selected{fill:#22d3ee;font-weight:700}',
      '.tg-arrow{fill:var(--dsw-alias-label-secondary,#8b8f96)}',
      '.tg-arrow-rel{fill:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-arrow-deleg{fill:var(--dsw-alias-state-warn-primary,#eab308)}',
      '.tg-arrow-sel{fill:#22d3ee}',
      '.tg-legend{display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:4px 10px 0;font-size:9px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-legend i{display:inline-block;width:14px;height:0;border-top:1.5px solid currentColor;margin-right:3px;vertical-align:middle}',
      '.tg-legend .n i{color:var(--dsw-alias-label-secondary,#8b8f96)}',
      '.tg-legend .b i{color:var(--dsw-alias-border-l2,rgba(127,127,127,.55));border-top-style:dashed}',
      '.tg-legend .r i{color:var(--dsw-alias-brand-primary,#679efe);border-top-style:dotted}',
      '.tg-legend .d i{color:var(--dsw-alias-state-warn-primary,#eab308);border-top-style:dashed}',
      // 统计条
      '.tg-stats{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
      '.tg-view-toggle{display:inline-flex;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}',
      '.tg-view-btn{border:0;background:transparent;cursor:pointer;font-size:12px;font-family:inherit;padding:4px 14px;border-radius:7px;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap}',
      '.tg-view-btn:hover{color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-view-btn.active{background:var(--dsw-alias-brand-primary,#679efe);color:#fff;font-weight:600}',
      '.tg-title-session{flex:0 1 auto;min-width:0;max-width:46%;font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary,#c2c6cc);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-stat-chip{display:inline-flex;align-items:baseline;gap:4px;padding:1px 7px;border-radius:8px;font-size:9.5px;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));white-space:nowrap}',
      '.tg-stat-chip b{font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-topic-detail-btn{width:22px;min-width:22px;height:22px;font-size:12px;opacity:.65}',
      '.tg-topic-detail-btn:hover{opacity:1}',
      // 话题详情浮层
      '.tg-detail{position:absolute;inset:0;z-index:30;display:flex;flex-direction:column;',
      '  background:var(--dsw-alias-bg-layer-1,#26262a);',
      '  animation:tg-fade .14s ease both}',
      '@keyframes tg-fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
      '.tg-detail-head{display:flex;align-items:center;gap:8px;padding:9px 11px;',
      '  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}',
      '.tg-detail-title{flex:1;min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-detail-body{padding:9px 11px 12px;overflow-y:auto}',
      '.tg-detail-body::-webkit-scrollbar{width:8px}',
      '.tg-detail-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:4px}',
      '.tg-detail-kicker{font-size:10px;color:var(--dsw-alias-label-secondary,#adb2b8);margin-bottom:4px}',
      '.tg-detail-kv{font-size:9.5px;color:var(--dsw-alias-label-secondary,#adb2b8);margin-top:3px;word-break:break-word}',
      '.tg-detail-section{margin-top:10px}',
      '.tg-detail-section-title{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary,#adb2b8);margin-bottom:4px}',
      '.tg-detail-foot{display:flex;gap:6px;justify-content:flex-end;padding:8px 11px;',
      '  border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}',
      '.tg-detail-foot .tg-btn{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));font-size:11px;padding:0 10px;height:26px}',
      '.tg-detail-status{margin-top:8px;font-size:10px;color:var(--dsw-alias-brand-primary,#679efe)}',
      // 子智能体「分支框 + 内部话题树」（与主图同屏）
      '.tg-branch-ico{flex:none;font-size:10px}',
      '.tg-branch-toggle{flex:none;font-size:9px;line-height:1;padding:2px;border-radius:4px;cursor:pointer;opacity:.6;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-branch-toggle:hover{opacity:1;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16))}',
      '.tg-branch-depth{position:absolute;right:5px;top:4px;font-size:8px;padding:0 3px;border-radius:4px;',
      '  background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.16));color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-branch-box{position:absolute;border-radius:12px;pointer-events:none;z-index:0;',
      '  border:1px dashed color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 38%,transparent);',
      '  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 4%,transparent)}',
      '.tg-branch-box-label{position:absolute;left:8px;top:-9px;max-width:calc(100% - 16px);padding:0 5px;border-radius:6px;',
      '  font-size:9px;color:var(--dsw-alias-label-secondary,#adb2b8);background:var(--dsw-alias-bg-overlay,#26262a);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-branch-header{position:absolute;display:flex;align-items:center;gap:5px;padding:0 8px;border-radius:8px;cursor:pointer;z-index:2;',
      '  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 12%,transparent);',
      '  border:1px dashed color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 45%,transparent)}',
      '.tg-branch-header:hover{border-style:solid}',
      '.tg-branch-header.pending{opacity:.72}',
      '.tg-branch-title-text{flex:1;min-width:0;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#f4f4f5);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-branch-header-meta{flex:none;font-size:9px;color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap}',
      '.tg-branch-topic{position:absolute;border-radius:8px;padding:5px 8px;cursor:pointer;overflow:hidden;z-index:2;',
      '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22))}',
      '.tg-branch-topic:hover{border-color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-branch-topic-title{font-size:10.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      '  color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-branch-topic-meta{display:flex;gap:6px;margin-top:2px;font-size:8.5px;color:var(--dsw-alias-label-secondary,#adb2b8);',
      '  white-space:nowrap;overflow:hidden}',
      '.tg-subbranch-group{margin-top:3px}',
      '.tg-subbranch-topics{padding-left:16px}',
      '.tg-subbranch-topic{display:flex;align-items:center;gap:6px;padding:2px 4px;border-radius:5px;cursor:pointer;',
      '  font-size:10px;color:var(--dsw-alias-label-primary,#e6e8ea);white-space:nowrap;overflow:hidden}',
      '.tg-subbranch-topic:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      '.tg-subbranch-topic-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-subbranch-topic.dim{color:var(--dsw-alias-label-secondary,#adb2b8);cursor:default}',
      // 链式里的关联话题 / 子智能体
      '.tg-relations{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 7px}',
      '.tg-rel-chip{display:inline-flex;align-items:center;gap:3px;max-width:100%;padding:1px 7px;border-radius:8px;cursor:pointer;',
      '  font-size:9.5px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 8%,transparent);',
      '  color:var(--dsw-alias-brand-primary,#679efe);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-rel-chip:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 16%,transparent)}',
      '.tg-rel-chip b{color:var(--dsw-alias-label-secondary,#adb2b8);font-weight:500}',
      '.tg-subbranches{margin:2px 0 7px;border-radius:9px;border:1px dashed color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 40%,transparent);',
      '  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 5%,transparent);padding:5px 7px}',
      '.tg-subbranches-head{font-size:9.5px;font-weight:600;color:var(--dsw-alias-state-warn-primary,#ca8a04);margin-bottom:3px;display:flex;gap:5px;align-items:center}',
      '.tg-subbranch{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:6px;cursor:pointer;font-size:10.5px;',
      '  color:var(--dsw-alias-label-primary,#e6e8ea);white-space:nowrap;overflow:hidden}',
      '.tg-subbranch:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      '.tg-subbranch-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.tg-subbranch-meta{flex:none;font-size:9px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-back-parent{flex:none;border:0;background:transparent;cursor:pointer;color:var(--dsw-alias-brand-primary,#679efe);',
      '  font-size:10.5px;padding:2px 5px;border-radius:6px}',
      '.tg-back-parent:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      // tooltip
      '.tg-tip{position:fixed;z-index:10060;max-width:330px;pointer-events:none;border-radius:11px;padding:9px 11px;font-size:11px;line-height:1.55;',
      '  background:var(--dsw-alias-bg-overlay,#2c2c2e);color:var(--dsw-alias-label-primary,#f4f4f5);',
      '  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));box-shadow:0 14px 40px rgba(0,0,0,.45);',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif}',
      '.tg-tip-title{font-weight:700;font-size:12.5px;margin-bottom:2px}',
      '.tg-tip-kind{font-size:9.5px;color:var(--dsw-alias-brand-primary,#679efe);margin-bottom:4px}',
      '.tg-tip-summary{color:var(--dsw-alias-label-secondary,#adb2b8);margin-bottom:6px;white-space:pre-wrap;word-break:break-word}',
      '.tg-tip-grid{display:grid;grid-template-columns:auto 1fr;gap:2px 10px}',
      '.tg-tip-grid .k{color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap}',
      '.tg-tip-grid .v{font-weight:600;text-align:right}',
      '.tg-tip-list{margin-top:5px;color:var(--dsw-alias-label-secondary,#adb2b8);word-break:break-word}',
      // footer
      '.tg-foot{display:flex;align-items:center;gap:6px;padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));',
      '  background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.06))}',
      '.tg-foot-status{flex:1;min-width:0;font-size:10px;color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tg-foot-status.error{color:var(--dsw-alias-state-error-primary,#ef4444)}',
      '.tg-foot-status.running{color:var(--dsw-alias-state-warn-primary,#eab308)}',
      '.tg-foot .tg-btn{font-size:10.5px;padding:0 8px;height:24px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22))}',
      '.tg-foot .tg-btn.primary{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 40%,transparent)}',
      '.tg-progress{flex:none;width:64px;height:4px;border-radius:2px;overflow:hidden;background:var(--dsw-alias-border-l1,rgba(127,127,127,.18))}',
      '.tg-progress i{display:block;height:100%;background:var(--dsw-alias-brand-primary,#679efe);transition:width .3s ease}',
      // collapsed pill
      '.tg-pill{position:fixed;z-index:9998;pointer-events:auto;display:flex;align-items:center;gap:7px;padding:7px 11px;border-radius:999px;',
      '  cursor:grab;user-select:none;font-size:12px;font-weight:600;',
      '  background:var(--dsw-alias-bg-overlay,#26262a);color:var(--dsw-alias-label-primary,#f4f4f5);',
      '  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));box-shadow:0 10px 28px rgba(0,0,0,.35)}',
      '.tg-pill:hover{border-color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-pill:active{cursor:grabbing}',
      '.tg-pill .tg-dot.running{animation:tg-pulse 1.1s ease-in-out infinite}',
      '.tg-version{flex:none;font-size:9px;color:var(--dsw-alias-label-secondary,#adb2b8);opacity:.55;margin-right:2px}',
      '.tg-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:12}',
      '.tg-resize::after{content:"";position:absolute;right:4px;bottom:4px;width:8px;height:8px;',
      '  border-right:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.5));border-bottom:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.5));border-radius:0 0 2px 0}',
      '.tg-settings-page{display:flex;flex-direction:column;gap:14px;max-width:640px;padding:4px 2px}',
      '.tg-settings-title{font-size:15px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-settings-desc{font-size:12.5px;color:var(--dsw-alias-label-secondary,#adb2b8);margin:0;line-height:1.6}',
      '.tg-settings-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;',
      '  border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
      '.tg-settings-label{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.tg-settings-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-settings-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary,#adb2b8);line-height:1.5}',
      '.tg-settings-options{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}',
      '.tg-settings-opt{border:0;background:transparent;cursor:pointer;font-family:inherit;font-size:12px;padding:4px 10px;border-radius:6px;',
      '  color:var(--dsw-alias-label-secondary,#adb2b8);white-space:nowrap}',
      '.tg-settings-opt:hover{color:var(--dsw-alias-label-primary,#f4f4f5)}',
      '.tg-settings-opt.active{background:var(--dsw-alias-brand-primary,#679efe);color:#fff;font-weight:600}',
      '.tg-settings-opt:disabled{opacity:.6;cursor:default}',
      '.tg-settings-note{font-size:11.5px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-switch{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));',
      '  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));border-radius:999px;padding:4px 10px 4px 4px;cursor:pointer;font-family:inherit}',
      '.tg-switch i{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary,#adb2b8);',
      '  transition:background .15s ease}',
      '.tg-switch.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#679efe) 20%,transparent);',
      '  border-color:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-switch.on i{background:var(--dsw-alias-brand-primary,#679efe)}',
      '.tg-switch-text{font-size:12px;color:var(--dsw-alias-label-secondary,#adb2b8)}',
      '.tg-switch.on .tg-switch-text{color:var(--dsw-alias-label-primary,#f4f4f5);font-weight:600}',
      '.tg-banner-disabled{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 12%,transparent);',
      '  border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#eab308) 40%,transparent)}',
    ].join('\n');

    // ── 悬浮窗组件 ──────────────────────────────────────────────────────────

    function TopicGraphPanel(props) {
      useLocaleTick();
      var uiSettingsNow = useUiSettings();
      var propsSessionId = props && typeof props.sessionId === 'string' ? props.sessionId : '';
      var uiState = useState(loadUi);
      var ui = uiState[0];
      var setUi = uiState[1];
      var sessionsState = useState([]);
      var sessions = sessionsState[0];
      var setSessions = sessionsState[1];
      var graphState = useState(null);
      var graph = graphState[0];
      var setGraph = graphState[1];
      var errorState = useState('');
      var error = errorState[0];
      var setError = errorState[1];
      var expandedStagesState = useState({});
      var expandedStages = expandedStagesState[0];
      var setExpandedStages = expandedStagesState[1];
      var expandedTopicsState = useState({});
      var expandedTopics = expandedTopicsState[0];
      var setExpandedTopics = expandedTopicsState[1];
      var expandedTurnsState = useState({});
      var expandedTurns = expandedTurnsState[0];
      var setExpandedTurns = expandedTurnsState[1];
      var hoverState = useState(null);
      var hover = hoverState[0];
      var setHover = hoverState[1];
      var reloadState = useState(0);
      var reloadKey = reloadState[0];
      var setReloadKey = reloadState[1];
      var scaleState = useState(function () {
        return (typeof ui.scale === 'number' && ui.scale >= 0.35 && ui.scale <= 2.5) ? ui.scale : 1;
      });
      var scale = scaleState[0];
      var setScale = scaleState[1];
      var actionState = useState('');
      var actionBusy = actionState[0];
      var setActionBusy = actionState[1];
      var detailState = useState(null);
      var detailTopicId = detailState[0];
      var setDetailTopicId = detailState[1];
      var detailSessionState = useState(null);
      var detailSessionId = detailSessionState[0];
      var setDetailSessionId = detailSessionState[1];
      var jumpState = useState(null);
      var jumpStatus = jumpState[0];
      var setJumpStatus = jumpState[1];
      var graphCollapsedState = useState(function () {
        return ui.graphCollapsed || { stages: {}, topics: {}, branches: {} };
      });
      var graphCollapsed = graphCollapsedState[0];
      var setGraphCollapsed = graphCollapsedState[1];
      var selectedEdgeState = useState(null);
      var selectedEdgeId = selectedEdgeState[0];
      var setSelectedEdgeId = selectedEdgeState[1];
      var localTurnAnalysesState = useState({});
      var localTurnAnalyses = localTurnAnalysesState[0];
      var setLocalTurnAnalyses = localTurnAnalysesState[1];
      var selectedStageState = useState(null);
      var selectedStageId = selectedStageState[0];
      var setSelectedStageId = selectedStageState[1];
      var selectedTopicState = useState(null);
      var selectedTopicId = selectedTopicState[0];
      var setSelectedTopicId = selectedTopicState[1];
      var wfMiniHoverState = useState(null);
      var wfMiniHover = wfMiniHoverState[0];
      var setWfMiniHover = wfMiniHoverState[1];
      var graphModeState = useState('timeline');
      var graphMode = graphModeState[0];
      var setGraphMode = graphModeState[1];
      var tlHoverState = useState(null);
      var tlHover = tlHoverState[0];
      var setTlHover = tlHoverState[1];
      var tlBoxState = useState(0);
      var tlBoxW = tlBoxState[0];
      var setTlBoxW = tlBoxState[1];
      var tlSelRelState = useState(null);
      var tlSelRel = tlSelRelState[0];
      var setTlSelRel = tlSelRelState[1];
      var structWState = useState(0);
      var structW = structWState[0];
      var setStructW = structWState[1];
      var modelProvidersState = useState([]);
      var modelProviders = modelProvidersState[0];
      var setModelProviders = modelProvidersState[1];
      var modelSelState = useState('');
      var modelSel = modelSelState[0];
      var setModelSel = modelSelState[1];

      var uiRef = useRef(ui);
      var sessionsRef = useRef({ sessions: [], current: null });
      var failCountRef = useRef(0);
      var scaleRef = useRef(scale);
      var versionRef = useRef(null);
      var graphSessionRef = useRef(null);
      var viewportRef = useRef(null);
      var wfDetailRef = useRef(null);
      var tlScrollRef = useRef(null);
      var panelRef = useRef(null);

      uiRef.current = ui;
      scaleRef.current = scale;

      // UI 状态持久化（拖动时防抖，避免每帧写 localStorage）
      useEffect(function () {
        var timer = setTimeout(function () {
          saveUi(Object.assign({}, ui, { graphCollapsed: graphCollapsed, scale: scale }));
        }, 200);
        return function () { clearTimeout(timer); };
      }, [ui, graphCollapsed, scale]);

      // 切换会话时关闭话题详情浮层，并恢复图谱默认展开
      useEffect(function () {
        setDetailSessionId(null);
        setDetailTopicId(null);
        setJumpStatus(null);
        setGraphCollapsed({ stages: {}, topics: {}, branches: {} });
        setSelectedEdgeId(null);
        setSelectedTopicId(null);
        setSelectedStageId(null);
      }, [graph && graph.sessionId]);

      // 载入可选模型（切分/关系/单轮分析共用）
      useEffect(function () {
        loadModels();
      }, []);

      // 默认展开第一个阶段 / 第一层话题
      useEffect(function () {
        if (!graph) return;
        setExpandedStages(function (prev) {
          if (Object.keys(prev).length) return prev;
          var next = {};
          (graph.stages || []).forEach(function (stage, index) { next[stage.id] = index === 0; });
          return next;
        });
      }, [graph]);

      // dsh 的 conversation view 在会话激活时会按内容撑高，导致整页一起滚。
      // 这里测量最近的可滚动祖先的可见高度，把面板锁成固定高度，让内部左右两栏独立滚动。
      useEffect(function () {
        var el = panelRef.current;
        if (!el) return undefined;
        var target = null;
        var node = el.parentElement;
        var guard = 0;
        while (node && guard < 12) {
          var cs = null;
          try { cs = window.getComputedStyle(node); } catch (error) { cs = null; }
          if (cs && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')) { target = node; break; }
          node = node.parentElement;
          guard += 1;
        }
        function apply() {
          if (!el) return;
          var h = target ? target.clientHeight : 0;
          if (h > 0) {
            el.style.flex = '0 0 auto';
            el.style.height = h + 'px';
            el.style.maxHeight = h + 'px';
            el.style.minHeight = '0';
          }
        }
        apply();
        var ro = null;
        try {
          if (typeof ResizeObserver !== 'undefined' && target) {
            ro = new ResizeObserver(function () { apply(); });
            ro.observe(target);
          }
        } catch (error) { /* ResizeObserver 不可用 */ }
        window.addEventListener('resize', apply);
        return function () {
          if (ro) { try { ro.disconnect(); } catch (error) { /* ignore */ } }
          window.removeEventListener('resize', apply);
        };
      }, []);

      // 时间线：测量可视宽度，尽量一页显示
      useEffect(function () {
        var el = tlScrollRef.current;
        if (!el) return undefined;
        function measure() { setTlBoxW(el.clientWidth || 0); }
        measure();
        var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        if (ro) { try { ro.observe(el); } catch (error) { /* ignore */ } }
        window.addEventListener('resize', measure);
        return function () {
          if (ro) { try { ro.disconnect(); } catch (error) { /* ignore */ } }
          window.removeEventListener('resize', measure);
        };
      }, [ui.tab, graphMode]);

      // 结构图：测量可视宽度，让画布铺满视口、不横向裁切
      useEffect(function () {
        var el = viewportRef.current;
        if (!el) return undefined;
        function measure() { setStructW(el.clientWidth || 0); }
        measure();
        var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        if (ro) { try { ro.observe(el); } catch (error) { /* ignore */ } }
        window.addEventListener('resize', measure);
        return function () {
          if (ro) { try { ro.disconnect(); } catch (error) { /* ignore */ } }
          window.removeEventListener('resize', measure);
        };
      }, [ui.tab, graphMode]);

      // 切换阶段/话题时，右栏滚回顶部
      useEffect(function () {
        var el = wfDetailRef.current;
        if (el) { try { el.scrollTop = 0; } catch (error) { /* ignore */ } }
      }, [selectedStageId, selectedTopicId]);

      // 工作流右栏默认显示第一个阶段，并展开其第一个话题
      useEffect(function () {
        if (!graph) return;
        var stages = graph.stages || [];
        if (!stages.length) return;
        var topics = graph.topics || [];
        setSelectedStageId(function (prev) { return prev || stages[0].id; });
        var firstTopic = topics.filter(function (t) { return !t.parentId && t.stageId === stages[0].id; })[0];
        if (firstTopic) setSelectedTopicId(function (prev) { return prev || firstTopic.id; });
        setExpandedTopics(function (prev) {
          if (Object.keys(prev).length) return prev;
          if (!firstTopic) return prev;
          var next = {}; next[firstTopic.id] = true; return next;
        });
      }, [graph, graph && graph.sessionId]);

      // 轮询：会话列表 5 拍一次，图谱每拍一次（版本未变时 Host 只回 unchanged）
      useEffect(function () {
        var cancelled = false;
        var timer = null;
        var tick = 0;

        async function refreshSessions() {
          var payload = await fetchJson(ROUTE + '/sessions');
          if (cancelled || !payload || !Array.isArray(payload.sessions)) return;
          sessionsRef.current = { sessions: payload.sessions, current: payload.current };
          setSessions(payload.sessions);
          var current = payload.current;
          if (current && graphSessionRef.current && !sameSession(current, graphSessionRef.current)) {
            versionRef.current = null;
          }
        }

        async function refreshGraph() {
          var sidebarSession = propsSessionId || readSidebarCurrentSession();
          var target = sidebarSession || (sessionsRef.current && sessionsRef.current.current);
          if (!target) return;
          var url = ROUTE + '/graph?sessionId=' + encodeURIComponent(target);
          if (versionRef.current != null && graphSessionRef.current && sameSession(graphSessionRef.current, target)) {
            url += '&version=' + versionRef.current;
          }
          var payload = await fetchJson(url);
          if (cancelled) return;
          if (!payload) {
            failCountRef.current += 1;
            if (failCountRef.current >= 4) {
              setError(t('aiFailed') + t('routeNoResponse', { route: ROUTE }));
            }
            return;
          }
          failCountRef.current = 0;
          if (payload.unchanged) return;
          if (payload.ok) {
            versionRef.current = payload.version;
            graphSessionRef.current = payload.sessionId || target;
            setGraph(payload);
            setError('');
          } else if (payload.empty) {
            setGraph(null);
          }
        }

        async function loop() {
          tick += 1;
          try {
            if (tick === 1 || tick % 5 === 0) await refreshSessions();
            await refreshGraph();
          } catch (loopError) {
            setError(String(loopError && loopError.message || loopError));
          }
          if (!cancelled) timer = setTimeout(loop, 2500);
        }
        loop();
        return function () { cancelled = true; clearTimeout(timer); };
      }, [reloadKey, propsSessionId]);

      // Ctrl+滚轮缩放（原生监听，需要 non-passive 才能 preventDefault）
      useEffect(function () {
        var element = viewportRef.current;
        if (!element || ui.tab !== 'graph') return undefined;
        function onWheel(event) {
          if (!event.ctrlKey) return; // 普通滚轮交给容器原生滚动
          event.preventDefault();
          var rect = element.getBoundingClientRect();
          var pointerX = event.clientX - rect.left;
          var pointerY = event.clientY - rect.top;
          var oldScale = scaleRef.current;
          var factor = Math.exp(-event.deltaY * 0.0016);
          var nextScale = clamp(oldScale * factor, 0.35, 2.5);
          if (Math.abs(nextScale - oldScale) < 0.0005) return;
          var contentX = (element.scrollLeft + pointerX) / oldScale;
          var contentY = (element.scrollTop + pointerY) / oldScale;
          setScale(nextScale);
          requestAnimationFrame(function () {
            element.scrollLeft = contentX * nextScale - pointerX;
            element.scrollTop = contentY * nextScale - pointerY;
          });
        }
        element.addEventListener('wheel', onWheel, { passive: false });
        return function () { element.removeEventListener('wheel', onWheel); };
      }, [ui.tab]);

      // ── 操作 ────────────────────────────────────────────────────────────
      function toggleStage(stageId) {
        setExpandedStages(function (prev) {
          var next = Object.assign({}, prev);
          next[stageId] = !next[stageId];
          return next;
        });
      }

      function setAllStages(open) {
        setExpandedStages(function () {
          var next = {};
          (graph && graph.stages ? graph.stages : []).forEach(function (stage) { next[stage.id] = open; });
          return next;
        });
      }

      function toggleTopic(topicId) {
        setExpandedTopics(function (prev) {
          var next = Object.assign({}, prev);
          next[topicId] = !next[topicId];
          return next;
        });
      }

      function toggleTurn(turnNo) {
        setExpandedTurns(function (prev) {
          var next = Object.assign({}, prev);
          next[turnNo] = !next[turnNo];
          return next;
        });
      }

      function selectSession(sessionId) {
        versionRef.current = null;
        graphSessionRef.current = null;
        setGraph(null);
        // 在面板里选会话 = 同时切换 dsh 主对话，避免面板与左侧不一致
        if (sessionId) {
          try {
            var navigation = appCtx && typeof appCtx.get === 'function' ? appCtx.get('uiWorkspace') : null;
            if (navigation && typeof navigation.openSession === 'function') navigation.openSession(sessionId);
          } catch (error) { /* 导航不可用时只切换面板 */ }
        }
      }

      async function triggerSegment(full) {
        var target = (graph && graph.sessionId) || (sessionsRef.current && sessionsRef.current.current);
        if (!target || actionBusy) return;
        setActionBusy(full ? 'full' : 'incremental');
        var result = await postJson(ROUTE + '/segment', { sessionId: target, full: full === true });
        setActionBusy('');
        if (!result || !result.ok) {
          setError(t('aiFailed'));
          return;
        }
        versionRef.current = null;
        setReloadKey(function (n) { return n + 1; });
      }

      // ── 派生数据 ────────────────────────────────────────────────────────
      var layout = useMemo(function () {
        var opts = Object.assign({}, graphCollapsed);
        opts.width = structW || 0;
        return buildLayout(graph || { topics: [], stages: [] }, opts);
      }, [graph, graphCollapsed, structW]);
      var byId = useMemo(function () {
        var map = {};
        var list = graph && graph.topics ? graph.topics : [];
        list.forEach(function (topic) { map[topic.id] = topic; });
        return map;
      }, [graph]);
      var turnByNo = useMemo(function () {
        var map = {};
        var list = graph && graph.turns ? graph.turns : [];
        list.forEach(function (turn) { map[turn.turn] = turn; });
        return map;
      }, [graph]);
      var childMap = useMemo(function () {
        var map = {};
        var list = graph && graph.topics ? graph.topics : [];
        list.forEach(function (topic) {
          if (!topic.parentId) return;
          if (!map[topic.parentId]) map[topic.parentId] = [];
          map[topic.parentId].push(topic);
        });
        return map;
      }, [graph]);
      var branchBySession = useMemo(function () {
        var map = {};
        var list = graph && graph.branches ? graph.branches : [];
        list.forEach(function (branch) { map[branch.sessionId] = branch; });
        return map;
      }, [graph]);
      var branchesByTopic = useMemo(function () {
        var map = {};
        var list = graph && graph.branches ? graph.branches : [];
        list.forEach(function (branch) {
          if (!branch.parentTopicId) return;
          if (!map[branch.parentTopicId]) map[branch.parentTopicId] = [];
          map[branch.parentTopicId].push(branch);
        });
        return map;
      }, [graph]);
      var relationsByTopic = useMemo(function () {
        var map = {};
        var list = graph && graph.relations ? graph.relations : [];
        list.forEach(function (rel) {
          if (!map[rel.from]) map[rel.from] = [];
          map[rel.from].push({ direction: 'out', other: rel.to, label: rel.label });
          if (!map[rel.to]) map[rel.to] = [];
          map[rel.to].push({ direction: 'in', other: rel.from, label: rel.label });
        });
        return map;
      }, [graph]);

      function topicTitleOf(id) {
        return byId[id] ? byId[id].title : id;
      }

      function topicBranches(topicId) {
        return branchesByTopic[topicId] || [];
      }

      function openSession(sessionId) {
        if (!sessionId) return;
        selectSession(sessionId);
      }

      // ── 渲染：轮次行 ────────────────────────────────────────────────────
      function renderTurn(turnNo) {
        var turn = turnByNo[turnNo];
        if (!turn) return null;
        var open = expandedTurns[turnNo];
        var running = turn.status === 'open';
        var statusLabel = running ? t('statusOpen') : (turn.status === 'aborted' ? t('statusAborted') : '');
        return h('div', {
          key: 'turn-' + turnNo,
          className: 'tg-turn' + (running ? ' running' : ''),
        },
          h('div', { className: 'tg-turn-row' },
            h('span', {
              className: 'tg-turn-toggle',
              onClick: function (event) { event.stopPropagation(); toggleTurn(turnNo); },
              title: open ? t('collapse') : t('expand'),
            },
              h('span', { className: 'tg-turn-no' }, t('turnLabel', { n: turnNo })),
              h('span', { className: 'tg-turn-prompt' }, turn.prompt || t('emptyPrompt')),
            ),
            statusLabel ? h('span', { className: 'tg-badge active' }, statusLabel) : null,
            h('span', { className: 'tg-turn-meta' },
              h('span', null, h('b', null, String(turn.steps || 0)), ' ' + t('totalSteps')),
              h('span', null, h('b', null, fmtK(turn.tokens.total)), ' ' + t('tokens')),
              h('span', null, t('toolCalls') + ' ', h('b', null, String(turn.toolCalls.total))),
              h('span', null, h('b', null, fmtDuration(turn.wallMs))),
            ),
          ),
          open ? h('div', { className: 'tg-turn-detail' },
            h('div', { className: 'kv' }, h('span', null, t('tokens')), h('span', null, fmtK(turn.tokens.total) + ' · ' + fmtPct(turn.tokenRatio))),
            h('div', { className: 'kv' }, h('span', null, t('agentTime')), h('span', null, fmtDuration(turn.wallMs) + ' · ' + fmtPct(turn.wallRatio))),
            h('div', { className: 'kv' }, h('span', null, t('stepTime')), h('span', null, fmtDuration(turn.agentMs))),
            h('div', { className: 'kv' }, h('span', null, t('toolCalls')), h('span', null, String(turn.toolCalls.total) + (turn.toolErrors ? ' (' + turn.toolErrors + ' err)' : ''))),
            h('div', { className: 'kv' }, h('span', null, t('requestCount')), h('span', null, String(turn.requests))),
            h('div', { className: 'kv' },
              h('span', null, t('totalSteps')),
              h('span', null,
                h('b', null, String(turn.steps || 0)), ' ',
                h('span', {
                  className: 'tg-jump-link',
                  title: t('jumpToTurn'),
                  onClick: function (event) { event.stopPropagation(); void jumpToTurn(turnNo); },
                }, '↗ ' + t('jumpToTurn')),
              ),
            ),
            h('div', { className: 'kv' }, h('span', null, t('input') + '/' + t('output')), h('span', null, fmtK(turn.tokens.input) + ' / ' + fmtK(turn.tokens.output))),
            h('div', { className: 'kv' }, h('span', null, t('cacheRead')), h('span', null, fmtK(turn.tokens.cacheRead))),
            turn.model ? h('div', { className: 'kv' }, h('span', null, 'model'), h('span', null, turn.model)) : null,
            turn.prompt ? h('div', { className: 'full' }, h('b', null, t('prompt')), turn.prompt) : null,
            turn.assistant ? h('div', { className: 'full' }, h('b', null, t('assistant')), turn.assistant) : null,
            (function () {
              var local = localTurnAnalyses[turnNo];
              var cached = graph.turnAnalyses && graph.turnAnalyses[turnNo];
              var cachedSteps = cached && Array.isArray(cached.steps) ? cached.steps : null;
              var status = local && local.status ? local.status : null;
              var steps = (local && local.status === 'done' && Array.isArray(local.steps) && local.steps.length)
                ? local.steps
                : (cachedSteps && cachedSteps.length ? cachedSteps : null);
              var hasSteps = Boolean(steps && steps.length);
              var errorText = local && local.status === 'error' ? (local.error || t('analyzeFailed')) : null;
              var busy = status === 'loading';
              return h('div', { className: 'tg-turn-analysis' },
                h('div', { className: 'tg-turn-analysis-head' },
                  h('span', null, t('howtoTitle')),
                  busy ? h('span', { className: 'tg-badge active' }, t('analyzing')) : null,
                ),
                busy ? null : (hasSteps
                  ? h(React.Fragment, null,
                    h('ol', { className: 'tg-howto-steps' }, steps.map(function (step, i) {
                      return h('li', { key: 'howto-' + i },
                        h('div', { className: 'tg-howto-title' },
                        (i + 1) + '. ' + (step.title || t('stepFallback')),
                        step.stepCount ? h('span', { className: 'tg-howto-stepcount' }, String(step.stepCount) + t('stepCountUnit')) : null,
                      ),
                        step.detail ? h('div', { className: 'tg-howto-detail' }, step.detail) : null,
                        step.tools && step.tools.length ? h('div', { className: 'tg-howto-tools' }, t('stepTools') + '：' + step.tools.join('、')) : null,
                        step.outcome ? h('div', { className: 'tg-howto-outcome' }, '→ ' + step.outcome) : null,
                      );
                    })),
                    h('div', { className: 'tg-howto-foot' },
                      h('span', null, t('totalSteps') + ' ' + String(turn.steps || 0)),
                      h('span', {
                        className: 'tg-jump-link',
                        onClick: function (event) { event.stopPropagation(); void jumpToTurn(turnNo); },
                      }, '↗ ' + t('jumpToTurn')),
                    ),
                  )
                  : (errorText
                    ? h('div', { className: 'tg-howto-error' }, errorText)
                    : h('div', { className: 'tg-howto-empty' }, t('howtoEmpty')))),
                busy ? null : h('button', {
                  className: 'tg-btn tg-analyze-btn',
                  onClick: function (event) { event.stopPropagation(); analyzeTurn(turnNo, hasSteps); },
                }, hasSteps ? t('reanalyzeTurn') : t('analyzeTurn')),
              );
            })(),
          ) : null,
        );
      }

      // ── 渲染：话题（含子话题） ─────────────────────────────────────────
      function renderTopic(topic, depth) {
        if (!topic) return null;
        var open = expandedTopics[topic.id];
        var stats = topic.stats || {};
        var tokens = stats.tokens || {};
        var kids = childMap[topic.id] || [];
        var range = topic.turnStart != null ? t('range') + ' ' + topic.turnStart + '-' + topic.turnEnd : '';
        return h('div', { key: topic.id, className: 'tg-topic', style: { marginLeft: depth ? depth * 10 : 0 } },
          h('div', { className: 'tg-topic-head', onClick: function () { toggleTopic(topic.id); } },
            h('span', { className: 'tg-chev' + (open ? ' open' : '') }, '▶'),
            h('div', { className: 'tg-topic-main' },
              h('div', { className: 'tg-topic-title' }, (depth ? '· ' : '') + topic.title),
              h('div', { className: 'tg-topic-sub' },
                h('span', null, range),
                h('span', { className: 'tg-badge' + (topic.status === 'active' ? ' active' : '') },
                  topic.status === 'active' ? t('statusActive') : t('statusDone')),
                h('span', { className: 'tg-badge' + (topic.source === 'llm' ? ' llm' : '') },
                  topic.source === 'llm' ? t('sourceLlm') : t('sourceRule')),
                kids.length ? h('span', null, kids.length + ' ' + t('subtopics')) : null,
                kids.length ? h('span', { className: 'tg-badge llm', title: t('statIncludesSubtopic') }, t('statIncludesSubtopic')) : null,
                topicBranches(topic.id).length
                  ? h('span', { className: 'tg-badge', style: { color: 'var(--dsw-alias-state-warn-primary,#ca8a04)' } },
                    '🤖 ' + t('subagentCount', { n: topicBranches(topic.id).length }))
                  : null,
              ),
            ),
            h('div', { className: 'tg-topic-metrics' },
              h('span', null, h('b', null, fmtK(tokens.total)), ' · ' + fmtPct(stats.tokenRatio)),
              h('span', null, fmtDuration(stats.wallMs) + ' · ' + fmtPct(stats.wallRatio)),
            ),
            h('button', {
              className: 'tg-btn tg-topic-detail-btn',
              title: t('detailOpen'),
              onClick: function (event) { event.stopPropagation(); openDetail(topic.id); },
            }, 'ⓘ'),
          ),
          open ? h('div', { className: 'tg-topic-body' },
            topic.summary ? h('div', { className: 'tg-topic-summary' }, topic.summary) : null,
            h('div', { className: 'tg-statgrid' },
              h('div', { className: 'tg-stat' },
                h('div', { className: 'tg-stat-label' }, t('tokens') + ' · ' + t('ratioOfTotal') + ' ' + fmtPct(stats.tokenRatio)),
                h('div', { className: 'tg-stat-value' }, fmtK(tokens.total), h('span', { className: 'ratio' }, t('input') + ' ' + fmtK(tokens.input) + ' / ' + t('output') + ' ' + fmtK(tokens.output))),
                h('div', { className: 'tg-bar' }, h('i', { style: { width: Math.max(1, (stats.tokenRatio || 0) * 100) + '%' } })),
              ),
              h('div', { className: 'tg-stat' },
                h('div', { className: 'tg-stat-label' }, t('toolCalls') + ' · ' + fmtPct(stats.toolRatio)),
                h('div', { className: 'tg-stat-value' }, String((stats.toolCalls && stats.toolCalls.total) || 0)),
                h('div', { className: 'tg-bar tool' }, h('i', { style: { width: Math.max(1, (stats.toolRatio || 0) * 100) + '%' } })),
              ),
              h('div', { className: 'tg-stat' },
                h('div', { className: 'tg-stat-label' }, t('agentTime') + ' · ' + fmtPct(stats.wallRatio)),
                h('div', { className: 'tg-stat-value' }, fmtDuration(stats.wallMs), h('span', { className: 'ratio' }, t('stepTime') + ' ' + fmtDuration(stats.agentMs))),
                h('div', { className: 'tg-bar time' }, h('i', { style: { width: Math.max(1, (stats.wallRatio || 0) * 100) + '%' } })),
              ),
              h('div', { className: 'tg-stat' },
                h('div', { className: 'tg-stat-label' }, t('turns')),
                h('div', { className: 'tg-stat-value' }, String(stats.turnCount || 0)),
              ),
            ),
            (relationsByTopic[topic.id] && relationsByTopic[topic.id].length)
              ? h('div', { className: 'tg-relations' },
                h('span', { className: 'tg-badge' }, t('relations')),
                relationsByTopic[topic.id].map(function (rel, index) {
                  return h('span', {
                    key: 'rel-' + index,
                    className: 'tg-rel-chip',
                    title: topicTitleOf(rel.other),
                    onClick: function (event) {
                      event.stopPropagation();
                      setExpandedTopics(function (prev) {
                        var next = Object.assign({}, prev);
                        next[rel.other] = true;
                        return next;
                      });
                    },
                  },
                    rel.direction === 'out' ? '→ ' : '← ',
                    topicTitleOf(rel.other),
                    h('b', null, ' ' + rel.label),
                  );
                }),
              )
              : null,
            topicBranches(topic.id).length
              ? h('div', { className: 'tg-subbranches' },
                h('div', { className: 'tg-subbranches-head' }, '🤖 ' + t('subagents') + ' (' + topicBranches(topic.id).length + ')'),
                topicBranches(topic.id).map(function (branch) {
                  var totals = branch.totals || {};
                  var childTopics = (branch.topics || []).slice(0, 6);
                  var more = Math.max(0, (branch.topics || []).length - childTopics.length);
                  return h('div', { key: branch.sessionId, className: 'tg-subbranch-group' },
                    h('div', {
                      className: 'tg-subbranch',
                      title: t('branchOpen'),
                      onClick: function () { selectSession(branch.sessionId); },
                    },
                      h('span', { className: 'tg-subbranch-name' }, '🤖 ' + (branch.title || sessionShortId(branch.sessionId))),
                      branch.pending ? h('span', { className: 'tg-subbranch-meta' }, t('branchPending')) : null,
                      h('span', { className: 'tg-subbranch-meta' },
                        (totals.turnCount || 0) + ' ' + t('turns') + ' · ' + fmtK((totals.tokens || {}).total || 0)),
                    ),
                    childTopics.length
                      ? h('div', { className: 'tg-subbranch-topics' }, childTopics.map(function (childTopic) {
                        var childStats = childTopic.stats || {};
                        return h('div', {
                          key: childTopic.id,
                          className: 'tg-subbranch-topic',
                          title: t('detailOpen'),
                          onClick: function (event) {
                            event.stopPropagation();
                            openChildDetail(branch.sessionId, childTopic.id);
                          },
                        },
                          h('span', { className: 'tg-subbranch-topic-title' }, childTopic.title),
                          h('span', { className: 'tg-subbranch-meta' }, fmtK((childStats.tokens || {}).total || 0)),
                        );
                      }), more ? h('div', { className: 'tg-subbranch-topic dim' }, '+' + more + ' …') : null)
                      : null,
                  );
                }),
              )
              : null,
            topic.ownTurns && topic.ownTurns.length
              ? h('div', null, topic.ownTurns.map(renderTurn))
              : h('div', { className: 'tg-topic-summary' }, t('noTurns')),
            kids.length ? h('div', { style: { marginTop: '4px' } }, kids.map(function (kid) { return renderTopic(kid, depth + 1); })) : null,
          ) : null,
        );
      }

      // ── 统计条 / 话题详情 / 跳转 ────────────────────────────────────────
      function renderStatsStrip() {
        if (!graph || !graph.totals) return null;
        var totals = graph.totals || {};
        var tokens = totals.tokens || {};
        var toolCalls = totals.toolCalls || { total: 0, byName: {} };
        var toolEntries = Object.keys(toolCalls.byName || {}).sort(function (a, b) {
          return toolCalls.byName[b] - toolCalls.byName[a];
        }).slice(0, 8);
        var items = [
          { key: 'turns', label: t('statTurns'), value: String(totals.turnCount || 0) },
          {
            key: 'topics', label: t('statTopics'),
            value: String(totals.topicCount || 0) + (totals.subtopicCount ? ' + ' + totals.subtopicCount : ''),
            title: (function () {
              var subTopics = 0;
              (graph.branches || []).forEach(function (branch) { subTopics += (branch.topics || []).length; });
              return t('statTopics') + ' ' + String(totals.topicCount || 0) + ' · ' + t('subtopics') + ' ' + String(totals.subtopicCount || 0)
                + (subTopics ? ' · 🤖 ' + subTopics : '');
            })(),
          },
          { key: 'stages', label: t('statStage'), value: String(totals.stageCount || 0) },
          {
            key: 'tokens', label: t('statTokens'), value: fmtK(tokens.total || 0),
            title: t('input') + ' ' + fmtK(tokens.input) + ' · ' + t('output') + ' ' + fmtK(tokens.output)
              + ' · ' + t('cacheRead') + ' ' + fmtK(tokens.cacheRead) + ' · ' + t('cacheWrite') + ' ' + fmtK(tokens.cacheWrite),
          },
          {
            key: 'tools', label: t('statTools'), value: String(toolCalls.total || 0),
            title: toolEntries.map(function (name) { return name + ' × ' + toolCalls.byName[name]; }).join(' · ') || t('toolCalls'),
          },
          { key: 'step', label: t('statStepTime'), value: fmtDuration(totals.agentMs || 0), title: t('stepTime') },
          { key: 'wall', label: t('statWallTime'), value: fmtDuration(totals.wallMs || 0), title: t('agentTime') },
          { key: 'relations', label: t('statRelations'), value: String(totals.relationCount || 0) },
        ];
        var ai = graph.ai || {};
        var aiTokens = ai.tokens || {};
        items.push({
          key: 'aicost', label: t('aiCost'), value: fmtK(aiTokens.total || 0) + ' · ' + (ai.calls || 0) + t('aiCallsUnit'),
          title: t('aiCost') + ' ' + fmtK(aiTokens.total || 0) + ' tokens · ' + (ai.calls || 0) + ' ' + t('aiCallsUnit') + t('aiCostHint'),
        });
        var sub = totals.subagent;
        if (sub && sub.branchCount) {
          items.push({
            key: 'subagent', label: '🤖 ' + t('subagent'), value: fmtK((sub.tokens || {}).total || 0),
            title: t('statSubagentTokens') + ' ' + fmtK((sub.tokens || {}).total || 0) + ' · ' + t('stepTime') + ' ' + fmtDuration(sub.agentMs || 0),
          });
        }
        return h('div', { className: 'tg-stats' },
          items.map(function (item) {
            return h('span', { key: item.key, className: 'tg-stat-chip', title: item.title || '' },
              h('b', null, item.value),
              h('span', null, item.label),
            );
          }),
        );
      }

      /** 解析详情：主图话题用 byId；子智能体话题在 branches[].topics 里。 */
      function resolveDetail() {
        if (!detailTopicId) return null;
        if (!detailSessionId) {
          var parentTopic = byId[detailTopicId];
          return parentTopic ? { topic: parentTopic, sessionId: graph.sessionId, branch: null, isChild: false } : null;
        }
        var branches = graph.branches || [];
        for (var i = 0; i < branches.length; i += 1) {
          var branch = branches[i];
          if (!sameSession(branch.sessionId, detailSessionId)) continue;
          var childTopic = (branch.topics || []).filter(function (item) { return item.id === detailTopicId; })[0];
          if (childTopic) return { topic: childTopic, sessionId: branch.sessionId, branch: branch, isChild: true };
        }
        return null;
      }

      function childTopicTitle(branch, topicId) {
        if (!branch || !topicId) return topicId;
        var found = (branch.topics || []).filter(function (item) { return item.id === topicId; })[0];
        return found ? found.title : topicId;
      }

      /** 图谱页的折叠箭头：阶段 / 话题 / 子智能体分支，各自独立记忆。 */
      function toggleGraphCollapse(kind, id) {
        setGraphCollapsed(function (prev) {
          var next = {
            stages: Object.assign({}, prev.stages),
            topics: Object.assign({}, prev.topics),
            branches: Object.assign({}, prev.branches),
          };
          next[kind][id] = !next[kind][id];
          return next;
        });
      }

      function isCollapsed(kind, id) {
        return Boolean(graphCollapsed[kind] && graphCollapsed[kind][id]);
      }

      function loadModels() {
        fetchJson(ROUTE + '/models').then(function (payload) {
          if (!payload || !payload.ok) return;
          setModelProviders(Array.isArray(payload.providers) ? payload.providers : []);
          if (payload.current && payload.current.provider && payload.current.model) {
            setModelSel(payload.current.provider + ':' + payload.current.model);
          }
        }).catch(function () { /* 模型列表失败不影响主功能 */ });
      }

      function onModelChange(value) {
        setModelSel(value || '');
        if (!value) {
          // 回退默认（config）：清掉覆盖文件
          postJson(ROUTE + '/model-clear', {}).catch(function () {});
          return;
        }
        var idx = value.indexOf(':');
        if (idx <= 0) return;
        var provider = value.slice(0, idx);
        var model = value.slice(idx + 1);
        postJson(ROUTE + '/model', { provider: provider, model: model }).catch(function () {});
      }

      function analyzeTurn(turnNo, force) {
        if (!graph || !graph.sessionId) return;
        setLocalTurnAnalyses(function (prev) {
          var next = Object.assign({}, prev);
          next[turnNo] = { status: 'loading' };
          return next;
        });
        postJson(ROUTE + '/analyze-turn', { sessionId: graph.sessionId, turn: turnNo, force: force }).then(function (payload) {
          setLocalTurnAnalyses(function (prev) {
            var next = Object.assign({}, prev);
            if (payload && payload.ok && payload.analysis && Array.isArray(payload.analysis.steps)) {
              next[turnNo] = { status: 'done', steps: payload.analysis.steps };
            } else {
              next[turnNo] = { status: 'error', error: (payload && payload.error) || t('analyzeFailed') };
            }
            return next;
          });
        }).catch(function (err) {
          setLocalTurnAnalyses(function (prev) {
            var next = Object.assign({}, prev);
            next[turnNo] = { status: 'error', error: String((err && err.message) || err) };
            return next;
          });
        });
      }

      function selectTopicInStage(topic) {
        if (!topic) return;
        setDetailTopicId(null);
        setDetailSessionId(null);
        setSelectedTopicId(topic.id);
        setSelectedStageId(topic.stageId || null);
        setExpandedTopics(function (prev) {
          var next = Object.assign({}, prev);
          next[topic.id] = true;
          return next;
        });
      }

      function openDetail(topicId) {
        if (!topicId || !byId[topicId]) return;
        setDetailSessionId(null);
        setDetailTopicId(topicId);
        setJumpStatus(null);
      }

      function openChildDetail(sessionId, topicId) {
        if (!sessionId || !topicId) return;
        setDetailSessionId(sessionId);
        setDetailTopicId(topicId);
        setJumpStatus(null);
      }

      function closeDetail() {
        setDetailSessionId(null);
        setDetailTopicId(null);
        setJumpStatus(null);
      }

      async function jumpToTurn(turnNo) {
        if (turnNo == null) return;
        var sessionId = (graph && graph.sessionId) || '';
        try {
          var navigation = appCtx && typeof appCtx.get === 'function' ? appCtx.get('uiWorkspace') : null;
          if (navigation && typeof navigation.openSession === 'function') navigation.openSession(sessionId);
        } catch (error) { /* 导航不可用时就地定位 */ }
        await revealChatTurn(turnNo);
      }

      async function jumpToTopicStart(topic, sessionIdOverride) {
        if (!topic || (topic.turnStart == null && !(Array.isArray(topic.ownTurns) && topic.ownTurns.length))) {
          setJumpStatus('openedOnly');
          return;
        }
        var sessionId = sessionIdOverride || (graph && graph.sessionId);
        var firstTurn = Array.isArray(topic.ownTurns) && topic.ownTurns.length ? topic.ownTurns[0] : topic.turnStart;
        setJumpStatus('locating');
        try {
          var navigation = appCtx && typeof appCtx.get === 'function' ? appCtx.get('uiWorkspace') : null;
          if (navigation && typeof navigation.openSession === 'function') navigation.openSession(sessionId);
        } catch (error) { /* 导航失败时仍尝试在当前会话里定位 */ }
        var located = await revealChatTurn(firstTurn);
        setJumpStatus(located ? 'located' : 'openedOnly');
        setTimeout(function () { setJumpStatus(null); }, 3500);
      }

      function renderDetail(inline) {
        var resolved = resolveDetail();
        if (!resolved) return null;
        var topic = resolved.topic;
        var branch = resolved.branch;
        var isChild = resolved.isChild;
        var stats = topic.stats || {};
        var tokens = stats.tokens || {};
        var toolCalls = stats.toolCalls || { total: 0, byName: {} };
        var stagePool = isChild ? (branch.stages || []) : (graph.stages || []);
        var stage = stagePool.filter(function (item) { return item.id === topic.stageId; })[0] || null;
        var parent = null;
        var kids = [];
        var relations = [];
        if (isChild) {
          parent = topic.parentId
            ? (branch.topics || []).filter(function (item) { return item.id === topic.parentId; })[0] || null
            : null;
          kids = (branch.topics || []).filter(function (item) { return item.parentId === topic.id; });
          relations = (branch.relations || []).filter(function (rel) {
            return rel.from === topic.id || rel.to === topic.id;
          }).map(function (rel) {
            var other = rel.from === topic.id ? rel.to : rel.from;
            return { direction: rel.from === topic.id ? 'out' : 'in', other: other, label: rel.label, otherTitle: childTopicTitle(branch, other) };
          });
        } else {
          parent = topic.parentId ? byId[topic.parentId] : null;
          kids = childMap[topic.id] || [];
          relations = (relationsByTopic[topic.id] || []).map(function (rel) {
            return { direction: rel.direction, other: rel.other, label: rel.label, otherTitle: topicTitleOf(rel.other) };
          });
        }
        var delegatingTopic = isChild && branch.parentTopicId ? byId[branch.parentTopicId] : null;
        var toolEntries = Object.keys(toolCalls.byName || {}).sort(function (a, b) {
          return toolCalls.byName[b] - toolCalls.byName[a];
        }).slice(0, 10);
        var ownTurns = Array.isArray(topic.ownTurns) ? topic.ownTurns : [];
        return h('div', { className: 'tg-detail' + (inline ? ' tg-detail-inline' : '') },
          h('div', { className: 'tg-detail-head' },
            h('span', { className: 'tg-detail-title' }, (isChild ? '🤖 ' : '') + topic.title),
            h('button', { className: 'tg-btn', title: t('close'), onClick: closeDetail }, '✕'),
          ),
          h('div', { className: 'tg-detail-body', style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            h('div', { className: 'tg-detail-kicker' },
              (isChild ? t('subagent') + ' · ' + (branch.title || sessionShortId(branch.sessionId)) + ' · ' : '')
              + t('topic') + ' · ' + (topic.status === 'active' ? t('statusActive') : t('statusDone'))
              + (topic.turnStart != null ? ' · ' + t('range') + ' ' + topic.turnStart + '-' + topic.turnEnd : '')),
            topic.summary ? h('div', { className: 'tg-topic-summary' }, topic.summary) : null,
            h('div', { className: 'tg-statgrid' },
              h('div', { className: 'tg-stat' },
                h('div', { className: 'tg-stat-label' }, t('tokens') + ' · ' + fmtPct(stats.tokenRatio)),
                h('div', { className: 'tg-stat-value' }, fmtK(tokens.total || 0)),
                h('div', { className: 'tg-detail-kv' }, t('input') + ' ' + fmtK(tokens.input) + ' · ' + t('output') + ' ' + fmtK(tokens.output)),
                h('div', { className: 'tg-detail-kv' }, t('cacheRead') + ' ' + fmtK(tokens.cacheRead) + ' · ' + t('cacheWrite') + ' ' + fmtK(tokens.cacheWrite)),
              ),
              h('div', { className: 'tg-stat' },
                h('div', { className: 'tg-stat-label' }, t('toolCalls') + ' · ' + fmtPct(stats.toolRatio)),
                h('div', { className: 'tg-stat-value' }, String(toolCalls.total || 0)),
                h('div', { className: 'tg-detail-kv' }, toolEntries.map(function (name) { return name + '×' + toolCalls.byName[name]; }).join(' · ') || '—'),
              ),
              h('div', { className: 'tg-stat' },
                h('div', { className: 'tg-stat-label' }, t('agentTime') + ' · ' + fmtPct(stats.wallRatio)),
                h('div', { className: 'tg-stat-value' }, fmtDuration(stats.wallMs || 0)),
                h('div', { className: 'tg-detail-kv' }, t('stepTime') + ' ' + fmtDuration(stats.agentMs || 0)),
              ),
              h('div', { className: 'tg-stat' },
                h('div', { className: 'tg-stat-label' }, t('statTurns')),
                h('div', { className: 'tg-stat-value' }, String(stats.turnCount || 0)),
                h('div', { className: 'tg-detail-kv' }, stage ? t('detailStage') + '：' + stage.title : ''),
              ),
            ),
            delegatingTopic ? h('div', { className: 'tg-detail-section' },
              h('div', { className: 'tg-detail-section-title' }, t('parentTopic')),
              h('span', { className: 'tg-rel-chip', onClick: function () { openDetail(delegatingTopic.id); } }, delegatingTopic.title),
            ) : null,
            parent ? h('div', { className: 'tg-detail-section' },
              h('div', { className: 'tg-detail-section-title' }, t('detailParent')),
              h('span', {
                className: 'tg-rel-chip',
                onClick: function () {
                  if (isChild) openChildDetail(resolved.sessionId, parent.id);
                  else openDetail(parent.id);
                },
              }, parent.title),
            ) : null,
            relations.length ? h('div', { className: 'tg-detail-section' },
              h('div', { className: 'tg-detail-section-title' }, t('detailRelated')),
              h('div', { className: 'tg-relations' }, relations.map(function (rel, index) {
                return h('span', {
                  key: 'drel-' + index,
                  className: 'tg-rel-chip',
                  onClick: function () {
                    if (isChild) openChildDetail(resolved.sessionId, rel.other);
                    else openDetail(rel.other);
                  },
                }, (rel.direction === 'out' ? '→ ' : '← ') + rel.otherTitle + ' ', h('b', null, rel.label));
              })),
            ) : null,
            kids.length ? h('div', { className: 'tg-detail-section' },
              h('div', { className: 'tg-detail-section-title' }, t('detailChildren')),
              h('div', { className: 'tg-relations' }, kids.map(function (kid) {
                return h('span', {
                  key: kid.id,
                  className: 'tg-rel-chip',
                  onClick: function () {
                    if (isChild) openChildDetail(resolved.sessionId, kid.id);
                    else openDetail(kid.id);
                  },
                }, kid.title);
              })),
            ) : null,
            !isChild && topicBranches(topic.id).length ? h('div', { className: 'tg-detail-section' },
              h('div', { className: 'tg-detail-section-title' }, t('detailBranches')),
              topicBranches(topic.id).map(function (item) {
                return h('div', { key: item.sessionId, className: 'tg-subbranch', onClick: function () { selectSession(item.sessionId); closeDetail(); } },
                  h('span', { className: 'tg-subbranch-name' }, '🤖 ' + (item.title || sessionShortId(item.sessionId))),
                  h('span', { className: 'tg-subbranch-meta' }, (item.totals ? item.totals.turnCount : 0) + ' ' + t('turns') + ' · ' + fmtK(item.totals ? (item.totals.tokens || {}).total || 0 : 0)),
                );
              }),
            ) : null,
            h('div', { className: 'tg-detail-section' },
              h('div', { className: 'tg-detail-section-title' }, t('detailTurns')),
              ownTurns.length
                ? ownTurns.map(renderTurn)
                : h('div', { className: 'tg-topic-summary' },
                  (isChild ? t('subagent') + ' · ' + (branch.title || sessionShortId(resolved.sessionId)) + ' · ' : '')
                  + String(stats.turnCount || 0) + ' ' + t('turns') + ' · ' + t('openAtFirstTurn')),
            ),
            jumpStatus ? h('div', { className: 'tg-detail-status' },
              jumpStatus === 'locating' ? t('locating') : (jumpStatus === 'located' ? t('located') : t('openedOnly')),
            ) : null,
          ),
          h('div', { className: 'tg-detail-foot' },
            isChild ? h('button', { className: 'tg-btn', onClick: function () { selectSession(resolved.sessionId); closeDetail(); } }, '🤖 ' + t('branchOpen')) : null,
            h('button', { className: 'tg-btn primary', disabled: jumpStatus === 'locating', onClick: function () { void jumpToTopicStart(topic, resolved.sessionId); } }, t('openAtFirstTurn')),
            h('button', { className: 'tg-btn', onClick: closeDetail }, t('close')),
          ),
        );
      }

      // ── 渲染：链式 Tab ──────────────────────────────────────────────────
      function renderWorkflowTree() {
        if (!graph) return renderLoading();
        var stages = graph.stages || [];
        var topics = graph.topics || [];
        var rootsByStage = {};
        topics.forEach(function (topic) {
          if (topic.parentId) return;
          if (!rootsByStage[topic.stageId]) rootsByStage[topic.stageId] = [];
          rootsByStage[topic.stageId].push(topic);
        });
        var renderWfTopic = function (topic, depth) {
          var kids = childMap[topic.id] || [];
          var active = selectedTopicId === topic.id;
          var branches = topicBranches(topic.id);
          var stats = topic.stats || {};
          return h('div', { key: topic.id },
            h('div', {
              className: 'tg-wf-topic' + (active ? ' active' : ''),
              style: { paddingLeft: (8 + depth * 14) + 'px' },
              onClick: function () { selectTopicInStage(topic); },
              title: t('detailOpen'),
            },
              h('span', { className: 'tg-wf-topic-title' }, topic.title),
              h('span', { className: 'tg-wf-topic-meta' },
                (topic.turnStart != null ? turnRange(topic.turnStart, topic.turnEnd) + ' · ' : '')
                + '⏱' + fmtPct(stats.wallRatio) + ' ◈' + fmtPct(stats.tokenRatio)
                + (branches.length ? ' · 🤖' + branches.length : '')),
            ),
            kids.map(function (kid) { return renderWfTopic(kid, depth + 1); }),
          );
        };
        return h('div', { className: 'tg-wf-tree' },
          h('div', { className: 'tg-wf-tree-head' },
            h('span', { className: 'tg-wf-tree-head-title' }, stages.length + ' ' + t('statStage')),
            h('button', { className: 'tg-btn tg-wf-tree-btn', onClick: function () { setAllStages(true); } }, t('expandAll')),
            h('button', { className: 'tg-btn tg-wf-tree-btn', onClick: function () { setAllStages(false); } }, t('collapseAll')),
          ),
          stages.length ? stages.map(function (stage) {
            var roots = rootsByStage[stage.id] || [];
            var open = expandedStages[stage.id] !== false;
            var stageActive = selectedStageId === stage.id && !detailTopicId;
            var stageStats = stage.stats || {};
            var stageTokens = stageStats.tokens || {};
            return h('div', { key: stage.id, className: 'tg-wf-stage' },
              h('div', {
                className: 'tg-wf-stage-head' + (stageActive ? ' active' : ''),
                onClick: function () {
                  setDetailTopicId(null);
                  setDetailSessionId(null);
                  setSelectedTopicId(null);
                  setSelectedStageId(stage.id);
                },
              },
                h('div', { className: 'tg-wf-stage-title-row' },
                  h('span', {
                    className: 'tg-wf-stage-toggle',
                    onClick: function (event) { event.stopPropagation(); toggleStage(stage.id); },
                    title: open ? t('collapse') : t('expand'),
                  }, h('span', { className: 'tg-chev' + (open ? ' open' : '') }, '▶')),
                  h('span', { className: 'tg-wf-stage-idx' }, String(stage.order + 1)),
                  h('span', { className: 'tg-wf-stage-title' }, stage.title),
                  h('span', { className: 'tg-wf-stage-meta' }, roots.length + ' ' + t('topics')),
                ),
                h('div', { className: 'tg-wf-stage-metrics' },
                  h('span', { className: 'tg-wf-metric' }, 'Token ' + fmtK(stageTokens.total || 0) + ' · ' + fmtPct(stageStats.tokenRatio)),
                  h('span', { className: 'tg-wf-metric tg-wf-metric-time' }, t('statWallTime') + ' ' + fmtDuration(stageStats.wallMs || 0) + ' · ' + fmtPct(stageStats.wallRatio)),
                ),
              ),
              open && roots.length ? h('div', { className: 'tg-wf-stage-topics' }, roots.map(function (root) { return renderWfTopic(root, 0); })) : null,
            );
          }) : h('div', { className: 'tg-wf-empty' }, t('noTopics')),
        );
      }

      /** 阶段内 mini 时间线：X=轮次，展示该阶段各话题的点与它们之间的关系边。 */
      function renderStageMiniTimeline(stage, roots) {
        var ids = {};
        roots.forEach(function (topic) { ids[topic.id] = true; });
        var rels = (graph.relations || []).filter(function (rel) { return ids[rel.from] && ids[rel.to]; });
        // 阶段内相邻 topic 之间只有 1 条关系边时不画（避免和顺序流重复、显得乱）
        var adjacentPairs = {};
        for (var ap = 0; ap < roots.length - 1; ap += 1) {
          adjacentPairs[roots[ap].id + '>' + roots[ap + 1].id] = true;
          adjacentPairs[roots[ap + 1].id + '>' + roots[ap].id] = true;
        }
        var pairCount = {};
        rels.forEach(function (rel) {
          var key = [rel.from, rel.to].sort().join('>');
          pairCount[key] = (pairCount[key] || 0) + 1;
        });
        rels = rels.filter(function (rel) {
          if (adjacentPairs[rel.from + '>' + rel.to] === true) return false;
          return true;
        });
        var minTurn = Infinity;
        var maxTurn = -Infinity;
        roots.forEach(function (topic) {
          minTurn = Math.min(minTurn, topic.turnStart || 1);
          maxTurn = Math.max(maxTurn, topic.turnEnd || topic.turnStart || 1);
        });
        if (!isFinite(minTurn)) { minTurn = 1; maxTurn = 1; }
        var span = Math.max(1, maxTurn - minTurn);
        var W = 600;
        var laneY = 52;
        var padX = 30;
        var pos = {};
        roots.forEach(function (topic) {
          var ratio = span > 0 ? ((topic.turnStart || 1) - minTurn) / span : 0.5;
          pos[topic.id] = { x: padX + ratio * (W - padX * 2), y: laneY, topic: topic };
        });
        // 关系边按 x 区间分层，重叠的边抬到不同高度，避免叠在一起
        var rawArcs = [];
        rels.forEach(function (rel) {
          var a = pos[rel.from];
          var b = pos[rel.to];
          if (!a || !b) return;
          rawArcs.push({
            id: rel.from + '>' + rel.to,
            x1: a.x,
            x2: b.x,
            left: Math.min(a.x, b.x),
            right: Math.max(a.x, b.x),
            from: rel.from,
            to: rel.to,
            label: rel.label || '',
          });
        });
        rawArcs.sort(function (p, q) { return p.left - q.left || p.right - q.right; });
        var layerEnd = [];
        rawArcs.forEach(function (arc) {
          var layer = 0;
          while (layer < layerEnd.length && layerEnd[layer] > arc.left) layer += 1;
          if (layer === layerEnd.length) layerEnd.push(arc.right);
          else layerEnd[layer] = arc.right;
          arc.layer = layer;
        });
        var maxLayer = Math.max(0, layerEnd.length - 1);
        var baseLift = 20;
        var liftStep = 14;
        var topMost = laneY - baseLift - maxLayer * liftStep - 10;
        var viewTop = Math.min(6, topMost);
        var viewH = (laneY + 26) - viewTop;
        var arcs = rawArcs.map(function (arc) {
          var lift = baseLift + arc.layer * liftStep;
          return {
            id: arc.id,
            d: 'M ' + arc.x1 + ' ' + laneY + ' C ' + arc.x1 + ' ' + (laneY - lift) + ', ' + arc.x2 + ' ' + (laneY - lift) + ', ' + arc.x2 + ' ' + laneY,
            label: arc.label,
            labelX: (arc.x1 + arc.x2) / 2,
            labelY: laneY - lift - 6,
            from: arc.from,
            to: arc.to,
          };
        });
        return h('div', { className: 'tg-wf-mini-wrap' },
          h('div', { className: 'tg-wf-mini-title' }, t('stageTopicRelations')),
          h('svg', {
            className: 'tg-wf-mini',
            viewBox: '0 ' + viewTop + ' ' + W + ' ' + viewH,
            preserveAspectRatio: 'xMidYMid meet',
            style: { display: 'block', width: '100%', height: 'auto' },
          },
            h('line', { className: 'tg-wf-mini-base', x1: 16, y1: laneY, x2: W - 16, y2: laneY }),
            arcs.map(function (arc) {
              var active = wfMiniHover && (arc.from === wfMiniHover || arc.to === wfMiniHover);
              return h('g', { key: 'arc-' + arc.id, className: 'tg-wf-mini-arc' + (active ? ' active' : '') },
                h('path', { d: arc.d }),
                arc.label ? h('text', { x: arc.labelX, y: arc.labelY }, arc.label) : null,
              );
            }),
            roots.map(function (topic, i) {
              var p = pos[topic.id];
              var active = wfMiniHover === topic.id || selectedTopicId === topic.id;
              return h('g', {
                key: 'dot-' + topic.id,
                className: 'tg-wf-mini-dot' + (active ? ' active' : ''),
                onMouseEnter: function () { setWfMiniHover(topic.id); },
                onMouseLeave: function () { setWfMiniHover(null); },
                onClick: function () { setSelectedTopicId(topic.id); },
              },
                h('circle', { cx: p.x, cy: p.y, r: 5, style: { fill: TIMELINE_PALETTE[i % TIMELINE_PALETTE.length] } }),
                h('text', { className: 'tg-wf-mini-idx', x: p.x, y: laneY + 22 }, turnRange(topic.turnStart, topic.turnEnd)),
                h('title', null, topic.title),
              );
            }),
          ),
        );
      }

      function renderStageTopicCard(topic, depth) {
        var open = expandedTopics[topic.id] === true;
        var kids = childMap[topic.id] || [];
        var stats = topic.stats || {};
        var tokens = stats.tokens || {};
        var branches = topicBranches(topic.id);
        return h('div', { key: topic.id, className: 'tg-wf-topic-card' + (open ? ' open' : '') },
          h('div', {
            className: 'tg-wf-topic-card-head',
            style: { paddingLeft: (10 + depth * 14) + 'px' },
          },
            h('span', {
              className: 'tg-wf-topic-card-toggle',
              onClick: function (event) { event.stopPropagation(); toggleTopic(topic.id); },
              title: open ? t('collapse') : t('expand'),
            },
              h('span', { className: 'tg-chev' + (open ? ' open' : '') }, '▶'),
              h('span', { className: 'tg-wf-topic-card-title' }, topic.title),
            ),
            h('span', { className: 'tg-wf-topic-card-meta' },
              (topic.turnStart != null ? turnRange(topic.turnStart, topic.turnEnd) + ' · ' : '')
              + fmtK(tokens.total || 0) + ' · ' + fmtDuration(stats.wallMs || 0)
              + (branches.length ? ' · 🤖' + branches.length : '')),
          ),
          open ? h('div', { className: 'tg-wf-topic-card-body' },
            topic.summary ? h('div', { className: 'tg-wf-topic-summary' }, topic.summary) : null,
            (topic.ownTurns && topic.ownTurns.length) ? h('div', { className: 'tg-detail-section' },
              h('div', { className: 'tg-detail-section-title' }, t('detailTurns')),
              topic.ownTurns.map(renderTurn),
            ) : null,
            kids.map(function (kid) { return renderStageTopicCard(kid, depth + 1); }),
          ) : null,
        );
      }

      function barPct(ratio) {
        var value = Number(ratio) || 0;
        return Math.max(1.5, Math.min(100, value * 100));
      }

      function renderStageDetail(stage) {
        var topics = graph.topics || [];
        var roots = topics.filter(function (t) { return !t.parentId && t.stageId === stage.id; })
          .sort(function (a, b) { return (a.turnStart || 0) - (b.turnStart || 0); });
        var stats = stage.stats || {};
        var tokens = stats.tokens || {};
        var toolCalls = stats.toolCalls || { total: 0 };
        var agentMs = stats.agentMs || 0;
        return h('div', { className: 'tg-wf-stage-detail' },
          h('div', { className: 'tg-wf-stage-detail-title' }, stage.title),
          stage.summary ? h('div', { className: 'tg-wf-stage-detail-summary' }, stage.summary) : null,
          h('div', { className: 'tg-wf-stage-detail-meta' },
            roots.length + ' ' + t('topics') + ' · ' + (stats.turnCount || 0) + ' ' + t('turns') + ' · ' + t('agentTime') + ' ' + fmtDuration(agentMs)),
          h('div', { className: 'tg-wf-statgrid' },
            h('div', { className: 'tg-wf-stat' },
              h('div', { className: 'tg-wf-stat-top' }, h('span', null, t('statTokens')), h('b', null, fmtK(tokens.total || 0))),
              h('div', { className: 'tg-wf-bar' }, h('i', { className: 'brand', style: { width: barPct(stats.tokenRatio) + '%' } })),
              h('div', { className: 'tg-wf-stat-ratio' }, t('statTokens') + ' ' + fmtPct(stats.tokenRatio)),
            ),
            h('div', { className: 'tg-wf-stat' },
              h('div', { className: 'tg-wf-stat-top' }, h('span', null, t('statWallTime')), h('b', null, fmtDuration(stats.wallMs || 0))),
              h('div', { className: 'tg-wf-bar' }, h('i', { className: 'green', style: { width: barPct(stats.wallRatio) + '%' } })),
              h('div', { className: 'tg-wf-stat-ratio' }, t('statWallTime') + ' ' + fmtPct(stats.wallRatio)),
            ),
            h('div', { className: 'tg-wf-stat' },
              h('div', { className: 'tg-wf-stat-top' }, h('span', null, t('statTools')), h('b', null, String(toolCalls.total || 0))),
              h('div', { className: 'tg-wf-bar' }, h('i', { className: 'warn', style: { width: barPct(stats.toolRatio) + '%' } })),
              h('div', { className: 'tg-wf-stat-ratio' }, t('statTools') + ' ' + fmtPct(stats.toolRatio)),
            ),
          ),
          roots.length >= 2 ? renderStageMiniTimeline(stage, roots) : null,
          roots.length ? h('div', { className: 'tg-wf-stage-topics' }, roots.map(function (root) { return renderStageTopicCard(root, 0); })) : null,
        );
      }

      function renderWorkflowDetail() {
        if (!graph) return null;
        var stages = graph.stages || [];
        var stage = selectedStageId ? stages.filter(function (s) { return s.id === selectedStageId; })[0] : stages[0];
        if (!stage) return h('div', { className: 'tg-wf-empty' }, t('workflowEmpty'));
        return renderStageDetail(stage);
      }

      function renderChain() {
        if (!graph) return renderLoading();
        if (!graph.turns || !graph.turns.length) {
          return h('div', { className: 'tg-empty' }, t('noTurns'));
        }
        var stages = graph.stages || [];
        if (!stages.length) return renderNoTopics();
        return h('div', { className: 'tg-chain' },
          stages.map(function (stage, index) {
            var open = expandedStages[stage.id] !== false;
            var stats = stage.stats || {};
            var topicCount = (stage.topicIds || []).length;
            return h('div', { key: stage.id, className: 'tg-stage' },
              h('div', { className: 'tg-stage-head', onClick: function () { toggleStage(stage.id); } },
                h('span', { className: 'tg-stage-index' }, String(index + 1)),
                h('span', { className: 'tg-stage-title' }, stage.title || t('stage')),
                h('span', { className: 'tg-stage-chips' },
                  h('span', { className: 'tg-chip' }, fmtK((stats.tokens && stats.tokens.total) || 0)),
                  h('span', { className: 'tg-chip' }, fmtPct(stats.tokenRatio)),
                  h('span', { className: 'tg-chip' }, topicCount + ' ' + t('topics')),
                ),
                h('span', { className: 'tg-chev' + (open ? ' open' : '') }, '▶'),
              ),
              open ? h('div', { className: 'tg-stage-body' },
                (stage.topicIds || []).map(function (topicId) { return renderTopic(byId[topicId], 0); }),
              ) : null,
            );
          }),
        );
      }

      function renderNoTopics() {
        var ai = (graph && graph.ai) || {};
        var running = ai.status === 'running' || (graph && graph.totals && graph.totals.openTurn);
        return h('div', { className: 'tg-empty' },
          running ? h('div', { className: 'tg-spin' }) : null,
          h('div', null, running ? t('segmenting') : t('noTopics')),
          ai.error ? h('div', { style: { marginTop: '8px', color: 'var(--dsw-alias-state-error-primary,#ef4444)' } }, ai.error) : null,
          !running && !ai.error ? h('div', { style: { marginTop: '10px' } },
            h('button', { className: 'tg-btn primary', onClick: function () { void triggerSegment(false); } }, t('segNow')),
          ) : null,
        );
      }

      function renderLoading() {
        return h('div', { className: 'tg-empty' },
          h('div', { className: 'tg-spin' }),
          h('div', null, t('loading')),
        );
      }

      // ── 渲染：图谱 Tab ──────────────────────────────────────────────────
      function branchTooltipContent(branch) {
        var totals = branch.totals || {};
        var tokens = totals.tokens || {};
        var children = branch.topics || [];
        return h('div', null,
          h('div', { className: 'tg-tip-kind' }, '🤖 ' + t('subagent') + (branch.depth > 1 ? ' L' + branch.depth : '')),
          h('div', { className: 'tg-tip-title' }, branch.title || sessionShortId(branch.sessionId)),
          h('div', { className: 'tg-tip-grid' },
            h('span', { className: 'k' }, t('parentTopic')),
            h('span', { className: 'v' }, branch.parentTopicId ? topicTitleOf(branch.parentTopicId) : '-'),
            h('span', { className: 'k' }, t('range')),
            h('span', { className: 'v' }, t('parentTurn') + ' ' + (branch.parentTurn != null ? branch.parentTurn : '-') + ' · ' + totals.turnCount + ' ' + t('turns')),
            h('span', { className: 'k' }, t('tokens')),
            h('span', { className: 'v' }, fmtK(tokens.total)),
            h('span', { className: 'k' }, t('input') + '/' + t('output')),
            h('span', { className: 'v' }, fmtK(tokens.input) + ' / ' + fmtK(tokens.output)),
            h('span', { className: 'k' }, t('toolCalls')),
            h('span', { className: 'v' }, String((totals.toolCalls && totals.toolCalls.total) || 0)),
            h('span', { className: 'k' }, t('agentTime')),
            h('span', { className: 'v' }, fmtDuration(totals.wallMs)),
          ),
          children.length ? h('div', { className: 'tg-tip-list' },
            h('div', null, t('branchTopics') + ' (' + children.length + ')'),
            children.slice(0, 8).map(function (topic) {
              return h('div', { key: topic.id }, '· ' + topic.title + (topic.stats ? ' · ' + fmtK(topic.stats.tokens.total) : ''));
            }),
          ) : h('div', { className: 'tg-tip-list' }, branch.pending ? t('branchPending') : ''),
          h('div', { className: 'tg-tip-list', style: { marginTop: '4px' } }, t('clickSubagentHint')),
        );
      }

      function branchTopicTooltipContent(node) {
        var branch = node.branch;
        var topic = node.topic;
        var stats = topic.stats || {};
        var tokens = stats.tokens || {};
        var toolCalls = stats.toolCalls || { total: 0, byName: {} };
        var stage = (branch.stages || []).filter(function (item) { return item.id === topic.stageId; })[0] || null;
        var toolEntries = Object.keys(toolCalls.byName || {}).sort(function (a, b) {
          return toolCalls.byName[b] - toolCalls.byName[a];
        }).slice(0, 6);
        return h('div', null,
          h('div', { className: 'tg-tip-kind' }, '🤖 ' + t('subagent') + ' · ' + (branch.title || sessionShortId(branch.sessionId))),
          h('div', { className: 'tg-tip-title' }, topic.title || ''),
          topic.summary ? h('div', { className: 'tg-tip-summary' }, topic.summary) : null,
          h('div', { className: 'tg-tip-grid' },
            h('span', { className: 'k' }, t('range')),
            h('span', { className: 'v' }, (topic.turnStart != null ? topic.turnStart + '-' + topic.turnEnd : '-') + ' · ' + (stats.turnCount || 0) + ' ' + t('turns')),
            h('span', { className: 'k' }, t('tokens')),
            h('span', { className: 'v' }, fmtK(tokens.total || 0) + ' · ' + fmtPct(stats.tokenRatio)),
            h('span', { className: 'k' }, t('input') + '/' + t('output')),
            h('span', { className: 'v' }, fmtK(tokens.input) + ' / ' + fmtK(tokens.output)),
            h('span', { className: 'k' }, t('toolCalls')),
            h('span', { className: 'v' }, String(toolCalls.total || 0) + ' · ' + fmtPct(stats.toolRatio)),
            h('span', { className: 'k' }, t('agentTime')),
            h('span', { className: 'v' }, fmtDuration(stats.wallMs || 0) + ' · ' + fmtPct(stats.wallRatio)),
            stage ? h('span', { className: 'k' }, t('detailStage')) : null,
            stage ? h('span', { className: 'v' }, stage.title) : null,
          ),
          toolEntries.length ? h('div', { className: 'tg-tip-list' },
            h('div', null, t('toolDistribution')),
            toolEntries.map(function (name) { return h('div', { key: name }, name + ' × ' + toolCalls.byName[name]); }),
          ) : null,
          h('div', { className: 'tg-tip-list', style: { marginTop: '4px' } }, t('detailOpen') + ' · ' + t('branchOpen')),
        );
      }

      function nodeTooltipContent(node) {
        if (!node) return null;
        if (node.kind === 'branchHeader' || node.kind === 'branch') return branchTooltipContent(node.branch);
        if (node.kind === 'branchTopic') return branchTopicTooltipContent(node);
        var item = node.kind === 'stage' ? node.stage : node.topic;
        var stats = item.stats || {};
        var tokens = stats.tokens || {};
        var toolCalls = stats.toolCalls || { total: 0, byName: {} };
        var toolEntries = Object.keys(toolCalls.byName || {}).sort(function (a, b) {
          return toolCalls.byName[b] - toolCalls.byName[a];
        }).slice(0, 8);
        return h('div', null,
          h('div', { className: 'tg-tip-kind' }, node.kind === 'stage' ? t('stage') : (item.parentId ? t('subtopics') : t('topic'))),
          h('div', { className: 'tg-tip-title' }, item.title || ''),
          item.summary ? h('div', { className: 'tg-tip-summary' }, item.summary) : null,
          h('div', { className: 'tg-tip-grid' },
            h('span', { className: 'k' }, t('range')),
            h('span', { className: 'v' }, (item.turnStart != null ? item.turnStart + '-' + item.turnEnd : '-') + ' · ' + (stats.turnCount || 0) + ' ' + t('turns')),
            h('span', { className: 'k' }, t('tokens')),
            h('span', { className: 'v' }, fmtK(tokens.total) + ' · ' + fmtPct(stats.tokenRatio)),
            h('span', { className: 'k' }, t('input')),
            h('span', { className: 'v' }, fmtK(tokens.input)),
            h('span', { className: 'k' }, t('output')),
            h('span', { className: 'v' }, fmtK(tokens.output)),
            h('span', { className: 'k' }, t('cacheRead')),
            h('span', { className: 'v' }, fmtK(tokens.cacheRead)),
            h('span', { className: 'k' }, t('toolCalls')),
            h('span', { className: 'v' }, String(toolCalls.total || 0) + ' · ' + fmtPct(stats.toolRatio)),
            h('span', { className: 'k' }, t('agentTime')),
            h('span', { className: 'v' }, fmtDuration(stats.wallMs) + ' · ' + fmtPct(stats.wallRatio)),
            h('span', { className: 'k' }, t('stepTime')),
            h('span', { className: 'v' }, fmtDuration(stats.agentMs)),
            node.kind === 'topic' ? h('span', { className: 'k' }, t('statusActive')) : null,
            node.kind === 'topic' ? h('span', { className: 'v' }, item.status === 'active' ? t('statusActive') : t('statusDone')) : null,
            node.kind === 'topic' && item.branchIds && item.branchIds.length ? h('span', { className: 'k' }, t('subagents')) : null,
            node.kind === 'topic' && item.branchIds && item.branchIds.length ? h('span', { className: 'v' }, String(item.branchIds.length)) : null,
          ),
          node.kind === 'topic' && item.branchIds && item.branchIds.length
            ? h('div', { className: 'tg-tip-list' },
              h('div', null, t('subagents')),
              item.branchIds.slice(0, 6).map(function (sessionId) {
                var branch = branchBySession[sessionId];
                return h('div', { key: sessionId }, '🤖 ' + (branch ? (branch.title || sessionShortId(sessionId)) : sessionShortId(sessionId))
                  + (branch && branch.totals ? ' · ' + fmtK(branch.totals.tokens.total) : ''));
              }),
            )
            : null,
          toolEntries.length ? h('div', { className: 'tg-tip-list' },
            h('div', null, t('toolDistribution')),
            toolEntries.map(function (toolName) {
              return h('div', { key: toolName }, toolName + ' × ' + toolCalls.byName[toolName]);
            }),
          ) : null,
        );
      }

      function renderGraphTooltip() {
        if (!hover) return null;
        var tipWidth = 330;
        var x = clamp(hover.clientX + 16, 8, Math.max(8, window.innerWidth - tipWidth - 12));
        var y = clamp(hover.clientY + 16, 8, Math.max(8, window.innerHeight - 300));
        return h('div', { className: 'tg-tip', style: { left: x + 'px', top: y + 'px', width: tipWidth + 'px' } }, nodeTooltipContent(hover.node));
      }

      function renderGraphToolbar() {
        var scalePct = Math.round(scale * 100);
        var modes = [
          { key: 'tree', label: t('graphModeTree') },
          { key: 'timeline', label: t('graphModeTimeline') },
        ];
        return h('div', { className: 'tg-graph-toolbar' },
          h('span', { className: 'tg-graph-hint' }, t('graphHint')),
          h('span', { className: 'tg-graph-modes' }, modes.map(function (mode) {
            return h('button', {
              key: mode.key,
              className: 'tg-mode-btn' + (graphMode === mode.key ? ' active' : ''),
              title: mode.label,
              onClick: function () { setGraphMode(mode.key); },
            }, mode.label);
          })),
          graphMode === 'tree'
            ? h(React.Fragment, null,
              h('button', { className: 'tg-btn', title: t('zoomOut'), onClick: function () { setScale(clamp(scale * 0.85, 0.35, 2.5)); } }, '−'),
              h('span', { className: 'tg-zoom-pct' }, scalePct + '%'),
              h('button', { className: 'tg-btn', title: t('zoomIn'), onClick: function () { setScale(clamp(scale * 1.18, 0.35, 2.5)); } }, '+'),
              h('button', { className: 'tg-btn', title: t('zoomReset'), onClick: function () { setScale(1); } }, '⟲'))
            : null,
        );
      }

      function scrollTimelineTo(topicId) {
        var el = tlScrollRef.current;
        if (!el) return;
        var pos = buildTimelineLayout(graph || {}, tlBoxW || 900).posById[topicId];
        if (!pos) return;
        try {
          el.scrollLeft = Math.max(0, pos.x - 80);
          el.scrollTop = Math.max(0, pos.y - 100);
        } catch (error) { /* ignore */ }
      }

      function renderTimelineTooltip() {
        if (!tlHover || (!tlHover.topicId && !tlHover.relId)) return null;
        var style = { left: Math.max(8, tlHover.clientX + 14) + 'px', top: Math.max(8, tlHover.clientY + 12) + 'px' };
        if (tlHover.topicId) {
          var topic = byId[tlHover.topicId];
          if (!topic) return null;
          var stats = topic.stats || {};
          var tokens = stats.tokens || {};
          var rels = (graph.relations || []).filter(function (r) { return r.from === tlHover.topicId || r.to === tlHover.topicId; });
          return h('div', { className: 'tg-tl-tip', style: style },
            h('div', { className: 'tg-tl-tip-title' }, topic.title),
            h('div', { className: 'tg-tl-tip-line' },
              (topic.turnStart != null ? turnRange(topic.turnStart, topic.turnEnd) + ' · ' : '') + fmtK(tokens.total || 0) + ' tokens · ' + fmtDuration(stats.wallMs || 0)),
            rels.length ? h('div', { className: 'tg-tl-tip-line tg-tl-tip-rels' },
              rels.map(function (r) { return (r.from === topic.id ? '→ ' : '← ') + (r.label || ''); }).join('  ')) : null,
          );
        }
        var rel = (graph.relations || []).filter(function (r) {
          return ('tlrel:' + r.from + '>' + r.to) === tlHover.relId;
        })[0];
        if (!rel) return null;
        return h('div', { className: 'tg-tl-tip', style: style },
          h('div', { className: 'tg-tl-tip-title' }, rel.label || t('statRelations')),
          h('div', { className: 'tg-tl-tip-line' }, topicTitleOf(rel.from) + ' → ' + topicTitleOf(rel.to)),
        );
      }

      function renderTimelineViewport() {
        var lay = buildTimelineLayout(graph || {}, tlBoxW || 900);
        var hoverTopic = tlHover && tlHover.topicId ? tlHover.topicId : null;
        var hoverRel = (tlHover && tlHover.relId ? tlHover.relId : null) || tlSelRel || null;
        var hoverRelObj = hoverRel ? lay.relations.filter(function (r) { return r.id === hoverRel; })[0] : null;
        function relActive(rel) {
          if (hoverRel) return rel.id === hoverRel;
          if (hoverTopic) return rel.from === hoverTopic || rel.to === hoverTopic;
          return false;
        }
        function barActive(topicId) {
          if (hoverTopic) return topicId === hoverTopic;
          if (hoverRelObj) return hoverRelObj.from === topicId || hoverRelObj.to === topicId;
          return selectedTopicId === topicId;
        }
        var outline = h('div', { className: 'tg-tl-outline' },
          lay.lanes.map(function (lane) {
            return h('div', { key: 'ol-' + lane.stage.id, className: 'tg-tl-stage' },
              h('div', { className: 'tg-tl-stage-head' },
                h('span', { className: 'tg-tl-stage-idx' }, String(lane.index + 1)),
                h('span', { className: 'tg-tl-stage-title', title: lane.stage.title }, lane.stage.title)),
              lane.topics.map(function (topic) {
                var idx = lay.indexById[topic.id];
                var active = selectedTopicId === topic.id || hoverTopic === topic.id;
                return h('div', {
                  key: 'olt-' + topic.id,
                  className: 'tg-tl-topic' + (active ? ' active' : ''),
                  onClick: function () { setSelectedTopicId(topic.id); scrollTimelineTo(topic.id); },
                  title: topic.title,
                },
                  h('span', { className: 'tg-tl-topic-idx' }, 'T' + idx),
                  h('span', { className: 'tg-tl-topic-title' }, topic.title));
              }));
          }));
        var svg = h('svg', {
          className: 'tg-tl-svg' + (hoverRel ? ' has-active' : ''), width: lay.width, height: lay.height,
          onMouseLeave: function () { setTlHover(null); },
          onClick: function () { setTlSelRel(null); },
        },
          lay.ticks.map(function (tick) {
            return h('g', { key: 'tk-' + tick.turn },
              h('line', { className: 'tg-tl-grid', x1: tick.x, y1: lay.rulerH, x2: tick.x, y2: lay.height }),
              h('text', { className: 'tg-tl-tick', x: tick.x, y: 16 }, String(tick.turn)));
          }),
          lay.lanes.map(function (lane) {
            return h('g', { key: 'lane-' + lane.stage.id },
              h('rect', { className: 'tg-tl-lane' + (lane.index % 2 ? ' alt' : ''), x: 0, y: lane.y, width: lay.width, height: lane.h }));
          }),
          lay.nexts.map(function (n) {
            return h('path', { key: n.id, className: 'tg-tl-next', d: n.path });
          }),
          h('defs', null,
            h('marker', { id: 'tg-tl-arrow', viewBox: '0 0 8 8', refX: 8, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' },
              h('path', { d: 'M0,0 L8,4 L0,8 Z', className: 'tg-tl-arrow' }))),
          lay.relations.map(function (rel) {
            var active = relActive(rel);
            return h('g', {
              key: rel.id,
              className: 'tg-tl-rel' + (active ? ' active' : '') + (rel.sameLane ? ' same-lane' : ''),
              onClick: function (event) { event.stopPropagation(); setTlSelRel(rel.id); },
              onMouseEnter: function (event) { setTlHover({ relId: rel.id, clientX: event.clientX, clientY: event.clientY }); },
              onMouseMove: function (event) { setTlHover({ relId: rel.id, clientX: event.clientX, clientY: event.clientY }); },
              onMouseLeave: function () { setTlHover(null); },
            },
              h('path', { className: 'tg-tl-rel-hit', d: rel.path }),
              h('path', { className: 'tg-tl-rel-path', d: rel.path }),
              h('text', { className: 'tg-tl-rel-label', x: rel.labelX, y: rel.labelY }, rel.label));
          }),
          lay.lanes.map(function (lane) {
            return lane.topics.map(function (topic) {
              var pos = lay.posById[topic.id];
              var active = barActive(topic.id);
              return h('g', {
                key: 'bar-' + topic.id,
                className: 'tg-tl-bar' + (active ? ' active' : ''),
                style: { '--tg-bar-color': TIMELINE_PALETTE[lane.index % TIMELINE_PALETTE.length] },
                onClick: function () { openDetail(topic.id); },
                onMouseEnter: function (event) { setTlHover({ topicId: topic.id, clientX: event.clientX, clientY: event.clientY }); },
                onMouseMove: function (event) { setTlHover({ topicId: topic.id, clientX: event.clientX, clientY: event.clientY }); },
                onMouseLeave: function () { setTlHover(null); },
              },
                h('rect', { className: 'tg-tl-bar-rect', x: pos.x, y: pos.y, width: pos.w, height: pos.h, rx: 2 }));
            });
          }),
        );
        return h(React.Fragment, null,
          renderGraphToolbar(),
          h('div', { className: 'tg-tl-split' },
            outline,
            h('div', { className: 'tg-tl-scroll', ref: tlScrollRef, onScroll: function () { setTlHover(null); } }, svg),
          ),
          renderTimelineTooltip(),
        );
      }

      function renderGraph() {
        if (!graph) return renderLoading();
        if (!graph.turns || !graph.turns.length) return h('div', { className: 'tg-empty' }, t('noTurns'));
        if (!(graph.stages || []).length) return renderNoTopics();
        if (graphMode === 'timeline') return renderTimelineViewport();
        var scalePct = Math.round(scale * 100);
        var edgeTypes = layout.edgeTypes || [];
        var legend = [
          { key: 'next', label: t('graphLegendNext'), cls: 'n' },
          { key: 'belongTo', label: t('graphLegendBelong'), cls: 'b' },
          { key: 'has_relation', label: t('graphLegendRelation'), cls: 'r' },
          { key: 'delegates', label: t('graphLegendDelegate'), cls: 'd' },
        ].filter(function (item) { return edgeTypes.indexOf(item.key) !== -1; });
        return h(React.Fragment, null,
          renderGraphToolbar(),
          legend.length
            ? h('div', { className: 'tg-legend' }, legend.map(function (item) {
              return h('span', { key: item.key, className: item.cls }, h('i'), item.label);
            }))
            : null,
          h('div', {
            className: 'tg-graph-viewport',
            ref: viewportRef,
            onMouseLeave: function () { setHover(null); },
            onClick: function () { setSelectedEdgeId(null); },
          },
            h('div', {
              className: 'tg-graph-canvas',
              style: { width: layout.width * scale + 'px', height: layout.height * scale + 'px' },
            },
              h('div', {
                className: 'tg-graph-content',
                style: { width: layout.width + 'px', height: layout.height + 'px', transform: 'scale(' + scale + ')' },
              },
                h('svg', { className: 'tg-edges', width: layout.width, height: layout.height },
                  h('defs', null,
                    h('marker', { id: 'tg-arrow-rel', viewBox: '0 0 8 8', refX: 8, refY: 4, markerWidth: 8, markerHeight: 8, orient: 'auto' },
                      h('path', { d: 'M0,0 L8,4 L0,8 Z', className: 'tg-arrow tg-arrow-rel' })),
                    h('marker', { id: 'tg-arrow-next', viewBox: '0 0 8 8', refX: 8, refY: 4, markerWidth: 8, markerHeight: 8, orient: 'auto' },
                      h('path', { d: 'M0,0 L8,4 L0,8 Z', className: 'tg-arrow tg-arrow-next' })),
                    h('marker', { id: 'tg-arrow-deleg', viewBox: '0 0 8 8', refX: 8, refY: 4, markerWidth: 8, markerHeight: 8, orient: 'auto' },
                      h('path', { d: 'M0,0 L8,4 L0,8 Z', className: 'tg-arrow tg-arrow-deleg' })),
                    h('marker', { id: 'tg-arrow-sel', viewBox: '0 0 8 8', refX: 8, refY: 4, markerWidth: 8, markerHeight: 8, orient: 'auto' },
                      h('path', { d: 'M0,0 L8,4 L0,8 Z', className: 'tg-arrow tg-arrow-sel' })),
                  ),
                  layout.edges.map(function (edge) {
                    var selected = selectedEdgeId != null && selectedEdgeId === edge.id;
                    var toggleSelect = function (event) {
                      event.stopPropagation();
                      setSelectedEdgeId(selected ? null : edge.id);
                    };
                    return h('g', { key: edge.id },
                      edge.labelBg && edge.label
                        ? h('rect', {
                          className: 'tg-edge-label-bg' + (selected ? ' selected' : ''),
                          x: edge.labelBg.x, y: edge.labelBg.y, width: edge.labelBg.w, height: edge.labelBg.h, rx: 8,
                          pointerEvents: 'auto',
                          onClick: toggleSelect,
                        })
                        : null,
                      h('path', {
                        className: 'tg-edge-hit',
                        d: edge.path,
                        title: edge.label || '',
                        onClick: toggleSelect,
                      }),
                      h('path', {
                        className: 'tg-edge tg-edge-' + edge.type + (selected ? ' selected' : ''),
                        d: edge.path,
                        markerEnd: selected ? 'url(#tg-arrow-sel)' : (edge.marker ? 'url(#tg-arrow-' + edge.marker + ')' : undefined),
                      }),
                      edge.label ? h('text', { className: 'tg-edge-label' + (selected ? ' selected' : ''), x: edge.labelX, y: edge.labelY }, edge.label) : null,
                    );
                  }),
                ),
                // 阶段分组框（belongTo 的容器可视化）
                layout.stageBoxes.map(function (box) {
                  var stageIndex = (graph.stages || []).findIndex(function (item) { return item.id === box.id; });
                  var branchCount = (graph.branches || []).filter(function (branch) {
                    var topic = byId[branch.parentTopicId];
                    return topic && topic.stageId === box.id;
                  }).length;
                  return h('div', {
                    key: 'stage-box-' + box.id,
                    className: 'tg-stage-box',
                    style: { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' },
                  },
                    h('div', { className: 'tg-stage-box-head' },
                      h('span', {
                        className: 'tg-stage-toggle',
                        title: box.collapsed ? t('expandStage') : t('collapseStage'),
                        onClick: function (event) { event.stopPropagation(); toggleGraphCollapse('stages', box.id); },
                      }, box.collapsed ? '▸' : '▾'),
                      h('span', { className: 'tg-stage-box-idx' }, String(stageIndex + 1)),
                      h('span', { className: 'tg-stage-box-title' }, box.stage.title),
                      box.collapsed ? h('span', { className: 'tg-stage-box-chip' }, box.topicCount + ' ' + t('topics')) : null,
                      branchCount ? h('span', { className: 'tg-stage-box-chip' }, '🤖' + branchCount) : null,
                      h('span', { className: 'tg-stage-box-chip' }, t('tokens') + ' ' + fmtK(((box.stage.stats || {}).tokens || {}).total || 0)),
                    ),
                  );
                }),
                // 子智能体分支：分支框 + 会话头 + 它自己的话题树（与主图同屏）
                (layout.branchBoxes || []).map(function (box) {
                  var branch = box.branch;
                  var headerText = '🤖 ' + t('subagent') + ' · ' + (branch.title || sessionShortId(branch.sessionId));
                  return h('div', {
                    key: 'branchbox-' + branch.sessionId,
                    className: 'tg-branch-box',
                    style: { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' },
                  }, h('span', { className: 'tg-branch-box-label' }, headerText));
                }),
                layout.branchNodes.map(function (node) {
                  var branch = node.branch;
                  if (node.kind === 'branchHeader') {
                    var totals = branch.totals || {};
                    return h('div', {
                      key: node.id,
                      className: 'tg-branch-header' + (branch.pending ? ' pending' : ''),
                      style: { left: node.x + 'px', top: node.y + 'px', width: node.w + 'px', height: node.h + 'px', zIndex: 6 },
                      onMouseEnter: function (event) { setHover({ node: node, clientX: event.clientX, clientY: event.clientY }); },
                      onMouseMove: function (event) { setHover({ node: node, clientX: event.clientX, clientY: event.clientY }); },
                      onMouseLeave: function () { setHover(null); },
                      onClick: function () { selectSession(branch.sessionId); },
                    },
                      node.topicCount ? h('span', {
                        className: 'tg-branch-toggle',
                        title: node.collapsed ? t('expandBranch') : t('collapseBranch'),
                        onClick: function (event) { event.stopPropagation(); toggleGraphCollapse('branches', branch.sessionId); },
                      }, node.collapsed ? '▸' : '▾') : null,
                      h('span', { className: 'tg-branch-ico' }, '🤖'),
                      h('span', { className: 'tg-branch-title-text' }, branch.title || sessionShortId(branch.sessionId)),
                      node.collapsed ? h('span', { className: 'tg-branch-header-meta' }, node.topicCount + ' ' + t('topics')) : null,
                      h('span', { className: 'tg-branch-header-meta' },
                        (totals.turnCount || 0) + ' ' + t('turns') + ' · ' + fmtK((totals.tokens || {}).total || 0)),
                      node.depth > 1 ? h('span', { className: 'tg-branch-depth' }, 'L' + node.depth) : null,
                    );
                  }
                  var topic = node.topic;
                  var stats = topic.stats || {};
                  var tokens = stats.tokens || {};
                  return h('div', {
                    key: node.id,
                    className: 'tg-branch-topic',
                    style: { left: node.x + 'px', top: node.y + 'px', width: node.w + 'px', height: node.h + 'px', zIndex: 6 },
                    onMouseEnter: function (event) { setHover({ node: node, clientX: event.clientX, clientY: event.clientY }); },
                    onMouseMove: function (event) { setHover({ node: node, clientX: event.clientX, clientY: event.clientY }); },
                    onMouseLeave: function () { setHover(null); },
                    onClick: function () { openChildDetail(branch.sessionId, topic.id); },
                  },
                    h('div', { className: 'tg-branch-topic-title' }, topic.title),
                    h('div', { className: 'tg-branch-topic-meta' },
                      h('span', null, turnRange(topic.turnStart, topic.turnEnd)),
                      h('span', null, fmtK(tokens.total || 0)),
                      h('span', null, fmtPct(stats.tokenRatio)),
                      h('span', null, fmtDuration(stats.wallMs || 0)),
                    ),
                    h('div', { className: 'tg-node-bar' }, h('i', { style: { width: Math.max(1, (stats.tokenRatio || 0) * 100) + '%' } })),
                  );
                }),
                // 主列：阶段 → 话题 → 子话题
                layout.nodes.map(function (node) {
                  var topic = node.topic;
                  var stats = topic.stats || {};
                  var tokens = stats.tokens || {};
                  var isActive = topic.status === 'active';
                  var branchCount = (topic.branchIds || []).length;
                  return h('div', {
                    key: 'node-' + node.id,
                    className: 'tg-node' + (isActive ? ' active' : ''),
                    style: {
                      left: node.x + 'px',
                      top: node.y + 'px',
                      width: node.w + 'px',
                      height: node.h + 'px',
                      zIndex: node.depth + 2,
                    },
                    onMouseEnter: function (event) { setHover({ node: node, clientX: event.clientX, clientY: event.clientY }); },
                    onMouseMove: function (event) { setHover({ node: node, clientX: event.clientX, clientY: event.clientY }); },
                    onMouseLeave: function () { setHover(null); },
                    onClick: function () { openDetail(topic.id); },
                  },
                    h('div', { className: 'tg-node-title' },
                      node.childCount ? h('span', {
                        className: 'tg-node-toggle',
                        title: node.collapsed ? t('expandTopic') : t('collapseTopic'),
                        onClick: function (event) { event.stopPropagation(); toggleGraphCollapse('topics', topic.id); },
                      }, node.collapsed ? '▸' : '▾') : null,
                      h('span', { className: 'tg-node-title-text' }, topic.title),
                    ),
                    h('div', { className: 'tg-node-meta' },
                      h('span', null, (turnRange(topic.turnStart, topic.turnEnd))),
                      node.collapsed && node.childCount ? h('span', { className: 'tg-node-depth-tag' }, node.childCount + ' ' + t('subtopics')) : null,
                      node.depth > 0 ? h('span', { className: 'tg-node-depth-tag' }, 'L' + (node.depth + 1)) : null,
                      branchCount ? h('span', { className: 'tg-node-depth-tag', style: { color: 'var(--dsw-alias-state-warn-primary,#ca8a04)' } }, '🤖' + branchCount) : null,
                      h('span', null, fmtK(tokens.total)),
                      h('span', null, fmtPct(stats.tokenRatio)),
                      h('span', null, t('toolCalls') + ' ' + String((stats.toolCalls && stats.toolCalls.total) || 0)),
                      h('span', null, fmtDuration(stats.wallMs)),
                    ),
                    h('div', { className: 'tg-node-bar' }, h('i', { style: { width: Math.max(1, (stats.tokenRatio || 0) * 100) + '%' } })),
                  );
                }),
              ),
            ),
          ),
          renderGraphTooltip(),
        );
      }

      // ── 渲染：会话选择器 ────────────────────────────────────────────────
      // ── 渲染：整体 ─────────────────────────────────────────────────────
      var styleElement = h('style', { key: 'tg-style' }, CSS);

      var totals = (graph && graph.totals) || null;
      var ai = (graph && graph.ai) || {};
      var statusClass = ai.status === 'running' ? 'running' : (ai.error ? 'error' : 'ok');
      var subagentBranchCount = totals && totals.subagent ? (totals.subagent.branchCount || 0) : 0;
      var subagentPending = (graph && graph.branches ? graph.branches : []).filter(function (branch) {
        return branch.pending || (branch.ai && (branch.ai.status === 'running' || branch.ai.pendingTurns > 0));
      }).length;
      var statusText = ai.status === 'running'
        ? t('segmenting')
        : (ai.error ? (t('aiFailed') + '：' + ai.error)
          : (ai.pendingTurns > 0 ? t('pendingTurns', { n: ai.pendingTurns })
            : (subagentPending > 0 ? t('segmenting') + ' · 🤖' + subagentPending
              : t('updatedAt', { time: fmtClock(Date.parse(graph && graph.updatedAt) || 0) })
                + (ai.relationError ? ' · ' + t('statRelations') + '：' + summarizeText(ai.relationError, 40) : ''))));

      var modelSelect = h('select', {
        className: 'tg-model-select',
        value: modelSel,
        title: t('modelLabel'),
        onChange: function (event) { onModelChange(event.target.value); },
      },
        h('option', { value: '' }, t('modelDefault')),
        modelProviders.map(function (p) {
          return h('optgroup', { key: p.id, label: p.name || p.id },
            (p.models || []).map(function (m) {
              return h('option', { key: p.id + ':' + m.id, value: p.id + ':' + m.id }, m.name || m.id);
            }));
        }),
      );

      return h(React.Fragment, null, styleElement,
        h('div', { className: 'tg-root tg-root-docked', ref: panelRef },
          h('div', { className: 'tg-topbar' },
            h('div', { className: 'tg-topbar-row' },
              h('span', { className: 'tg-view-toggle' },
                h('button', {
                  className: 'tg-view-btn' + (ui.tab === 'chain' ? ' active' : ''),
                  onClick: function () { setUi(function (prev) { return Object.assign({}, prev, { tab: 'chain' }); }); },
                  title: t('tabChain'),
                }, t('viewWorkflow')),
                h('button', {
                  className: 'tg-view-btn' + (ui.tab === 'graph' ? ' active' : ''),
                  onClick: function () { setUi(function (prev) { return Object.assign({}, prev, { tab: 'graph' }); }); },
                  title: t('tabGraph'),
                }, t('viewGraph')),
              ),
              h('span', { className: 'tg-topbar-spacer' }),
              h('span', { className: 'tg-dot ' + statusClass }),
              modelSelect,
              h('button', { className: 'tg-btn', title: t('refresh'), onClick: function () { versionRef.current = null; setReloadKey(function (n) { return n + 1; }); } }, '↻'),
              h('button', { className: 'tg-btn', disabled: actionBusy, onClick: function () { void triggerSegment(true); } }, t('resegment')),
              h('button', { className: 'tg-btn primary', disabled: actionBusy, onClick: function () { void triggerSegment(false); } }, t('segNow')),
            ),
            renderStatsStrip(),
          ),
          !uiSettingsNow.enabled ? h('div', { className: 'tg-banner tg-banner-disabled' },
            h('span', { className: 'tg-banner-text' }, t('disabledBanner') + ' · ' + t('disabledHint')),
          ) : null,
          error ? h('div', { className: 'tg-banner' },
            h('span', { className: 'tg-banner-text', title: error }, error),
            h('button', { onClick: function () { versionRef.current = null; setError(''); setReloadKey(function (n) { return n + 1; }); } }, t('retry')),
          ) : null,
          ai.error && !error ? h('div', { className: 'tg-banner' },
            h('span', { className: 'tg-banner-text', title: ai.error }, t('aiFailed') + '：' + ai.error),
            h('button', { onClick: function () { void triggerSegment(false); } }, t('retry')),
          ) : null,
          h('div', { className: 'tg-body' },
            ui.tab === 'chain'
              ? h('div', { className: 'tg-workflow' },
                h('div', { className: 'tg-workflow-tree' }, renderWorkflowTree()),
                h('div', { className: 'tg-workflow-detail', ref: wfDetailRef }, renderWorkflowDetail()),
              )
              : h('div', { className: 'tg-graph' }, renderGraph(), renderDetail(false)),
          ),
          h('div', { className: 'tg-foot' },
            ai.status === 'running'
              ? h('div', { className: 'tg-progress', title: Math.round((ai.progress || 0) * 100) + '%' },
                h('i', { style: { width: Math.max(2, Math.round((ai.progress || 0) * 100)) + '%' } }))
              : null,
            h('span', { className: 'tg-foot-status' + (ai.status === 'running' ? ' running' : (ai.error ? ' error' : '')) }, statusText),
            h('span', { className: 'tg-version', title: 'client bundle v' + CLIENT_VERSION }, 'v' + CLIENT_VERSION),
          ),
        ),
      );
    }

    // ── 设置页：启用/停用后端服务 + 插件界面语言 ──────────────────────────────
    function TopicGraphSettingsPage(props) {
      useLocaleTick();
      var settings = useUiSettings();
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var noteState = useState('');
      var note = noteState[0];
      var setNote = noteState[1];

      function applyPatch(patch) {
        if (busy) return;
        setBusy(true);
        setNote('');
        saveUiSettings(patch).then(function (data) {
          setUiSettings(data);
          setNote(t('settingsSaved'));
        }).catch(function (error) {
          setNote(t('settingsSaveFailed') + (error && error.message ? '：' + error.message : ''));
        }).then(function () { setBusy(false); });
      }

      var langOptions = ['auto', 'zh', 'en'];
      return h('div', { className: 'tg-settings-page' },
        h('h3', { className: 'tg-settings-title' }, t('settingsTitle')),
        h('p', { className: 'tg-settings-desc' }, t('settingsDesc')),
        h('div', { className: 'tg-settings-row' },
          h('div', { className: 'tg-settings-label' },
            h('span', { className: 'tg-settings-name' }, t('settingsService')),
            h('span', { className: 'tg-settings-hint' }, t('settingsServiceDesc'))),
          h('button', {
            className: 'tg-switch' + (settings.enabled ? ' on' : ''),
            disabled: busy,
            role: 'switch',
            'aria-checked': settings.enabled ? 'true' : 'false',
            onClick: function () { applyPatch({ enabled: !settings.enabled }); },
          },
            h('i', { className: 'tg-switch-knob' }),
            h('span', { className: 'tg-switch-text' }, settings.enabled ? t('settingsEnabled') : t('settingsDisabled')))),
        h('div', { className: 'tg-settings-row' },
          h('div', { className: 'tg-settings-label' },
            h('span', { className: 'tg-settings-name' }, t('settingsLanguage')),
            h('span', { className: 'tg-settings-hint' }, t('settingsLanguageDesc'))),
          h('div', { className: 'tg-settings-options' }, langOptions.map(function (value) {
            var label = value === 'auto' ? t('settingsLangAuto') : (value === 'zh' ? t('settingsLangZh') : t('settingsLangEn'));
            return h('button', {
              key: value,
              className: 'tg-settings-opt' + (settings.uiLocale === value ? ' active' : ''),
              disabled: busy,
              onClick: function () { applyPatch({ uiLocale: value }); },
            }, label);
          }))),
        h('div', { className: 'tg-settings-note' }, t('settingsLanguageNote')),
        note ? h('div', { className: 'tg-settings-note tg-settings-note-saved' }, note) : null,
      );
    }

    // ── 导出 ────────────────────────────────────────────────────────────────

    exports.name = 'dsh-topic-graph';
    exports.inject = ['slots'];
    // 仅供本地测试的纯函数钩子（Loader 只读取 name/inject/apply）
    exports.__test = { buildLayout, buildTimelineLayout, loadUi, defaultPanelWidth, readSidebarCurrentSession, t, setUiSettings, getUiSettings: function () { return uiSettings; } };
    exports.apply = function (ctx) {
      appCtx = ctx;
      initLocale(ctx);
      var disposers = [];
      // 停靠在「对话 / 轨迹」之后的新视图（与 dsh-context 同款 conversation.view 注册）
      disposers.push(ctx.slots.inject('conversation.view', function () {
        return ctx.slots.register({
          name: 'conversation.view',
          id: 'topic-graph',
          order: 20,
          locale: LOC_NS,
          label: function () { return t('panelTitle'); },
        }, TopicGraphPanel);
      }));
      // 设置页（settings.section：一页一个；启用/停用后端服务 + 界面语言）
      disposers.push(ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'topic-graph',
          order: 25,
          locale: LOC_NS,
          label: function () { return t('settingsTitle'); },
        }, TopicGraphSettingsPage);
      }));
      return function () {
        disposers.forEach(function (dispose) {
          try { if (typeof dispose === 'function') dispose(); } catch (error) { /* ignore */ }
        });
      };
    };

    return module.exports;
  },
});
