# Hermes Agent Monitor - Obsidian Plugin

[![Release](https://img.shields.io/github/v/release/yourusername/obsidian-hermes-monitor)](https://github.com/yourusername/obsidian-hermes-monitor/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22hermes-monitor%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=hermes-monitor)

> 🤖 在 Obsidian 中监控和管理你的 [Hermes Agent](https://github.com/nousresearch/hermes-agent) - 实时状态、会话管理、像素办公室、图片识别

![Hermes Agent Monitor](docs/screenshot.png)

## ✨ 功能特点

### 📊 实时监控仪表盘
- 网关状态监控（运行/停止）
- 进程数量统计
- 会话数量统计
- Token 消耗统计（总/输入/输出）

### 🏢 像素办公室
- 可视化展示所有 Agent 状态
- 实时动画：工作中、空闲、等待、离线
- 显示当前使用的工具
- CPU/内存使用监控
- 点击查看详情

### 💬 集成聊天
- 内嵌会话聊天面板
- 历史会话侧边栏（可折叠）
- 支持 `/` 斜杠命令
- 流式输出
- 命令自动补全

### 🖼️ 图片识别
- 拖拽图片到聊天区
- 直接调用 MiniMax Vision API
- 支持 PNG、JPG、GIF、WebP

### 📎 附件支持
- 拖拽任意文件
- 支持图片、文本、代码文件
- 剪贴板粘贴图片

### 🧩 技能管理
- 按分类展示所有技能
- 搜索和筛选
- 分类图标

### 📝 会话管理
- 查看所有会话
- 恢复历史会话
- 会话内嵌聊天

### ⚙️ 配置管理
- 查看系统配置
- 切换模型
- 网关控制

## 📦 安装

### 方法 1：从 Obsidian 社区插件安装（推荐）

1. 打开 Obsidian 设置
2. 进入 **社区插件** → **浏览**
3. 搜索 **Hermes Agent Monitor**
4. 点击 **安装** → **启用**

### 方法 2：手动安装

1. 从 [Releases](https://github.com/yourusername/obsidian-hermes-monitor/releases) 下载最新版本
2. 解压到你的 vault 的 `.obsidian/plugins/hermes-monitor/` 目录
3. 重启 Obsidian
4. 在设置中启用插件

### 方法 3：从源码构建

```bash
# 克隆仓库
git clone https://github.com/yourusername/obsidian-hermes-monitor.git
cd obsidian-hermes-monitor

# 安装依赖
npm install

# 构建
npm run build

# 复制到 Obsidian
cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/hermes-monitor/
```

## 🚀 快速开始

### 前置要求

- [Obsidian](https://obsidian.md/) v0.15.0+
- [Hermes Agent](https://github.com/nousresearch/hermes-agent) 已安装并运行

### 启用插件

1. 打开 Obsidian
2. 进入 **设置** → **社区插件**
3. 找到 **Hermes Agent Monitor**，启用它
4. 侧边栏会出现 Hermes 图标

## 📖 使用指南

### 仪表盘

点击侧边栏的 Hermes 图标，打开监控面板：

- **仪表盘**：查看整体状态
- **进程**：查看运行中的 Agent
- **会话**：管理会话和聊天
- **技能**：查看已安装技能
- **统计**：Token 消耗统计
- **办公室**：像素风 Agent 可视化
- **日志**：查看系统日志

### 聊天功能

1. 切换到 **会话** 标签页
2. 点击 **新建会话** 或选择历史会话
3. 在输入框输入消息
4. 按 Enter 发送

### 斜杠命令

在聊天框中输入 `/` 查看可用命令：

| 命令 | 功能 |
|------|------|
| `/help` | 显示帮助 |
| `/clear` | 清空对话 |
| `/new` | 新建会话 |
| `/status` | 系统状态 |
| `/doctor` | 系统诊断 |
| `/insights` | Token 统计 |
| `/skills` | 列出技能 |
| `/logs` | 查看日志 |
| `/config` | 查看配置 |
| `/model` | 切换模型 |
| `/gateway` | 网关状态 |
| `/start` | 启动网关 |
| `/stop` | 停止网关 |

### 图片识别

1. 拖拽图片到聊天区域
2. 可选：输入问题（如"这是什么？"）
3. 点击发送
4. 等待 MiniMax Vision API 分析结果

**支持的格式**：PNG、JPG、JPEG、GIF、WebP

### 像素办公室

切换到 **办公室** 标签页，查看：

- 每个 Agent 的实时状态
- 当前使用的工具
- CPU/内存使用
- 点击查看详情

## ⚙️ 配置

### 插件设置

在 Obsidian 设置中找到 **Hermes Agent Monitor**：

- **自动刷新**：是否自动刷新状态
- **刷新间隔**：刷新间隔（秒）

### 图片识别配置

图片识别使用 MiniMax Vision API，需要配置 API Key：

1. 在 Hermes 配置文件 `~/.hermes/.env` 中设置：
   ```
   MINIMAX_CN_API_KEY=your-api-key
   ```

2. 或者在 Hermes 中运行：
   ```bash
   hermes config set env.MINIMAX_CN_API_KEY your-api-key
   ```

## 🛠️ 开发

### 项目结构

```
obsidian-hermes-monitor/
├── main.js          # 主要代码（编译后）
├── manifest.json    # 插件清单
├── styles.css       # 样式文件
├── src/             # 源代码（TypeScript）
│   ├── main.ts
│   ├── hermes-cli.ts
│   ├── pixel-office.ts
│   └── ...
├── package.json
└── README.md
```

### 开发命令

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 构建生产版本
npm run build

# 代码检查
npm run lint
```

### 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 创建 Pull Request

## 📝 更新日志

### v1.0.0 (2026-05-01)
- 初始发布
- 实时监控仪表盘
- 像素办公室可视化
- 集成聊天面板
- 图片识别支持
- 技能分类管理
- 斜杠命令支持

## 🐛 问题反馈

如果遇到问题，请在 [Issues](https://github.com/yourusername/obsidian-hermes-monitor/issues) 中反馈。

请包含：
- Obsidian 版本
- 插件版本
- 操作系统
- 错误信息或截图

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。

## 🙏 致谢

- [Obsidian](https://obsidian.md/) - 优秀的知识管理工具
- [Hermes Agent](https://github.com/nousresearch/hermes-agent) - 强大的 AI Agent 框架
- [OpenClaw Dashboard](https://github.com/xmanrui/OpenClaw-bot-review) - 像素办公室设计灵感

## 🔗 链接

- [Hermes Agent 文档](https://hermes-agent.nousresearch.com)
- [Obsidian 插件开发文档](https://docs.obsidian.md/Plugins/Getting+started)
- [MiniMax API](https://www.minimax.io)

---

<p align="center">
  Made with ❤️ for the Hermes Agent community
</p>
