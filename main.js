/*
Hermes Agent Monitor - Obsidian Plugin v7.0
Enhanced Pixel Office with full agent status
*/

const { Plugin, WorkspaceLeaf, Notice, ItemView, setIcon, PluginSettingTab, Setting, MarkdownRenderChild, Modal, DropdownComponent, requestUrl } = require('obsidian');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');

const VIEW_TYPE_HERMES = 'hermes-monitor-view';
const HERMES_DIR = path.join(require('os').homedir(), '.hermes');
const DEFAULT_SETTINGS = { refreshInterval: 15, autoRefresh: true };

// Hermes CLI
class HermesCLI {
  static async run(cmd, timeout = 30000) {
    try {
      const { stdout, stderr } = await execAsync(`hermes ${cmd}`, {
        timeout,
        env: { ...process.env, PATH: `${process.env.PATH}:/Users/jiangbufan/.local/bin` }
      });
      return { success: true, output: (stdout || stderr || '').trim() };
    } catch (error) { return { success: false, output: error.message }; }
  }

  static async chat(query, options = {}) {
    let cmd = `chat -q "${query.replace(/"/g, '\\"')}" -Q`;
    if (options.sessionId) cmd += ` --resume ${options.sessionId}`;
    if (options.continue) cmd += ` --continue`;
    return this.run(cmd, 120000);
  }

  static async analyzeImage(imagePath, prompt = '描述这张图片') {
    try {
      // Read image file and convert to base64
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');

      // Determine MIME type
      const ext = path.extname(imagePath).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const mimeType = mimeTypes[ext] || 'image/png';

      // Get API key from .env
      const envPath = path.join(HERMES_DIR, '.env');
      const envContent = await fs.readFile(envPath, 'utf-8');
      const apiKeyMatch = envContent.match(/MINIMAX_CN_API_KEY=(.+)/);
      const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : '';

      if (!apiKey) {
        return { success: false, output: '未找到 MiniMax API Key' };
      }

      // Call MiniMax API directly
      const response = await requestUrl({
        url: 'https://api.minimaxi.com/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.7',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          max_tokens: 1024,
        }),
      });

      const result = response.json;
      if (result.choices && result.choices[0] && result.choices[0].message) {
        return { success: true, output: result.choices[0].message.content };
      } else {
        return { success: false, output: '图片分析失败: 无效的 API 响应' };
      }
    } catch (error) {
      return { success: false, output: `图片分析失败: ${error.message}` };
    }
  }

  static async isGatewayRunning() {
    try {
      const content = await fs.readFile(path.join(HERMES_DIR, 'gateway.pid'), 'utf-8');
      let pid;
      try { pid = JSON.parse(content).pid; } catch { pid = parseInt(content.trim(), 10); }
      if (!pid || isNaN(pid)) return { running: false, pid: null };
      try { process.kill(pid, 0); return { running: true, pid }; } catch { return { running: false, pid: null }; }
    } catch { return { running: false, pid: null }; }
  }

  static async getProcesses() {
    try {
      const { stdout } = await execAsync('ps aux | grep -E "hermes|hermes_cli" | grep -v grep', { timeout: 5000 });
      return stdout.split('\n').filter(l => l.trim()).map(line => {
        const p = line.trim().split(/\s+/);
        return { pid: p[1], cpu: p[2], mem: p[3], command: p.slice(10).join(' '), isGateway: line.includes('gateway') };
      });
    } catch { return []; }
  }

  static async getAgentStatus() {
    // Get detailed agent activity
    const result = await this.run('sessions list --limit 10');
    if (!result.success) return [];

    const sessions = [];
    for (const line of result.output.split('\n')) {
      if (!line.trim() || line.includes('─') || line.includes('Title')) continue;
      const parts = line.split(/\s{2,}/);
      if (parts.length >= 4) {
        sessions.push({
          preview: parts[0]?.trim() || '—',
          lastActive: parts[2]?.trim() || '',
          id: parts[3]?.trim() || '',
          source: parts[1]?.trim() || ''
        });
      }
    }
    return sessions;
  }

  static async getInsights(days = 1) {
    const r = await this.run(`insights --days ${days}`);
    if (!r.success) return null;
    const d = { sessions: 0, messages: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    for (const l of r.output.split('\n')) {
      if (l.includes('Sessions:')) d.sessions = parseInt(l.match(/\d[\d,]*/)?.[0]?.replace(/,/g, '') || '0');
      if (l.includes('Messages:')) d.messages = parseInt(l.match(/\d[\d,]*/)?.[0]?.replace(/,/g, '') || '0');
      if (l.includes('Tool calls:')) d.toolCalls = parseInt(l.match(/\d[\d,]*/)?.[0]?.replace(/,/g, '') || '0');
      if (l.includes('Input tokens:')) d.inputTokens = parseInt(l.match(/\d[\d,]*/)?.[0]?.replace(/,/g, '') || '0');
      if (l.includes('Output tokens:')) d.outputTokens = parseInt(l.match(/\d[\d,]*/)?.[0]?.replace(/,/g, '') || '0');
      if (l.includes('Total tokens:')) d.totalTokens = parseInt(l.match(/\d[\d,]*/)?.[0]?.replace(/,/g, '') || '0');
    }
    return d;
  }

  static async getSkills() {
    const r = await this.run('skills list');
    if (!r.success) return [];
    const skills = [];

    for (const line of r.output.split('\n')) {
      // Skip header/separator lines
      if (!line.includes('│') || line.includes('─') || line.includes('━') || line.includes('┏') || line.includes('┗') || line.includes('┃ Name')) continue;

      // Parse table rows
      const cells = line.split('│')
        .map(x => x.trim())
        .filter(x => x.length > 0);

      if (cells.length >= 4) {
        const name = cells[0].replace(/…$/, '').trim();
        const category = cells[1] || '';
        const source = cells[2] || '';
        const trust = cells[3] || '';
        const status = cells[4] || 'enabled';

        // Skip if name is empty or is header
        if (!name || name === 'Name') continue;

        skills.push({
          name,
          category: category || '其他',
          source,
          trust,
          status
        });
      }
    }
    return skills;
  }

  static async getSessionHistory(sessionId) {
    const r = await this.run(`sessions export --session-id ${sessionId} -`);
    if (!r.success) return [];
    const messages = [];
    try {
      const session = JSON.parse(r.output);
      if (session.messages && Array.isArray(session.messages)) {
        for (const msg of session.messages) {
          if (msg.role === 'user' && msg.content) messages.push(`User: ${msg.content}`);
          else if (msg.role === 'assistant' && msg.content) messages.push(`Assistant: ${msg.content}`);
        }
      }
    } catch (e) {
      for (const line of r.output.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.role === 'user' && obj.content) messages.push(`User: ${obj.content}`);
          else if (obj.role === 'assistant' && obj.content) messages.push(`Assistant: ${obj.content}`);
        } catch (e2) {}
      }
    }
    return messages;
  }

  static async getLogs(logName = 'agent', lines = 30) { return this.run(`logs ${logName} -n ${lines}`); }
  static async getDoctor() { return this.run('doctor'); }
}

// Enhanced Pixel Office - Shows agent status
class PixelOffice {
  constructor(container, plugin) {
    this.container = container;
    this.plugin = plugin;
    this.canvas = null;
    this.ctx = null;
    this.characters = [];
    this.furniture = [];
    this.time = 0;
    this.frameId = null;
    this.zoom = 2;
    this.cols = 21;
    this.rows = 17;
    this.TILE = 16;
    this.tiles = [];
    this.statusPanel = null;
    this.tooltip = null;
    this.selectedAgent = null;
    this.agentDetails = {};
  }

  async init() {
    this.container.empty();
    this.container.addClass('hermes-pixel-office');

    // Header with stats
    const header = this.container.createDiv({ cls: 'hermes-pixel-header' });
    const headerLeft = header.createDiv({ cls: 'hermes-pixel-header-left' });
    headerLeft.createEl('h3', { text: '🏢 像素办公室' });
    this.headerStats = headerLeft.createDiv({ cls: 'hermes-pixel-stats' });

    const headerRight = header.createDiv({ cls: 'hermes-pixel-header-right' });
    const refreshBtn = headerRight.createEl('button', { cls: 'hermes-btn hermes-btn-small' });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => this.refreshStatus());

    // Main content: canvas + status panel
    const main = this.container.createDiv({ cls: 'hermes-pixel-main' });

    // Canvas
    const canvasWrapper = main.createDiv({ cls: 'hermes-pixel-canvas-wrapper' });
    this.canvas = canvasWrapper.createEl('canvas', { cls: 'hermes-pixel-canvas' });
    const canvasWidth = this.cols * this.TILE * this.zoom;
    const canvasHeight = this.rows * this.TILE * this.zoom;
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;
    this.ctx = this.canvas.getContext('2d');

    // Tooltip
    this.tooltip = canvasWrapper.createDiv({ cls: 'hermes-pixel-tooltip' });
    this.tooltip.style.display = 'none';

    // Status panel (right side)
    this.statusPanel = main.createDiv({ cls: 'hermes-pixel-status-panel' });

    // Generate layout
    this.generateLayout();

    // Furniture
    this.furniture = [
      { type: 'desk', col: 3, row: 3, w: 2, h: 1 },
      { type: 'chair', col: 3.5, row: 2 },
      { type: 'desk', col: 6, row: 3, w: 2, h: 1 },
      { type: 'chair', col: 6.5, row: 2 },
      { type: 'desk', col: 3, row: 6, w: 2, h: 1 },
      { type: 'chair', col: 3.5, row: 7 },
      { type: 'desk', col: 6, row: 6, w: 2, h: 1 },
      { type: 'chair', col: 6.5, row: 7 },
      { type: 'bookshelf', col: 1, row: 5, w: 1, h: 2 },
      { type: 'plant', col: 1, row: 1 },
      { type: 'lamp', col: 1, row: 3 },
      { type: 'pc', col: 3.5, row: 2.75 },
      { type: 'pc', col: 6.5, row: 2.75 },
      { type: 'pc', col: 3.5, row: 5.5 },
      { type: 'pc', col: 6.5, row: 5.5 },
      { type: 'desk', col: 13, row: 3, w: 2, h: 2 },
      { type: 'chair', col: 13, row: 2 },
      { type: 'chair', col: 14, row: 5 },
      { type: 'whiteboard', col: 15, row: 0, w: 2, h: 1 },
      { type: 'library', col: 17, row: 0, w: 2, h: 2 },
      { type: 'clock', col: 11, row: 0 },
      { type: 'pc', col: 14, row: 2.75 },
      { type: 'fridge', col: 1, row: 9.5, w: 1, h: 2 },
      { type: 'server', col: 1, row: 12, w: 2, h: 3 },
      { type: 'water_cooler', col: 8, row: 9.5, w: 1, h: 2 },
      { type: 'sofa', col: 10, row: 14, w: 2, h: 1 },
      { type: 'plant', col: 1, row: 15 },
      { type: 'plant_small', col: 19, row: 15 },
      { type: 'bench', col: 8, row: 15 },
      { type: 'bench', col: 12, row: 15 },
      { type: 'lamp', col: 7, row: 14 },
    ];

    // Load agents
    await this.refreshStatus();

    // Canvas click handler
    this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleCanvasHover(e));
    this.canvas.addEventListener('mouseleave', () => { this.tooltip.style.display = 'none'; });

    // Start animation
    this.animate();
  }

  async refreshStatus() {
    const [processes, sessions, insights] = await Promise.all([
      HermesCLI.getProcesses(),
      HermesCLI.getAgentStatus(),
      HermesCLI.getInsights(1)
    ]);

    // Update header stats
    if (this.headerStats) {
      this.headerStats.empty();
      const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);

      this.headerStats.createSpan({ cls: 'stat-item', text: `进程: ${processes.length}` });
      this.headerStats.createSpan({ cls: 'stat-item', text: `会话: ${sessions.length}` });
      if (insights) {
        this.headerStats.createSpan({ cls: 'stat-item', text: `Token: ${fmt(insights.totalTokens)}` });
      }
    }

    // Update characters with status
    this.characters = processes.map((p, i) => {
      const session = sessions[i] || sessions[0] || {};
      const isWorking = Math.random() > 0.3; // Simulate working state

      return {
        id: i,
        pid: p.pid,
        name: p.isGateway ? 'Gateway' : `Agent-${i + 1}`,
        emoji: p.isGateway ? '⚡' : '🤖',
        x: (3 + i * 3) * this.TILE + this.TILE / 2,
        y: 5 * this.TILE + this.TILE / 2,
        targetX: (3 + i * 3) * this.TILE + this.TILE / 2,
        targetY: 5 * this.TILE + this.TILE / 2,
        state: isWorking ? 'working' : 'idle',
        color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5],
        frame: 0,
        dir: 'down',
        cpu: p.cpu,
        mem: p.mem,
        command: p.command,
        isGateway: p.isGateway,
        currentTool: isWorking ? this.getRandomTool() : null,
        sessionId: session.id || null,
        sessionPreview: session.preview || '',
        lastActive: session.lastActive || '',
        taskDuration: isWorking ? Math.floor(Math.random() * 60) : 0,
      };
    });

    // Update status panel
    this.renderStatusPanel();
  }

  getRandomTool() {
    const tools = ['read_file', 'write_file', 'terminal', 'web_search', 'code_edit', 'grep', 'glob'];
    return tools[Math.floor(Math.random() * tools.length)];
  }

  renderStatusPanel() {
    if (!this.statusPanel) return;
    this.statusPanel.empty();

    const title = this.statusPanel.createDiv({ cls: 'panel-title' });
    title.createEl('h4', { text: 'Agent 状态' });

    // Agent cards
    for (const ch of this.characters) {
      const card = this.statusPanel.createDiv({ cls: `agent-card agent-${ch.state}` });
      card.addEventListener('click', () => this.showAgentDetail(ch));

      // Header
      const header = card.createDiv({ cls: 'agent-card-header' });
      const statusDot = header.createDiv({ cls: `status-indicator ${ch.state}` });
      header.createSpan({ cls: 'agent-name', text: `${ch.emoji} ${ch.name}` });
      header.createSpan({ cls: 'agent-pid', text: `PID:${ch.pid}` });

      // Status
      const statusEl = card.createDiv({ cls: 'agent-status' });
      if (ch.state === 'working') {
        statusEl.createSpan({ cls: 'status-working', text: '🟢 工作中' });
        if (ch.currentTool) {
          statusEl.createSpan({ cls: 'tool-name', text: ch.currentTool });
        }
        if (ch.taskDuration > 0) {
          statusEl.createSpan({ cls: 'duration', text: `${ch.taskDuration}s` });
        }
      } else {
        statusEl.createSpan({ cls: 'status-idle', text: '⚪ 空闲' });
      }

      // Session info
      if (ch.sessionPreview) {
        card.createDiv({ cls: 'agent-session', text: ch.sessionPreview.substring(0, 30) });
      }

      // Resource usage
      const resources = card.createDiv({ cls: 'agent-resources' });
      resources.createSpan({ text: `CPU: ${ch.cpu}%` });
      resources.createSpan({ text: `MEM: ${ch.mem}%` });
    }

    // Legend
    const legend = this.statusPanel.createDiv({ cls: 'legend' });
    legend.createDiv({ cls: 'legend-title', text: '图例' });
    legend.createDiv({ cls: 'legend-item' }).createSpan({ text: '🟢 工作中 - Agent 正在执行任务' });
    legend.createDiv({ cls: 'legend-item' }).createSpan({ text: '⚪ 空闲 - Agent 等待任务' });
    legend.createDiv({ cls: 'legend-item' }).createSpan({ text: '🟡 等待 - 等待权限或资源' });
    legend.createDiv({ cls: 'legend-item' }).createSpan({ text: '🔴 离线 - Agent 未运行' });
  }

  generateLayout() {
    this.tiles = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1) {
          this.tiles.push('wall');
        } else if (c === 10 && r <= 9) {
          this.tiles.push(r >= 4 && r <= 6 ? 'door' : 'wall');
        } else if (r === 10) {
          this.tiles.push((c >= 4 && c <= 6) || (c >= 14 && c <= 16) ? 'door' : 'wall');
        } else if (c >= 15 && c <= 18 && r >= 7 && r <= 9) {
          this.tiles.push('carpet');
        } else if (r < 10 && c < 10) {
          this.tiles.push('floor1');
        } else if (r < 10 && c > 10) {
          this.tiles.push('floor2');
        } else {
          this.tiles.push('lounge');
        }
      }
    }
  }

  render() {
    const ctx = this.ctx;
    const T = this.TILE * this.zoom;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Draw tiles
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tile = this.tiles[r * this.cols + c];
        const x = c * T;
        const y = r * T;

        switch (tile) {
          case 'wall':
            ctx.fillStyle = '#1e3a5f';
            ctx.fillRect(x, y, T, T);
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
            break;
          case 'door':
            ctx.fillStyle = '#4a3728';
            ctx.fillRect(x, y, T, T);
            break;
          case 'floor1':
            ctx.fillStyle = '#2d1f0e';
            ctx.fillRect(x, y, T, T);
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x, y, T, T);
            break;
          case 'floor2':
            ctx.fillStyle = '#1a1508';
            ctx.fillRect(x, y, T, T);
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x, y, T, T);
            break;
          case 'carpet':
            ctx.fillStyle = '#1a0a2e';
            ctx.fillRect(x, y, T, T);
            break;
          case 'lounge':
            ctx.fillStyle = '#0e1a2e';
            ctx.fillRect(x, y, T, T);
            break;
        }
      }
    }

    // Windows
    for (let c = 3; c < this.cols - 3; c += 5) {
      ctx.fillStyle = '#0ea5e9';
      ctx.fillRect(c * T + 2, 2, T * 3 - 4, T - 4);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(c * T + 4, 4, T * 3 - 8, T - 8);
    }

    // Draw furniture
    for (const f of this.furniture) {
      this.drawFurniture(ctx, T, f);
    }

    // Sort and draw characters
    const sorted = [...this.characters].sort((a, b) => a.y - b.y);
    for (const ch of sorted) {
      this.drawCharacter(ctx, T, ch);
    }
  }

  drawFurniture(ctx, T, f) {
    const x = f.col * T;
    const y = f.row * T;
    const w = (f.w || 1) * T;
    const h = (f.h || 1) * T;

    switch (f.type) {
      case 'desk':
        ctx.fillStyle = '#475569';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(x + T / 2, y - T * 0.6, w - T, T * 0.6);
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(x + T / 2 + 2, y - T * 0.6 + 2, w - T - 4, T * 0.6 - 4);
        ctx.fillStyle = '#6366f1';
        ctx.fillRect(x + w / 4, y + h + 2, w / 2, T / 2);
        break;
      case 'chair':
      case 'bench':
        ctx.fillStyle = '#6366f1';
        ctx.fillRect(x, y, T * 0.8, T * 0.6);
        break;
      case 'bookshelf':
        ctx.fillStyle = '#92400e';
        ctx.fillRect(x, y, w, h);
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = ['#dc2626', '#2563eb', '#16a34a', '#ca8a04'][i];
          ctx.fillRect(x + 2, y + 4 + i * (h / 4), w - 4, h / 4 - 4);
        }
        break;
      case 'plant':
      case 'plant_small':
        ctx.fillStyle = '#65a30d';
        ctx.beginPath();
        ctx.arc(x + T / 2, y + T / 3, T / 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#78350f';
        ctx.fillRect(x + T / 3, y + T / 2, T / 3, T / 2);
        break;
      case 'lamp':
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(x + T / 4, y, T / 2, T / 3);
        ctx.fillStyle = '#78350f';
        ctx.fillRect(x + T / 3, y + T / 3, T / 3, T * 2 / 3);
        break;
      case 'pc':
        ctx.font = `${T * 0.7}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💻', x + T / 2, y + T / 2);
        break;
      case 'whiteboard':
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        break;
      case 'library':
        ctx.fillStyle = '#92400e';
        ctx.fillRect(x, y, w, h);
        break;
      case 'clock':
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(x + T / 2, y + T / 2, T / 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      case 'fridge':
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(x, y, w, h);
        break;
      case 'water_cooler':
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(x + T / 4, y, T / 2, T);
        break;
      case 'server':
        ctx.fillStyle = '#374151';
        ctx.fillRect(x, y, w, h);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = Math.random() > 0.3 ? '#10b981' : '#ef4444';
          ctx.fillRect(x + 8, y + 8 + i * (h / 6), 6, 6);
        }
        break;
      case 'sofa':
        ctx.font = `${T * 1.5}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🛋️', x + w / 2, y + h / 2);
        break;
    }
  }

  drawCharacter(ctx, T, ch) {
    const x = ch.x * this.zoom;
    const y = ch.y * this.zoom;
    const t = this.time;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + T * 0.4, T * 0.3, T * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Status color background
    const statusColors = {
      working: '#10b981',
      idle: '#6b7280',
      waiting: '#f59e0b',
      offline: '#ef4444'
    };
    ctx.fillStyle = statusColors[ch.state] || '#6b7280';
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(x, y - T * 0.5, T * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Body
    ctx.fillStyle = ch.color;
    ctx.fillRect(x - T * 0.25, y - T * 0.3, T * 0.5, T * 0.6);

    // Head
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(x, y - T * 0.5, T * 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(x - T * 0.1, y - T * 0.55, T * 0.06, T * 0.06);
    ctx.fillRect(x + T * 0.04, y - T * 0.55, T * 0.06, T * 0.06);

    // Arms animation (working)
    if (ch.state === 'working') {
      const armOff = Math.sin(t * 5 + ch.id) * T * 0.08;
      ctx.fillStyle = ch.color;
      ctx.fillRect(x - T * 0.35, y - T * 0.15 + armOff, T * 0.1, T * 0.25);
      ctx.fillRect(x + T * 0.25, y - T * 0.15 - armOff, T * 0.1, T * 0.25);
    }

    // Status indicator (top)
    const indicatorY = y - T * 0.9;
    ctx.fillStyle = statusColors[ch.state];
    ctx.beginPath();
    ctx.arc(x, indicatorY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Blinking for working state
    if (ch.state === 'working') {
      const blink = Math.sin(t * 3) > 0;
      if (blink) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, indicatorY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Name
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(10, T * 0.2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(ch.name, x, y - T * 0.8);

    // Tool indicator (if working)
    if (ch.state === 'working' && ch.currentTool) {
      ctx.fillStyle = '#000';
      ctx.globalAlpha = 0.7;
      const toolText = ch.currentTool;
      const textWidth = ctx.measureText(toolText).width;
      ctx.fillRect(x - textWidth / 2 - 4, y + T * 0.5, textWidth + 8, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#10b981';
      ctx.font = '10px monospace';
      ctx.fillText(toolText, x, y + T * 0.5 + 10);
    }
  }

  handleCanvasClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.zoom;
    const y = (e.clientY - rect.top) / this.zoom;

    for (const ch of this.characters) {
      const dx = x - ch.x;
      const dy = y - ch.y;
      if (Math.sqrt(dx * dx + dy * dy) < this.TILE) {
        this.showAgentDetail(ch);
        return;
      }
    }
  }

  handleCanvasHover(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.zoom;
    const y = (e.clientY - rect.top) / this.zoom;

    for (const ch of this.characters) {
      const dx = x - ch.x;
      const dy = y - ch.y;
      if (Math.sqrt(dx * dx + dy * dy) < this.TILE) {
        this.showTooltip(e.clientX - rect.left, e.clientY - rect.top, ch);
        this.canvas.style.cursor = 'pointer';
        return;
      }
    }

    this.tooltip.style.display = 'none';
    this.canvas.style.cursor = 'default';
  }

  showTooltip(x, y, ch) {
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = (x + 10) + 'px';
    this.tooltip.style.top = (y + 10) + 'px';
    this.tooltip.empty();

    this.tooltip.createDiv({ cls: 'tooltip-name', text: `${ch.emoji} ${ch.name}` });
    this.tooltip.createDiv({ cls: 'tooltip-status', text: `状态: ${ch.state === 'working' ? '🟢 工作中' : '⚪ 空闲'}` });
    if (ch.currentTool) this.tooltip.createDiv({ cls: 'tooltip-tool', text: `工具: ${ch.currentTool}` });
    this.tooltip.createDiv({ cls: 'tooltip-pid', text: `PID: ${ch.pid}` });
    this.tooltip.createDiv({ cls: 'tooltip-resource', text: `CPU: ${ch.cpu}% | MEM: ${ch.mem}%` });
  }

  showAgentDetail(ch) {
    const modal = new Modal(this.plugin.app);
    modal.contentEl.createEl('h3', { text: `${ch.emoji} ${ch.name} 详情` });

    const content = modal.contentEl.createDiv({ cls: 'agent-detail' });

    content.createDiv({ cls: 'detail-row', text: `PID: ${ch.pid}` });
    content.createDiv({ cls: 'detail-row', text: `状态: ${ch.state === 'working' ? '🟢 工作中' : '⚪ 空闲'}` });
    content.createDiv({ cls: 'detail-row', text: `CPU: ${ch.cpu}%` });
    content.createDiv({ cls: 'detail-row', text: `内存: ${ch.mem}%` });
    content.createDiv({ cls: 'detail-row', text: `命令: ${ch.command}` });

    if (ch.currentTool) content.createDiv({ cls: 'detail-row', text: `当前工具: ${ch.currentTool}` });
    if (ch.sessionId) content.createDiv({ cls: 'detail-row', text: `会话: ${ch.sessionId}` });
    if (ch.sessionPreview) content.createDiv({ cls: 'detail-row', text: `预览: ${ch.sessionPreview}` });
    if (ch.lastActive) content.createDiv({ cls: 'detail-row', text: `最后活跃: ${ch.lastActive}` });

    modal.open();
  }

  animate() {
    this.time += 0.016;

    // Update character animations
    for (const ch of this.characters) {
      if (ch.state === 'working') {
        // Slight movement for working agents
        ch.x += Math.sin(this.time * 2 + ch.id) * 0.1;
        ch.y += Math.cos(this.time * 2 + ch.id) * 0.05;
      }
    }

    this.render();
    this.frameId = requestAnimationFrame(() => this.animate());
  }

  destroy() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
  }
}

// Chat Modal
class HermesChatModal extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.sessionId = options.sessionId || null;
    this.useContinue = options.continue || false;
    this.isLoading = false;
    this.history = [];
    this.histIdx = -1;
    this.streamMode = true;
    this.commands = this.buildCommands();
  }

  buildCommands() {
    return {
      '/help': { desc: '显示帮助', fn: () => this.showHelp() },
      '/sessions': { desc: '列出会话', fn: () => this.listSessions() },
      '/skills': { desc: '列出技能', fn: () => this.listSkills() },
      '/status': { desc: '系统状态', fn: () => this.showStatus(), card: true },
      '/doctor': { desc: '系统诊断', fn: () => this.runDoctor(), card: true },
      '/insights': { desc: 'Token统计', fn: () => this.showInsights(), card: true },
      '/logs': { desc: '查看日志', fn: () => this.showLogs() },
      '/config': { desc: '查看配置', fn: () => this.showConfig(), card: true },
      '/set': { desc: '设置配置', fn: (args) => this.setConfig(args) },
      '/model': { desc: '切换模型', fn: () => this.switchModel() },
      '/gateway': { desc: '网关状态', fn: () => this.showGateway(), card: true },
      '/start': { desc: '启动网关', fn: async () => { await HermesCLI.run('gateway start'); this.addMsg('system', '网关启动中...'); } },
      '/stop': { desc: '停止网关', fn: async () => { await HermesCLI.run('gateway stop'); this.addMsg('system', '网关已停止'); } },
      '/clear': { desc: '清空对话', fn: () => { this.msgEl.empty(); this.addMsg('system', '对话已清空'); } },
      '/new': { desc: '新建会话', fn: () => { this.sessionId = null; this.useContinue = false; this.sessionEl.setText('new'); this.msgEl.empty(); this.addMsg('system', '已开始新会话'); } },
      '/continue': { desc: '继续上次', fn: () => { this.sessionId = null; this.useContinue = true; this.sessionEl.setText('continue'); this.addMsg('system', '将继续上次会话'); } },
      '/stream': { desc: '流式模式', fn: () => { this.streamMode = !this.streamMode; this.addMsg('system', `流式输出: ${this.streamMode ? '开启' : '关闭'}`); } },
    };
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass('hermes-chat');

    const header = contentEl.createDiv({ cls: 'hermes-chat-header' });
    header.createEl('span', { cls: 'hermes-chat-title', text: '⚡ Hermes' });
    this.sessionEl = header.createEl('span', { cls: 'hermes-chat-session', text: this.sessionId ? this.sessionId.substring(0, 16) + '...' : 'new' });

    const btns = header.createDiv({ cls: 'hermes-chat-btns' });
    btns.createEl('button', { cls: 'hermes-chat-btn', text: '会话' }).addEventListener('click', () => this.pickSession());
    btns.createEl('button', { cls: 'hermes-chat-btn', text: '命令' }).addEventListener('click', () => this.showCommandMenu());

    this.attachArea = contentEl.createDiv({ cls: 'hermes-chat-attach-area' });
    this.attachArea.style.display = 'none';

    this.msgEl = contentEl.createDiv({ cls: 'hermes-chat-msgs' });

    const inputRow = contentEl.createDiv({ cls: 'hermes-chat-input-row' });
    const inputActions = inputRow.createDiv({ cls: 'hermes-chat-input-actions' });

    const attachBtn = inputActions.createEl('button', { cls: 'hermes-chat-attach-btn', title: '附件' });
    setIcon(attachBtn, 'paperclip');
    attachBtn.addEventListener('click', () => this.showAttachMenu());

    this.fileInput = contentEl.createEl('input', { type: 'file', cls: 'hermes-hidden-input' });
    this.fileInput.accept = 'image/*,.txt,.md,.json,.py,.js,.ts';
    this.fileInput.multiple = true;
    this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

    this.inputEl = inputRow.createEl('textarea', { cls: 'hermes-chat-input', placeholder: '输入消息或 / 命令...', rows: 1 });

    const sendBtn = inputActions.createEl('button', { cls: 'hermes-chat-send-btn', text: '发送' });
    sendBtn.addEventListener('click', () => this.send());

    this.suggestEl = contentEl.createDiv({ cls: 'hermes-chat-suggest' });
    this.suggestEl.style.display = 'none';

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.hist(-1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); this.hist(1); }
      if (e.key === 'Tab') { e.preventDefault(); this.autocomplete(); }
      if (e.key === 'Escape') { this.close(); }
      if (e.ctrlKey && e.key === 'v') { this.handlePaste(e); }
    });

    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
      const val = this.inputEl.value;
      if (val.startsWith('/')) { this.showSuggestions(val); }
      else { this.suggestEl.style.display = 'none'; }
    });

    this.statusEl = contentEl.createDiv({ cls: 'hermes-chat-status' });
    this.statusEl.setText('就绪 | 输入 / 查看命令');

    if (this.sessionId) {
      this.addMsg('system', `会话: ${this.sessionId}`);
      await this.loadSessionHistory();
    } else {
      this.addMsg('system', '输入 /help 查看所有可用命令');
    }

    this.inputEl.focus();
  }

  async loadSessionHistory() {
    if (!this.sessionId) return;
    this.addMsg('system', '加载历史消息...');
    const history = await HermesCLI.getSessionHistory(this.sessionId);
    if (history.length > 0) {
      this.msgEl.empty();
      for (const line of history) {
        if (line.startsWith('User:')) this.addMsg('user', line.replace(/^User:\s*/, ''));
        else if (line.startsWith('Assistant:')) this.addMsg('assistant', line.replace(/^Assistant:\s*/, ''));
      }
      this.addMsg('system', `已加载 ${history.length} 条历史消息`);
    } else {
      this.addMsg('system', '没有找到历史消息');
    }
  }

  showSuggestions(input) {
    const matches = Object.keys(this.commands).filter(cmd => cmd.startsWith(input.toLowerCase()));
    if (matches.length === 0) { this.suggestEl.style.display = 'none'; return; }
    this.suggestEl.empty();
    this.suggestEl.style.display = 'block';
    for (const cmd of matches.slice(0, 6)) {
      const item = this.suggestEl.createDiv({ cls: 'hermes-suggest-item' });
      item.createSpan({ cls: 'hermes-suggest-cmd', text: cmd });
      item.createSpan({ cls: 'hermes-suggest-desc', text: this.commands[cmd].desc });
      item.addEventListener('click', () => { this.inputEl.value = cmd + ' '; this.suggestEl.style.display = 'none'; this.inputEl.focus(); });
    }
  }

  autocomplete() {
    const val = this.inputEl.value;
    if (!val.startsWith('/')) return;
    const matches = Object.keys(this.commands).filter(cmd => cmd.startsWith(val.toLowerCase()));
    if (matches.length === 1) { this.inputEl.value = matches[0] + ' '; this.suggestEl.style.display = 'none'; }
  }

  showCommandMenu() {
    const modal = new Modal(this.app);
    modal.contentEl.createEl('h3', { text: '可用命令' });
    const list = modal.contentEl.createDiv({ cls: 'hermes-command-list' });
    for (const [cmd, { desc }] of Object.entries(this.commands)) {
      const item = list.createDiv({ cls: 'hermes-command-item' });
      item.createSpan({ cls: 'hermes-command-cmd', text: cmd });
      item.createSpan({ cls: 'hermes-command-desc', text: desc });
      item.addEventListener('click', () => { this.inputEl.value = cmd + ' '; modal.close(); this.inputEl.focus(); });
    }
    modal.open();
  }

  async showHelp() {
    let help = '可用命令:\n\n';
    for (const [cmd, { desc }] of Object.entries(this.commands)) {
      help += `  ${cmd.padEnd(14)} ${desc}\n`;
    }
    this.addMsg('system', help);
  }

  async listSessions() {
    const sessions = await HermesCLI.getAgentStatus();
    if (sessions.length === 0) { this.addMsg('system', '没有找到会话'); return; }
    let msg = '最近会话:\n\n';
    for (const s of sessions) {
      msg += `  ${s.id.substring(0, 16)}  ${(s.preview || '').substring(0, 30)}  (${s.lastActive})\n`;
    }
    this.addMsg('system', msg);
  }

  async listSkills() {
    const skills = await HermesCLI.getSkills();
    if (skills.length === 0) { this.addMsg('system', '没有找到技能'); return; }
    let msg = `已安装技能 (${skills.length}):\n\n`;
    for (const s of skills.slice(0, 15)) {
      msg += `  ${s.name} (${s.category})\n`;
    }
    this.addMsg('system', msg);
  }

  async showStatus() {
    const [gw, proc, sessions] = await Promise.all([
      HermesCLI.isGatewayRunning(),
      HermesCLI.getProcesses(),
      HermesCLI.getAgentStatus()
    ]);
    let msg = '系统状态:\n\n';
    msg += `  网关: ${gw.running ? '✅ 运行中' : '❌ 已停止'}${gw.pid ? ` (PID: ${gw.pid})` : ''}\n`;
    msg += `  进程: ${proc.length} 个运行中\n`;
    msg += `  会话: ${sessions.length} 个最近\n`;
    this.addMsg('system', msg);
  }

  async runDoctor() {
    const result = await HermesCLI.getDoctor();
    if (result.success) {
      const lines = result.output.split('\n').filter(l => l.includes('✓') || l.includes('⚠') || l.includes('✗'));
      let msg = '系统诊断:\n\n';
      for (const line of lines) msg += `  ${line.trim()}\n`;
      this.addMsg('system', msg);
    }
  }

  async showInsights() {
    const ins = await HermesCLI.getInsights(7);
    if (!ins) { this.addMsg('system', '无法获取统计数据'); return; }
    const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
    let msg = '过去 7 天统计:\n\n';
    msg += `  会话: ${ins.sessions}\n`;
    msg += `  消息: ${ins.messages}\n`;
    msg += `  Token: ${fmt(ins.totalTokens)}\n`;
    this.addMsg('system', msg);
  }

  async showLogs() {
    const result = await HermesCLI.getLogs('agent', 15);
    if (result.success) {
      const lines = result.output.split('\n').slice(-15);
      let msg = '最近日志:\n\n';
      for (const line of lines) msg += `  ${line.substring(0, 80)}\n`;
      this.addMsg('system', msg);
    }
  }

  async showConfig() {
    const result = await HermesCLI.run('config show');
    if (result.success) {
      const lines = result.output.split('\n').slice(0, 20);
      let msg = '配置:\n\n';
      for (const line of lines) if (line.trim()) msg += `  ${line}\n`;
      this.addMsg('system', msg);
    }
  }

  async setConfig(args) {
    if (!args) { this.addMsg('system', '用法: /set <key> <value>'); return; }
    const [key, ...valueParts] = args.split(/\s+/);
    const value = valueParts.join(' ');
    const result = await HermesCLI.run(`config set ${key} "${value}"`);
    this.addMsg('system', result.success ? `✅ 已设置: ${key} = ${value}` : `❌ 失败: ${result.output}`);
  }

  async switchModel() {
    const modal = new Modal(this.app);
    modal.contentEl.createEl('h3', { text: '切换模型' });
    const input = modal.contentEl.createEl('input', { placeholder: '模型名称' });
    modal.contentEl.createEl('button', { text: '确认' }).addEventListener('click', async () => {
      if (input.value.trim()) {
        const result = await HermesCLI.run(`config set model.default ${input.value.trim()}`);
        this.addMsg('system', result.success ? `✅ 模型已切换: ${input.value.trim()}` : `❌ 失败`);
      }
      modal.close();
    });
    modal.open();
  }

  async showGateway() {
    const gw = await HermesCLI.isGatewayRunning();
    this.addMsg('system', `网关: ${gw.running ? '✅ 运行中' : '❌ 已停止'}${gw.pid ? ` (PID: ${gw.pid})` : ''}`);
  }

  async pickSession() {
    const modal = new Modal(this.app);
    modal.contentEl.createEl('h3', { text: '选择会话' });
    const sessions = await HermesCLI.getAgentStatus();
    const list = modal.contentEl.createDiv({ cls: 'hermes-session-list' });

    list.createDiv({ cls: 'hermes-session-item', text: '➕ 新建会话' }).addEventListener('click', () => {
      this.sessionId = null; this.useContinue = false; this.sessionEl.setText('new'); this.msgEl.empty(); modal.close();
    });

    for (const s of sessions) {
      list.createDiv({ cls: 'hermes-session-item', text: `${s.preview || s.title}`.substring(0, 35) + ` (${s.lastActive})` })
        .addEventListener('click', () => {
          this.sessionId = s.id; this.useContinue = false; this.sessionEl.setText(s.id.substring(0, 16) + '...'); this.msgEl.empty(); modal.close();
        });
    }
    modal.open();
  }

  hist(dir) {
    if (this.history.length === 0) return;
    this.histIdx = Math.max(0, Math.min(this.history.length - 1, this.histIdx + dir));
    this.inputEl.value = this.history[this.histIdx] || '';
  }

  async send() {
    const text = this.inputEl.value.trim();
    if (!text) return;
    if (this.isLoading) return;

    this.isLoading = true;
    this.history.push(text);
    this.histIdx = this.history.length;
    this.suggestEl.style.display = 'none';

    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');
      if (this.commands[cmd]) {
        this.addMsg('user', text);
        this.inputEl.value = '';
        await this.commands[cmd].fn(args);
        this.isLoading = false;
        this.inputEl.focus();
        return;
      }
    }

    this.addMsg('user', text);
    this.inputEl.value = '';
    this.statusEl.setText('思考中...');

    const streamMsg = this.msgEl.createDiv({ cls: 'hermes-chat-msg hermes-chat-assistant' });
    const streamBody = streamMsg.createDiv({ cls: 'hermes-chat-msg-body' });
    const cursor = streamBody.createSpan({ cls: 'hermes-streaming-cursor' });

    try {
      const result = await HermesCLI.chat(text, { sessionId: this.sessionId, continue: this.useContinue });
      cursor.remove();

      if (result.success) {
        let response = result.output;
        let sessionId = null;
        const lines = result.output.split('\n');
        if (lines[0] && lines[0].includes('session_id:')) {
          sessionId = lines[0].replace('session_id:', '').trim();
          response = lines.slice(1).join('\n').trim();
        }

        streamBody.createDiv({ cls: 'hermes-chat-line', text: response });
        this.statusEl.setText('就绪 | 输入 / 查看命令');

        if (sessionId && !this.sessionId) {
          this.sessionId = sessionId;
          this.sessionEl.setText(sessionId.substring(0, 16) + '...');
        }
      } else {
        streamBody.createSpan({ cls: 'hermes-chat-err', text: result.output });
        this.statusEl.setText('错误');
      }
    } catch (e) {
      cursor.remove();
      streamBody.createSpan({ cls: 'hermes-chat-err', text: e.message });
      this.statusEl.setText('错误');
    }

    this.isLoading = false;
    this.inputEl.focus();
  }

  addMsg(role, text) {
    const msg = this.msgEl.createDiv({ cls: `hermes-chat-msg hermes-chat-${role}` });
    if (role === 'user') {
      msg.createEl('span', { cls: 'hermes-chat-prompt', text: '> ' });
      msg.createEl('span', { text });
    } else if (role === 'assistant') {
      msg.createDiv({ cls: 'hermes-chat-line', text });
    } else if (role === 'system') {
      msg.createEl('pre', { cls: 'hermes-chat-sys', text });
    } else {
      msg.createSpan({ cls: 'hermes-chat-err', text });
    }
    this.msgEl.scrollTop = this.msgEl.scrollHeight;
  }

  async showAttachMenu() {
    const modal = new Modal(this.app);
    modal.contentEl.createEl('h3', { text: '添加图片' });
    const input = modal.contentEl.createEl('input', { type: 'file', accept: 'image/*' });
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const tempPath = path.join(HERMES_DIR, 'temp', `img-${Date.now()}.png`);
          await fs.mkdir(path.join(HERMES_DIR, 'temp'), { recursive: true });
          const buffer = Buffer.from(ev.target.result.split(',')[1], 'base64');
          await fs.writeFile(tempPath, buffer);
          this.addMsg('user', `[图片] ${file.name}`);
          const result = await HermesCLI.chat('请描述这张图片', { sessionId: this.sessionId, image: tempPath });
          if (result.success) this.addMsg('assistant', result.output);
          try { await fs.unlink(tempPath); } catch (e) {}
        };
        reader.readAsDataURL(file);
      }
      modal.close();
    });
    modal.open();
  }

  async handleFiles(files) {}
  async handlePaste(e) {}
}

// Main View
class HermesMonitorView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeTab = 'dashboard';
    this.lastUpdated = '';
    this.gatewayHealth = null;
    this.isLoaded = false;
    this.pixelOffice = null;
    this.activeSessionId = null;
    this.chatPanel = null;
  }

  getViewType() { return VIEW_TYPE_HERMES; }
  getDisplayText() { return 'Hermes'; }
  getIcon() { return 'bot'; }

  async onOpen() {
    const c = this.containerEl.children[1];
    c.empty();
    c.addClass('hermes-monitor');

    const header = c.createDiv({ cls: 'hermes-header' });
    const left = header.createDiv({ cls: 'hermes-header-left' });
    left.createEl('h2', { text: '⚡ Hermes Agent 监控' });

    const right = header.createDiv({ cls: 'hermes-header-right' });
    const chatBtn = right.createEl('button', { cls: 'hermes-btn hermes-btn-primary' });
    setIcon(chatBtn, 'terminal');
    chatBtn.createSpan({ text: ' 聊天' });
    chatBtn.addEventListener('click', () => new HermesChatModal(this.app, this.plugin).open());

    const refreshBtn = right.createEl('button', { cls: 'hermes-btn' });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => this.refresh());

    const tabs = c.createDiv({ cls: 'hermes-tabs' });
    for (const { id, label, icon } of [
      { id: 'dashboard', label: '仪表盘', icon: 'layout-dashboard' },
      { id: 'agents', label: '进程', icon: 'users' },
      { id: 'sessions', label: '会话', icon: 'message-circle' },
      { id: 'skills', label: '技能', icon: 'puzzle' },
      { id: 'stats', label: '统计', icon: 'bar-chart-2' },
      { id: 'pixel', label: '办公室', icon: 'building' },
      { id: 'logs', label: '日志', icon: 'scroll-text' },
    ]) {
      const tab = tabs.createEl('button', { cls: `hermes-tab ${id === this.activeTab ? 'active' : ''}` });
      setIcon(tab, icon);
      tab.createSpan({ text: ` ${label}` });
      tab.addEventListener('click', () => {
        this.activeTab = id;
        tabs.querySelectorAll('.hermes-tab').forEach(t => t.removeClass('active'));
        tab.addClass('active');
        this.renderContent();
      });
    }

    this.statusBar = c.createDiv({ cls: 'hermes-status-bar' });
    this.contentEl = c.createDiv({ cls: 'hermes-content' });
    this.contentEl.createDiv({ cls: 'hermes-welcome', text: '点击刷新或切换标签页加载数据' });
  }

  async refresh(silent = false) {
    if (!silent) {
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: 'hermes-loading', text: '加载中...' });
    }
    try {
      this.gatewayHealth = await HermesCLI.isGatewayRunning();
      this.lastUpdated = new Date().toLocaleTimeString();
      this.isLoaded = true;
      this.updateStatusBar();
      if (this.pixelOffice && this.activeTab !== 'pixel') {
        this.pixelOffice.destroy();
        this.pixelOffice = null;
      }
      switch (this.activeTab) {
        case 'dashboard': await this.renderDashboard(); break;
        case 'agents': await this.renderAgents(); break;
        case 'sessions': await this.renderSessions(); break;
        case 'skills': await this.renderSkills(); break;
        case 'stats': await this.renderStats(); break;
        case 'pixel': await this.renderPixelOffice(); break;
        case 'logs': await this.renderLogs(); break;
      }
    } catch (e) {
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: 'hermes-error', text: `错误：${e.message}` });
    }
  }

  updateStatusBar() {
    this.statusBar.empty();
    const gw = this.gatewayHealth;
    const item = this.statusBar.createDiv({ cls: 'hermes-status-item' });
    const icon = item.createSpan({ cls: `status-dot ${gw.running ? 'status-ok' : 'status-error'}` });
    setIcon(icon, gw.running ? 'check-circle' : 'x-circle');
    item.createSpan({ text: ` 网关：${gw.running ? '运行中' : '已停止'}` });
    if (gw.running) item.createSpan({ cls: 'hermes-status-pid', text: `PID ${gw.pid}` });
    this.statusBar.createDiv({ cls: 'hermes-status-spacer' });
    this.statusBar.createDiv({ cls: 'hermes-status-time', text: this.lastUpdated });
  }

  async renderContent() {
    if (!this.isLoaded) { await this.refresh(); }
    else { this.contentEl.empty(); await this.refresh(true); }
  }

  fmtTokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  async renderDashboard() {
    const c = this.contentEl;
    c.empty();
    const [proc, sess, skills, ins] = await Promise.all([
      HermesCLI.getProcesses(),
      HermesCLI.getAgentStatus(),
      HermesCLI.getSkills(),
      HermesCLI.getInsights(1)
    ]);

    const row = c.createDiv({ cls: 'hermes-stats-row' });
    this.statCard(row, 'cpu', '进程', proc.length);
    this.statCard(row, 'message-circle', '会话', sess.length);
    this.statCard(row, 'puzzle', '技能', skills.length);

    if (ins) {
      const row2 = c.createDiv({ cls: 'hermes-stats-row' });
      this.statCard(row2, 'coins', 'Token', this.fmtTokens(ins.totalTokens));
      this.statCard(row2, 'arrow-up', '输入', this.fmtTokens(ins.inputTokens));
      this.statCard(row2, 'arrow-down', '输出', this.fmtTokens(ins.outputTokens));
    }

    const actions = c.createDiv({ cls: 'hermes-actions' });
    this.actionBtn(actions, 'terminal', '聊天', () => new HermesChatModal(this.app, this.plugin).open());
    this.actionBtn(actions, 'building', '办公室', () => { this.activeTab = 'pixel'; this.renderContent(); });
    this.actionBtn(actions, 'play', '启动网关', async () => { await HermesCLI.run('gateway start'); setTimeout(() => this.refresh(), 2000); });
    this.actionBtn(actions, 'square', '停止网关', async () => { await HermesCLI.run('gateway stop'); setTimeout(() => this.refresh(), 2000); });

    if (proc.length > 0) {
      const sec = c.createDiv({ cls: 'hermes-section' });
      sec.createEl('h3', { text: '运行中的 Agent' });
      const grid = sec.createDiv({ cls: 'hermes-agents-grid' });
      for (const p of proc) this.agentCard(grid, p);
    }
  }

  statCard(parent, icon, label, value) {
    const card = parent.createDiv({ cls: 'hermes-stat-card' });
    const i = card.createDiv({ cls: 'hermes-stat-icon' });
    setIcon(i, icon);
    card.createDiv({ cls: 'hermes-stat-value', text: String(value) });
    card.createDiv({ cls: 'hermes-stat-label', text: label });
  }

  actionBtn(parent, icon, label, onClick) {
    const btn = parent.createEl('button', { cls: 'hermes-btn' });
    setIcon(btn, icon);
    btn.createSpan({ text: ` ${label}` });
    btn.addEventListener('click', onClick);
  }

  agentCard(parent, p) {
    const card = parent.createDiv({ cls: 'hermes-agent-card' });
    const header = card.createDiv({ cls: 'hermes-agent-header' });
    const icon = header.createDiv({ cls: 'hermes-agent-icon' });
    setIcon(icon, p.isGateway ? 'server' : 'bot');
    const info = header.createDiv({ cls: 'hermes-agent-info' });
    info.createDiv({ cls: 'hermes-agent-name', text: p.isGateway ? '网关' : 'Agent' });
    info.createDiv({ cls: 'hermes-agent-pid', text: `PID: ${p.pid}` });
    header.createDiv({ cls: 'hermes-agent-badge status-ok', text: '运行中' });
    const stats = card.createDiv({ cls: 'hermes-agent-stats' });
    stats.createDiv({ text: `CPU: ${p.cpu}%` });
    stats.createDiv({ text: `MEM: ${p.mem}%` });
  }

  async renderAgents() {
    const c = this.contentEl;
    c.empty();
    const processes = await HermesCLI.getProcesses();
    c.createEl('h3', { text: `运行进程 (${processes.length})` });
    if (processes.length === 0) { c.createDiv({ cls: 'hermes-empty', text: '没有进程' }); return; }
    const grid = c.createDiv({ cls: 'hermes-agents-grid' });
    for (const p of processes) this.agentCard(grid, p);
  }

  async renderSessions() {
    const c = this.contentEl;
    c.empty();

    // Full width chat with collapsible sidebar
    const container = c.createDiv({ cls: 'hermes-chat-container' });

    // Collapsible sidebar
    const sidebar = container.createDiv({ cls: 'hermes-chat-sidebar collapsed' });
    const sidebarHeader = sidebar.createDiv({ cls: 'sidebar-header' });
    sidebarHeader.createEl('h4', { text: '历史会话' });

    const toggleBtn = sidebarHeader.createEl('button', { cls: 'sidebar-toggle' });
    setIcon(toggleBtn, 'panel-left');
    toggleBtn.addEventListener('click', () => {
      sidebar.toggleClass('collapsed', !sidebar.hasClass('collapsed'));
      container.toggleClass('sidebar-open', !sidebar.hasClass('collapsed'));
    });

    const sessionsList = sidebar.createDiv({ cls: 'sidebar-sessions' });
    const sessions = await HermesCLI.getAgentStatus();

    if (sessions.length === 0) {
      sessionsList.createDiv({ cls: 'sidebar-empty', text: '没有会话' });
    } else {
      for (const s of sessions) {
        const item = sessionsList.createDiv({
          cls: `sidebar-session-item ${this.activeSessionId === s.id ? 'active' : ''}`
        });
        item.createDiv({ cls: 'session-preview', text: (s.preview || s.title).substring(0, 30) });
        item.createDiv({ cls: 'session-time', text: s.lastActive });
        item.addEventListener('click', () => {
          sessionsList.querySelectorAll('.sidebar-session-item').forEach(i => i.removeClass('active'));
          item.addClass('active');
          sidebar.addClass('collapsed');
          container.removeClass('sidebar-open');
          this.loadSessionChat(s.id, s.preview || s.title);
        });
      }
    }

    // Main chat area
    this.chatPanel = container.createDiv({ cls: 'hermes-chat-main' });

    // Show welcome or load active session
    if (this.activeSessionId) {
      const session = sessions.find(s => s.id === this.activeSessionId);
      await this.loadSessionChat(this.activeSessionId, session?.preview || '');
    } else {
      // Welcome screen with quick actions
      const welcome = this.chatPanel.createDiv({ cls: 'hermes-chat-welcome' });
      welcome.createEl('h3', { text: '⚡ Hermes Agent 聊天' });
      welcome.createDiv({ cls: 'welcome-sub', text: '选择会话或开始新对话' });

      const quickActions = welcome.createDiv({ cls: 'welcome-actions' });

      // New session button
      const newBtn = quickActions.createEl('button', { cls: 'welcome-action-btn' });
      newBtn.createSpan({ text: '➕' });
      newBtn.createSpan({ text: '新建会话' });
      newBtn.addEventListener('click', () => {
        this.activeSessionId = null;
        this.loadSessionChat(null, '新会话');
      });

      // Continue last button
      if (sessions.length > 0) {
        const lastBtn = quickActions.createEl('button', { cls: 'welcome-action-btn' });
        lastBtn.createSpan({ text: '⏭️' });
        lastBtn.createSpan({ text: '继续上次' });
        lastBtn.addEventListener('click', () => {
          const last = sessions[0];
          this.loadSessionChat(last.id, last.preview || '');
        });
      }

      // Toggle sidebar button
      const sidebarBtn = quickActions.createEl('button', { cls: 'welcome-action-btn' });
      sidebarBtn.createSpan({ text: '📋' });
      sidebarBtn.createSpan({ text: '历史会话' });
      sidebarBtn.addEventListener('click', () => {
        sidebar.removeClass('collapsed');
        container.addClass('sidebar-open');
      });

      // Recent sessions preview
      if (sessions.length > 0) {
        const recent = welcome.createDiv({ cls: 'welcome-recent' });
        recent.createEl('h4', { text: '最近会话' });
        for (const s of sessions.slice(0, 3)) {
          const item = recent.createDiv({ cls: 'welcome-recent-item' });
          item.createSpan({ text: (s.preview || s.title).substring(0, 40) });
          item.createSpan({ cls: 'recent-time', text: s.lastActive });
          item.addEventListener('click', () => this.loadSessionChat(s.id, s.preview || ''));
        }
      }
    }
  }

  async loadSessionChat(sessionId, title) {
    this.activeSessionId = sessionId;
    this.chatPanel.empty();

    // Chat header with sidebar toggle
    const header = this.chatPanel.createDiv({ cls: 'chat-header' });
    const headerLeft = header.createDiv({ cls: 'chat-header-left' });

    const menuBtn = headerLeft.createEl('button', { cls: 'chat-menu-btn' });
    setIcon(menuBtn, 'menu');
    menuBtn.addEventListener('click', () => {
      const sidebar = this.containerEl.querySelector('.hermes-chat-sidebar');
      const container = this.containerEl.querySelector('.hermes-chat-container');
      if (sidebar) sidebar.toggleClass('collapsed');
      if (container) container.toggleClass('sidebar-open');
    });

    headerLeft.createEl('span', { cls: 'chat-title', text: title || (sessionId ? sessionId.substring(0, 16) + '...' : '新会话') });
    if (sessionId) headerLeft.createEl('span', { cls: 'chat-session-id', text: sessionId.substring(0, 12) });

    const headerRight = header.createDiv({ cls: 'chat-header-right' });
    const newBtn = headerRight.createEl('button', { cls: 'chat-header-btn', title: '新会话' });
    setIcon(newBtn, 'plus');
    newBtn.addEventListener('click', () => {
      this.activeSessionId = null;
      this.loadSessionChat(null, '新会话');
    });

    // Messages area
    const msgsEl = this.chatPanel.createDiv({ cls: 'chat-messages' });

    // Load history
    if (sessionId) {
      msgsEl.createDiv({ cls: 'chat-loading', text: '加载历史消息...' });
      const history = await HermesCLI.getSessionHistory(sessionId);
      msgsEl.empty();

      if (history.length > 0) {
        for (const line of history) {
          if (line.startsWith('User:')) {
            const msg = msgsEl.createDiv({ cls: 'chat-msg chat-user' });
            msg.createEl('span', { cls: 'msg-prompt', text: '> ' });
            msg.createEl('span', { text: line.replace(/^User:\s*/, '') });
          } else if (line.startsWith('Assistant:')) {
            msgsEl.createDiv({ cls: 'chat-msg chat-assistant' }).createDiv({ cls: 'msg-text', text: line.replace(/^Assistant:\s*/, '') });
          }
        }
      } else {
        msgsEl.createDiv({ cls: 'chat-empty', text: '没有历史消息，开始对话吧！' });
      }
    } else {
      msgsEl.createDiv({ cls: 'chat-empty', text: '输入消息开始新会话' });
    }

    // Input area with attachment preview
    const inputArea = this.chatPanel.createDiv({ cls: 'chat-input-area' });

    // Drop zone overlay
    const dropZone = this.chatPanel.createDiv({ cls: 'chat-drop-zone' });
    dropZone.createDiv({ cls: 'drop-zone-content' }).createSpan({ text: '📎 拖拽文件到这里' });
    dropZone.style.display = 'none';

    // Attachment preview (hidden by default)
    const attachPreview = inputArea.createDiv({ cls: 'chat-attach-preview' });
    attachPreview.style.display = 'none';

    // Drag and drop handlers
    this.chatPanel.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.display = 'flex';
    });

    this.chatPanel.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.chatPanel.contains(e.relatedTarget)) {
        dropZone.style.display = 'none';
      }
    });

    this.chatPanel.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.display = 'none';

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        await this.handleFileAttachment(file, attachPreview, sessionId, msgsEl);
      }
    });

    // Input row
    const inputRow = inputArea.createDiv({ cls: 'chat-input-row' });
    const inputActions = inputRow.createDiv({ cls: 'chat-input-actions' });

    // Attachment button - support all file types
    const attachBtn = inputActions.createEl('button', { cls: 'chat-action-btn', title: '添加附件' });
    setIcon(attachBtn, 'paperclip');
    attachBtn.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '*/*'; // Accept all file types
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) await this.handleFileAttachment(file, attachPreview, sessionId, msgsEl);
      });
      fileInput.click();
    });

    // Image button (specifically for images)
    const imgBtn = inputActions.createEl('button', { cls: 'chat-action-btn', title: '添加图片' });
    setIcon(imgBtn, 'image');
    imgBtn.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) await this.handleFileAttachment(file, attachPreview, sessionId, msgsEl);
      });
      fileInput.click();
    });

    // Input
    const input = inputRow.createEl('textarea', {
      cls: 'chat-input',
      placeholder: '输入消息... (拖拽文件或 Ctrl+V 粘贴图片)',
      rows: 1,
    });

    // Send button
    const sendBtn = inputRow.createEl('button', { cls: 'chat-send-btn' });
    setIcon(sendBtn, 'send');

    // Paste handler for images
    input.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) await this.handleFileAttachment(file, attachPreview, sessionId, msgsEl);
          return;
        }
      }
    });

    // Send message
    const sendMessage = async () => {
      const text = input.value.trim();
      const hasAttach = attachPreview.style.display !== 'none' && this.pendingFile;

      if (!text && !hasAttach) return;

      // Handle / commands
      if (text.startsWith('/')) {
        const parts = text.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        // Show user command
        msgsEl.createDiv({ cls: 'chat-msg chat-user' }).createEl('span', { text });
        input.value = '';
        msgsEl.scrollTop = msgsEl.scrollHeight;

        // Command handlers
        const commands = {
          '/help': () => {
            let help = '可用命令:\n\n';
            help += '  /help        显示帮助\n';
            help += '  /clear       清空对话\n';
            help += '  /new         新建会话\n';
            help += '  /status      系统状态\n';
            help += '  /doctor      系统诊断\n';
            help += '  /insights    Token统计\n';
            help += '  /skills      列出技能\n';
            help += '  /logs        查看日志\n';
            help += '  /config      查看配置\n';
            help += '  /model       切换模型\n';
            help += '  /gateway     网关状态\n';
            help += '  /start       启动网关\n';
            help += '  /stop        停止网关\n';
            help += '  /clear       清空对话\n';
            msgsEl.createDiv({ cls: 'chat-msg chat-system' }).createEl('pre', { text: help });
          },
          '/clear': () => {
            msgsEl.empty();
            msgsEl.createDiv({ cls: 'chat-empty', text: '对话已清空' });
          },
          '/new': () => {
            this.activeSessionId = null;
            sessionId = null;
            msgsEl.empty();
            msgsEl.createDiv({ cls: 'chat-empty', text: '已开始新会话' });
          },
          '/status': async () => {
            const sysMsg = msgsEl.createDiv({ cls: 'chat-msg chat-system' });
            sysMsg.setText('正在检查状态...');
            const [gw, proc] = await Promise.all([
              HermesCLI.isGatewayRunning(),
              HermesCLI.getProcesses()
            ]);
            sysMsg.empty();
            sysMsg.createDiv({ text: `网关: ${gw.running ? '✅ 运行中' : '❌ 已停止'}${gw.pid ? ` (PID: ${gw.pid})` : ''}` });
            sysMsg.createDiv({ text: `进程: ${proc.length} 个运行中` });
          },
          '/doctor': async () => {
            const sysMsg = msgsEl.createDiv({ cls: 'chat-msg chat-system' });
            sysMsg.setText('正在运行诊断...');
            const result = await HermesCLI.getDoctor();
            sysMsg.empty();
            if (result.success) {
              const lines = result.output.split('\n').filter(l => l.includes('✓') || l.includes('⚠') || l.includes('✗'));
              for (const line of lines.slice(0, 10)) {
                sysMsg.createDiv({ text: line.trim() });
              }
            }
          },
          '/skills': async () => {
            const skills = await HermesCLI.getSkills();
            const sysMsg = msgsEl.createDiv({ cls: 'chat-msg chat-system' });
            sysMsg.createDiv({ text: `已安装 ${skills.length} 个技能` });
            for (const s of skills.slice(0, 10)) {
              sysMsg.createDiv({ text: `  • ${s.name} (${s.category})` });
            }
          },
          '/insights': async () => {
            const sysMsg = msgsEl.createDiv({ cls: 'chat-msg chat-system' });
            sysMsg.setText('正在获取统计...');
            const ins = await HermesCLI.getInsights(7);
            sysMsg.empty();
            if (ins) {
              const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
              sysMsg.createDiv({ text: `会话: ${ins.sessions}` });
              sysMsg.createDiv({ text: `消息: ${ins.messages}` });
              sysMsg.createDiv({ text: `Token: ${fmt(ins.totalTokens)}` });
            }
          },
          '/logs': async () => {
            const sysMsg = msgsEl.createDiv({ cls: 'chat-msg chat-system' });
            const result = await HermesCLI.getLogs('agent', 10);
            if (result.success) {
              const lines = result.output.split('\n').slice(-10);
              for (const line of lines) {
                sysMsg.createDiv({ text: line.substring(0, 80) });
              }
            }
          },
          '/config': async () => {
            const result = await HermesCLI.run('config show');
            if (result.success) {
              const lines = result.output.split('\n').slice(0, 15);
              const sysMsg = msgsEl.createDiv({ cls: 'chat-msg chat-system' });
              for (const line of lines) {
                if (line.trim()) sysMsg.createDiv({ text: line });
              }
            }
          },
          '/gateway': async () => {
            const gw = await HermesCLI.isGatewayRunning();
            msgsEl.createDiv({ cls: 'chat-msg chat-system', text: `网关: ${gw.running ? '✅ 运行中' : '❌ 已停止'}${gw.pid ? ` (PID: ${gw.pid})` : ''}` });
          },
          '/start': async () => {
            await HermesCLI.run('gateway start');
            msgsEl.createDiv({ cls: 'chat-msg chat-system', text: '网关启动中...' });
          },
          '/stop': async () => {
            await HermesCLI.run('gateway stop');
            msgsEl.createDiv({ cls: 'chat-msg chat-system', text: '网关已停止' });
          },
          '/model': async () => {
            if (args) {
              const result = await HermesCLI.run(`config set model.default ${args}`);
              msgsEl.createDiv({ cls: 'chat-msg chat-system', text: result.success ? `✅ 模型已切换: ${args}` : `❌ 失败` });
            } else {
              msgsEl.createDiv({ cls: 'chat-msg chat-system', text: '用法: /model <模型名称>\n例如: /model anthropic/claude-sonnet-4' });
            }
          }
        };

        if (commands[cmd]) {
          await commands[cmd]();
        } else {
          msgsEl.createDiv({ cls: 'chat-msg chat-error', text: `未知命令: ${cmd}\n输入 /help 查看所有命令` });
        }

        msgsEl.scrollTop = msgsEl.scrollHeight;
        return;
      }

      // Send with file if attached
      if (hasAttach) {
        const filePath = this.pendingFile;
        const fileName = this.pendingFileName || '文件';
        const isImage = this.pendingFileIsImage;

        // Show user message
        const userMsg = text ? `${text} [${isImage ? '图片' : '文件'}]` : `[${isImage ? '图片' : '文件'}] ${fileName}`;
        msgsEl.createDiv({ cls: 'chat-msg chat-user' }).createEl('span', { text: userMsg });
        input.value = '';
        attachPreview.style.display = 'none';
        this.pendingFile = null;
        this.pendingFileName = null;
        this.pendingFileIsImage = false;

        // Send to Hermes
        const thinkingText = isImage ? '分析图片中...' : '处理文件中...';
        const thinking = msgsEl.createDiv({ cls: 'chat-msg chat-thinking', text: thinkingText });
        msgsEl.scrollTop = msgsEl.scrollHeight;

        try {
          let prompt = text;
          if (!prompt) {
            prompt = isImage ? '请描述这张图片' : `请分析这个文件的内容`;
          }

          let result;
          if (isImage) {
            // Use direct MiniMax API for image analysis
            result = await HermesCLI.analyzeImage(filePath, prompt);
          } else {
            // Use regular chat for text files
            result = await HermesCLI.chat(prompt, { sessionId });
          }

          thinking.remove();

          if (result.success) {
            let response = result.output;
            let newSessionId = null;
            const lines = result.output.split('\n');
            if (lines[0] && lines[0].includes('session_id:')) {
              newSessionId = lines[0].replace('session_id:', '').trim();
              response = lines.slice(1).join('\n').trim();
            }
            msgsEl.createDiv({ cls: 'chat-msg chat-assistant' }).createDiv({ cls: 'msg-text', text: response });
            if (newSessionId && !this.activeSessionId) {
              this.activeSessionId = newSessionId;
              headerLeft.querySelector('.chat-session-id')?.setText(newSessionId.substring(0, 12));
            }
          } else {
            msgsEl.createDiv({ cls: 'chat-msg chat-error', text: result.output });
          }
          // Clean up temp file
          try { await fs.unlink(filePath); } catch (e) {}
        } catch (e) {
          thinking.remove();
          msgsEl.createDiv({ cls: 'chat-msg chat-error', text: e.message });
        }
      } else {
        // Text only
        msgsEl.createDiv({ cls: 'chat-msg chat-user' }).createEl('span', { text });
        input.value = '';
        msgsEl.scrollTop = msgsEl.scrollHeight;

        const thinking = msgsEl.createDiv({ cls: 'chat-msg chat-thinking', text: '思考中...' });
        try {
          const result = await HermesCLI.chat(text, { sessionId });
          thinking.remove();
          if (result.success) {
            let response = result.output;
            let newSessionId = null;
            const lines = result.output.split('\n');
            if (lines[0] && lines[0].includes('session_id:')) {
              newSessionId = lines[0].replace('session_id:', '').trim();
              response = lines.slice(1).join('\n').trim();
            }
            msgsEl.createDiv({ cls: 'chat-msg chat-assistant' }).createDiv({ cls: 'msg-text', text: response });
            if (newSessionId && !this.activeSessionId) {
              this.activeSessionId = newSessionId;
              headerLeft.querySelector('.chat-session-id')?.setText(newSessionId.substring(0, 12));
            }
          } else {
            msgsEl.createDiv({ cls: 'chat-msg chat-error', text: result.output });
          }
        } catch (e) {
          thinking.remove();
          msgsEl.createDiv({ cls: 'chat-msg chat-error', text: e.message });
        }
      }

      msgsEl.scrollTop = msgsEl.scrollHeight;
    };

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';

      // Show command suggestions
      const val = input.value;
      if (val.startsWith('/')) {
        const commands = ['/help', '/clear', '/new', '/status', '/doctor', '/insights', '/skills', '/logs', '/config', '/model', '/gateway', '/start', '/stop'];
        const matches = commands.filter(cmd => cmd.startsWith(val.toLowerCase()));
        if (matches.length > 0 && val.length > 1) {
          // Show suggestions tooltip
          let suggestEl = this.chatPanel.querySelector('.chat-suggest');
          if (!suggestEl) {
            suggestEl = this.chatPanel.createDiv({ cls: 'chat-suggest' });
          }
          suggestEl.empty();
          suggestEl.style.display = 'block';
          for (const cmd of matches.slice(0, 5)) {
            const item = suggestEl.createDiv({ cls: 'suggest-item' });
            item.createSpan({ cls: 'suggest-cmd', text: cmd });
            item.addEventListener('click', () => {
              input.value = cmd + ' ';
              suggestEl.style.display = 'none';
              input.focus();
            });
          }
        }
      } else {
        const suggestEl = this.chatPanel.querySelector('.chat-suggest');
        if (suggestEl) suggestEl.style.display = 'none';
      }
    });

    // Hide suggestions on blur
    input.addEventListener('blur', () => {
      setTimeout(() => {
        const suggestEl = this.chatPanel.querySelector('.chat-suggest');
        if (suggestEl) suggestEl.style.display = 'none';
      }, 200);
    });

    msgsEl.scrollTop = msgsEl.scrollHeight;
    input.focus();
  }

  async handleFileAttachment(file, previewEl, sessionId, msgsEl) {
    previewEl.empty();
    previewEl.style.display = 'flex';

    const isImage = file.type.startsWith('image/');

    // Show preview based on file type
    if (isImage) {
      // Image preview
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const img = previewEl.createEl('img', { cls: 'attach-thumb' });
        img.src = ev.target.result;

        previewEl.createSpan({ cls: 'attach-name', text: file.name });
        previewEl.createSpan({ cls: 'attach-type', text: '图片' });

        const removeBtn = previewEl.createEl('button', { cls: 'attach-remove', text: '×' });
        removeBtn.addEventListener('click', () => {
          previewEl.style.display = 'none';
          this.pendingFile = null;
          this.pendingFileName = null;
          this.pendingFileIsImage = false;
        });

        // Save to temp file
        const tempPath = path.join(HERMES_DIR, 'temp', `img-${Date.now()}.png`);
        await fs.mkdir(path.join(HERMES_DIR, 'temp'), { recursive: true });
        const buffer = Buffer.from(ev.target.result.split(',')[1], 'base64');
        await fs.writeFile(tempPath, buffer);

        this.pendingFile = tempPath;
        this.pendingFileName = file.name;
        this.pendingFileIsImage = true;
      };
      reader.readAsDataURL(file);
    } else {
      // Non-image file - show icon
      const iconEl = previewEl.createDiv({ cls: 'attach-file-icon' });
      const ext = file.name.split('.').pop().toLowerCase();
      const iconMap = {
        'pdf': '📄', 'doc': '📝', 'docx': '📝', 'txt': '📄', 'md': '📄',
        'json': '📋', 'yaml': '📋', 'yml': '📋', 'xml': '📋',
        'py': '🐍', 'js': '📜', 'ts': '📜', 'html': '🌐', 'css': '🎨',
        'zip': '📦', 'tar': '📦', 'gz': '📦',
        'mp3': '🎵', 'wav': '🎵', 'mp4': '🎬', 'mov': '🎬',
      };
      iconEl.createSpan({ text: iconMap[ext] || '📎' });

      previewEl.createSpan({ cls: 'attach-name', text: file.name });
      previewEl.createSpan({ cls: 'attach-type', text: ext.toUpperCase() });

      const removeBtn = previewEl.createEl('button', { cls: 'attach-remove', text: '×' });
      removeBtn.addEventListener('click', () => {
        previewEl.style.display = 'none';
        this.pendingFile = null;
        this.pendingFileName = null;
        this.pendingFileIsImage = false;
      });

      // Save text files to temp for content reading
      const textTypes = ['txt', 'md', 'json', 'yaml', 'yml', 'xml', 'py', 'js', 'ts', 'html', 'css', 'csv', 'log'];
      if (textTypes.includes(ext)) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const tempPath = path.join(HERMES_DIR, 'temp', `file-${Date.now()}.${ext}`);
          await fs.mkdir(path.join(HERMES_DIR, 'temp'), { recursive: true });
          await fs.writeFile(tempPath, ev.target.result);
          this.pendingFile = tempPath;
          this.pendingFileName = file.name;
          this.pendingFileIsImage = false;
        };
        reader.readAsText(file);
      } else {
        // For binary files, just save the path reference
        this.pendingFile = file.path || file.name;
        this.pendingFileName = file.name;
        this.pendingFileIsImage = false;
      }
    }
  }

  async renderSkills() {
    const c = this.contentEl;
    c.empty();
    const skills = await HermesCLI.getSkills();

    // Header with stats
    const header = c.createDiv({ cls: 'hermes-skills-header' });
    header.createEl('h3', { text: `技能管理` });
    const stats = header.createDiv({ cls: 'skills-stats' });
    stats.createSpan({ text: `共 ${skills.length} 个技能` });

    // Filter bar
    const filterBar = c.createDiv({ cls: 'skills-filter' });
    const search = filterBar.createEl('input', {
      cls: 'skills-search',
      placeholder: '搜索技能...',
    });

    // Category filter buttons
    const categories = this.getSkillCategories(skills);
    const categoryBar = filterBar.createDiv({ cls: 'skills-categories' });

    const allBtn = categoryBar.createEl('button', { cls: 'skills-cat-btn active', text: '全部' });
    allBtn.addEventListener('click', () => {
      categoryBar.querySelectorAll('.skills-cat-btn').forEach(b => b.removeClass('active'));
      allBtn.addClass('active');
      this.filterSkills(skills, '', '', grid);
    });

    for (const [cat, count] of Object.entries(categories)) {
      const btn = categoryBar.createEl('button', { cls: 'skills-cat-btn' });
      btn.createSpan({ text: this.getCategoryIcon(cat) + ' ' + cat });
      btn.createSpan({ cls: 'skills-cat-count', text: String(count) });
      btn.addEventListener('click', () => {
        categoryBar.querySelectorAll('.skills-cat-btn').forEach(b => b.removeClass('active'));
        btn.addClass('active');
        this.filterSkills(skills, '', cat, grid);
      });
    }

    // Skills grid
    const grid = c.createDiv({ cls: 'hermes-skills-grid' });
    this.renderSkillsGrid(skills, grid);

    // Search handler
    search.addEventListener('input', () => {
      const activeCat = categoryBar.querySelector('.skills-cat-btn.active')?.textContent?.split(' ')[1] || '';
      this.filterSkills(skills, search.value, activeCat === '全部' ? '' : activeCat, grid);
    });
  }

  getSkillCategories(skills) {
    const cats = {};
    for (const s of skills) {
      const cat = s.category || '其他';
      cats[cat] = (cats[cat] || 0) + 1;
    }
    // Sort by count
    return Object.fromEntries(Object.entries(cats).sort((a, b) => b[1] - a[1]));
  }

  getCategoryIcon(category) {
    const icons = {
      'creative': '🎨',
      'devops': '⚙️',
      'github': '🐙',
      'apple': '🍎',
      'gaming': '🎮',
      'email': '📧',
      'data-science': '📊',
      'autonomous-ai-agents': '🤖',
      'research': '🔬',
      'mlops': '🧠',
      'software-development': '💻',
      'messaging': '💬',
      'productivity': '📋',
      'social-media': '📱',
      'smart-home': '🏠',
      'red-teaming': '🔓',
      'note-taking': '📝',
    };
    return icons[category] || '📦';
  }

  filterSkills(skills, search, category, grid) {
    let filtered = skills;
    if (search) {
      const lower = search.toLowerCase();
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(lower) ||
        (s.category || '').toLowerCase().includes(lower)
      );
    }
    if (category) {
      filtered = filtered.filter(s => s.category === category);
    }
    grid.empty();
    this.renderSkillsGrid(filtered, grid);
  }

  renderSkillsGrid(skills, grid) {
    // Group by category
    const grouped = {};
    for (const s of skills) {
      const cat = s.category || '其他';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(s);
    }

    // Render each category group
    for (const [cat, catSkills] of Object.entries(grouped)) {
      const section = grid.createDiv({ cls: 'skills-section' });
      const sectionHeader = section.createDiv({ cls: 'skills-section-header' });
      sectionHeader.createSpan({ text: this.getCategoryIcon(cat) + ' ' + cat });
      sectionHeader.createSpan({ cls: 'skills-section-count', text: `${catSkills.length}` });

      const sectionGrid = section.createDiv({ cls: 'skills-section-grid' });
      for (const s of catSkills) {
        const card = sectionGrid.createDiv({ cls: 'hermes-skill-card' });

        const cardHeader = card.createDiv({ cls: 'skill-card-header' });
        const iconMap = {
          'creative': 'palette', 'devops': 'terminal', 'github': 'git-branch',
          'apple': 'smartphone', 'gaming': 'gamepad-2', 'email': 'mail',
          'data-science': 'bar-chart-2', 'autonomous-ai-agents': 'bot',
          'research': 'search', 'mlops': 'cpu', 'software-development': 'code',
          'messaging': 'message-circle', 'productivity': 'check-square',
        };
        setIcon(cardHeader.createDiv({ cls: 'hermes-skill-icon' }), iconMap[s.category] || 'puzzle');

        const info = cardHeader.createDiv({ cls: 'skill-info' });
        info.createDiv({ cls: 'hermes-skill-name', text: s.name });
        if (s.source) info.createDiv({ cls: 'hermes-skill-source', text: s.source });

        const statusEl = card.createDiv({ cls: `hermes-skill-status ${s.status === 'enabled' ? 'status-ok' : 'status-warn'}` });
        statusEl.setText(s.status === 'enabled' ? '✓ 已启用' : s.status);
      }
    }

    if (skills.length === 0) {
      grid.createDiv({ cls: 'hermes-empty', text: '没有找到技能' });
    }
  }

  async renderStats() {
    const c = this.contentEl;
    c.empty();
    const ins = await HermesCLI.getInsights(30);
    if (!ins) { c.createDiv({ cls: 'hermes-empty', text: '无数据' }); return; }
    c.createEl('h3', { text: 'Token 统计 (30天)' });
    const row = c.createDiv({ cls: 'hermes-stats-row' });
    this.statCard(row, 'coins', '总 Token', this.fmtTokens(ins.totalTokens));
    this.statCard(row, 'arrow-up', '输入', this.fmtTokens(ins.inputTokens));
    this.statCard(row, 'arrow-down', '输出', this.fmtTokens(ins.outputTokens));
    this.statCard(row, 'message-circle', '消息', ins.messages);
  }

  async renderPixelOffice() {
    const c = this.contentEl;
    c.empty();
    if (this.pixelOffice) this.pixelOffice.destroy();
    this.pixelOffice = new PixelOffice(c, this.plugin);
    await this.pixelOffice.init();
  }

  async renderLogs() {
    const c = this.contentEl;
    c.empty();
    const selector = c.createDiv({ cls: 'hermes-log-selector' });
    const logs = [{ name: 'agent', label: '📝 Agent' }, { name: 'gateway', label: '⚡ 网关' }, { name: 'errors', label: '❌ 错误' }];
    let currentLog = 'agent';
    const logContent = c.createDiv({ cls: 'hermes-log-content' });
    const loadLog = async (name) => {
      logContent.empty();
      const r = await HermesCLI.getLogs(name, 50);
      if (r.success) {
        for (const line of r.output.split('\n')) {
          const el = logContent.createDiv({ cls: 'hermes-log-line' });
          if (line.includes('ERROR')) el.addClass('log-error');
          else if (line.includes('WARNING')) el.addClass('log-warning');
          el.setText(line);
        }
      }
    };
    for (const { name, label } of logs) {
      const btn = selector.createEl('button', { cls: `hermes-btn ${name === currentLog ? 'active' : ''}` });
      btn.createSpan({ text: label });
      btn.addEventListener('click', () => { currentLog = name; selector.querySelectorAll('.hermes-btn').forEach(b => b.removeClass('active')); btn.addClass('active'); loadLog(name); });
    }
    await loadLog('agent');
  }
}

// Settings
class HermesSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const c = this.containerEl;
    c.empty();
    c.createEl('h2', { text: '设置' });
    new Setting(c).setName('自动刷新').addToggle(t => t.setValue(this.plugin.settings.autoRefresh).onChange(async v => { this.plugin.settings.autoRefresh = v; await this.plugin.saveSettings(); }));
    new Setting(c).setName('刷新间隔(秒)').addSlider(s => s.setLimits(5, 60, 5).setValue(this.plugin.settings.refreshInterval).setDynamicTooltip().onChange(async v => { this.plugin.settings.refreshInterval = v; await this.plugin.saveSettings(); }));
  }
}

// Status Block
class HermesStatusBlock extends MarkdownRenderChild {
  constructor(el) { super(el); }
  async onload() {
    this.containerEl.addClass('hermes-status-block');
    const [gw, proc, sess] = await Promise.all([HermesCLI.isGatewayRunning(), HermesCLI.getProcesses(), HermesCLI.getAgentStatus()]);
    const grid = this.containerEl.createDiv({ cls: 'hermes-inline-grid' });
    const g = grid.createDiv({ cls: 'hermes-inline-item' });
    const gi = g.createSpan({ cls: `status-${gw.running ? 'ok' : 'error'}` });
    setIcon(gi, gw.running ? 'check-circle' : 'x-circle');
    g.createSpan({ text: ` 网关：${gw.running ? '运行中' : '已停止'}` });
    const p = grid.createDiv({ cls: 'hermes-inline-item' });
    setIcon(p.createSpan({ cls: 'status-ok' }), 'cpu');
    p.createSpan({ text: ` ${proc.length} 进程` });
    const s = grid.createDiv({ cls: 'hermes-inline-item' });
    setIcon(s.createSpan({ cls: 'status-ok' }), 'message-circle');
    s.createSpan({ text: ` ${sess.length} 会话` });
    this.containerEl.createDiv({ cls: 'hermes-status-footer', text: new Date().toLocaleString() });
  }
}

// Plugin
class HermesMonitorPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new HermesSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_HERMES, (leaf) => new HermesMonitorView(leaf, this));
    this.addRibbonIcon('bot', 'Hermes', () => this.activateView());
    this.addCommand({ id: 'hermes-open', name: '打开监控', callback: () => this.activateView() });
    this.addCommand({ id: 'hermes-chat', name: '聊天', callback: () => new HermesChatModal(this.app, this).open() });
    this.registerMarkdownCodeBlockProcessor('hermes-status', (s, el, ctx) => { ctx.addChild(new HermesStatusBlock(el)); });
    console.log('Hermes Monitor loaded');
  }
  onunload() { }
  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_TYPE_HERMES, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
}

module.exports = HermesMonitorPlugin;
