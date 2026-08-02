# X Collector

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/) [![Prisma + PostgreSQL](https://img.shields.io/badge/Prisma-PostgreSQL-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/docs/orm/overview/databases/postgresql) [![Hosted on Railway](https://img.shields.io/badge/hosting-Railway-0B0D0E?logo=railway&logoColor=white)](https://railway.com/)

[English](README.md) · [日本語](README.ja.md) · [ไทย](README.th.md) · 中文

**这是什么？** X Collector 是一项把 AI 与科技动态汇总成每日简报和可搜索信息流的服务。

**它解决什么问题？** 有价值的信息散落在社交平台、专业网站、软件项目页面和订阅源中。即使每天反复查看多个地方，也很容易错过重要消息以及事件之间的联系。

**它如何解决？** 你选择关注的信息源，X Collector 负责采集更新、分类整理并关联相关内容，再把同一套信息同时提供给读者和 AI 智能体。

![X Collector 从八类信息源采集内容，经过整理与编排后提供给读者和 AI 智能体，并通过人工审核维护信息源生命周期的示意图](assets/hero.svg)

## 目录

- [功能](#features)
- [支持的环境](#supported-environments)
- [架构](#architecture)
- [快速开始](#quickstart)
- [配置](#configuration)
- [文档](#documentation)
- [开发状态与路线图](#development-status)
- [参与贡献](#contributing)
- [致谢](#acknowledgments)
- [许可证](#license)

<a id="features"></a>
## 功能

- **采集七类平台，共八种信息源。** 将 X（Twitter）、Instagram、Facebook、Reddit、Qiita、GitHub，以及涵盖 RSS 和 YouTube 的 Alerts 订阅源汇总到一起。
- **把信息噪声整理成清晰的信息流。** 系统先统一各平台的数据格式，再按 11 个主类别和 15 个可选子类别进行分类，关联重复内容与后续报道，并汇总市场反馈。
- **自动编排每日简报。** 定时发布任务会把入选内容整理成包含 13 个版块的 Markdown 简报。
- **让读者和 AI 使用同一套信息。** 读者通过简报和网页查看；集成系统则使用带身份验证的 Feed API，或只读的 Streamable HTTP MCP server。
- **为简短内容补充上下文。** 分类前可以抓取链接正文和 YouTube 字幕，让系统拥有更完整的判断材料。
- **减少手动寻找新信息源的时间。** 发现流程会从已采集的 X 帖子中提取候选对象、获取其资料，再由 LLM 评分；任何候选对象都必须经过人工批准才能加入采集列表。
- **让信息源质量一目了然。** 系统每天按规则计算可信度分数，并用于简报排序；置信度较低的内容会明确标注，而不会被悄悄当成可靠信息。
- **安全停用质量下降的自动发现源。** 只有系统自动发现的信息源才可能被自动停用，而且必须连续两周触发门槛。手动添加的信息源永远不会被自动停用。
- **在一个界面管理信息源。** 设置页面集中管理各平台的信息源、候选审核，以及恢复被生命周期规则停用的信息源。

<a id="supported-environments"></a>
## 支持的环境

✅ 表示已通过本仓库或有记录的生产部署确认。⚠️ 表示文档明确列出且预计可用，但本次检出没有实际连接测试。

| 类别 | 环境 | 状态 |
|---|---|---|
| 运行时 | Node.js 18.17.0 或更高版本；本次检出使用 Node.js 26.5.0 完成构建 | ✅ 已验证 |
| 数据库 | PostgreSQL；文档未规定最低服务器版本 | ✅ 已核对 Prisma provider 和迁移文件 |
| 托管 | Railway | ✅ 已在生产环境验证 |
| MCP 客户端 | Claude CLI、Claude.ai、Claude Desktop | ⚠️ 文档已列出，本环境未连接测试 |

<a id="architecture"></a>
## 架构

**设计原则：** 信息只采集一次，在共享基础层中完成整理，再以读者和 AI 智能体都能使用的形式发布。

| 模块 | 职责 |
|---|---|
| `src/app/` | Next.js 页面、管理界面和 API endpoint |
| `src/collector/` | 各平台采集器和生产任务入口 |
| `src/lib/pipeline/` | 格式统一、分类、交叉关联、结合可信度的筛选和发布逻辑 |
| `src/summary/` | 生成每日摘要 |
| `prisma/` | PostgreSQL schema 与迁移文件 |

完整处理流程见 [V2 设计文档](docs/v2-design.md)。部署时间、安全行为、数据保留和运维命令见[运维指南](docs/operations.md)。

<a id="quickstart"></a>
## 快速开始

### 前置条件

- Node.js 18.17.0 或更高版本
- PostgreSQL 数据库
- 用于登录管理界面的 Google OAuth 凭据
- 准备采集和分类数据时所需的 ScrapeCreators 与 OpenRouter API key

当前 schema 使用 PostgreSQL JSONB 保存 embedding，不需要安装 pgvector 扩展。

### 安装

```bash
git clone https://github.com/caty-ai/x-collector.git
cd x-collector
npm install
cp .env.example .env
```

### 最小配置

启动应用前，打开 `.env` 并设置以下值：

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/x_collector
AUTH_SECRET=replace_with_a_long_random_secret
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
NEXTAUTH_URL=http://localhost:3000
```

如果要采集和分类数据，还需要设置：

```dotenv
SCRAPECREATORS_API_KEY=your_scrapecreators_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

### 运行

```bash
npm run migrate
npm run dev
```

打开 `http://localhost:3000` 并登录，然后在 `/settings` 中添加你自己的初始信息源列表。API key 和信息源准备完成后，可以在另一个终端中手动执行采集：

```bash
npm run collect
```

<a id="configuration"></a>
## 配置

| 你想做什么 | 查看位置 |
|---|---|
| 查看全部环境变量 | [环境变量参考](docs/operations.md#環境変数全リファレンス) |
| 单独运行各个处理步骤 | [V2 pipeline 辅助 CLI](docs/operations.md#v2-パイプライン補助-cli) |
| 配置生产环境定时任务 | [生产 cron 指南](docs/operations.md#cron本番運用) |
| 添加自己的采集源 | [添加信息源](docs/operations.md#ソース追加方法) |
| 了解信息源发现、可信度评分和生命周期规则 | [运维指南](docs/operations.md) |
| 查看已知运维待办 | [已知待办](docs/operations.md#既知の-follow-up未着手) |

<a id="documentation"></a>
## 文档

| 文档 | 内容 |
|---|---|
| [Pipeline 设计](docs/v2-design.md) | 处理阶段、分类体系和数据模型 |
| [运维指南](docs/operations.md) | 生产任务、cron、配置、数据保留和信息源运维 |
| [API 参考](docs/api.md) | Feed API 和应用接口 |
| [智能体 Feed 指南](docs/agent-feed.md) | 由智能体搜索和增量读取信息流 |
| [MCP server 指南](docs/mcp-server.md) | endpoint、身份验证、工具和客户端设置 |
| [变更日志](docs/changelog.md) | 项目变更记录 |

<a id="development-status"></a>
## 开发状态与路线图

- [x] **采集：** 七类平台、PostgreSQL 统一存储和 Feed API
- [x] **整理：** 格式统一、LLM 分类、交叉关联、市场反馈汇总和现行分类体系
- [x] **发布：** 带来源链接的 13 版块 Markdown 简报
- [x] **智能体访问：** 可搜索 Feed 和只读 MCP 工具（`search_feed`、`get_daily_news`）
- [x] **信息源质量控制：** 候选评估、可信度评分、审核界面和带安全门槛的停用生命周期
- [x] **公开发布基础：** 多语言公共文档、社区健康文件和 MIT 许可证
- [ ] **后续方向：** 改进语义主题聚类、理顺简报发布流程，并形成明确的数据保留政策

近期变更见[变更日志](docs/changelog.md)，当前运维缺口见[已知待办](docs/operations.md#既知の-follow-up未着手)。

<a id="contributing"></a>
## 参与贡献

以 Issue 为起点的开发流程、分支约定和 Pull Request 指南请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

<a id="acknowledgments"></a>
## 致谢

X Collector 基于以下服务构建：

- [ScrapeCreators](https://scrapecreators.com/) — X、Instagram、Facebook 和 Reddit 采集 API
- [OpenRouter](https://openrouter.ai/) — LLM 分类与简报编排
- [Qiita API v2](https://qiita.com/api/v2/docs) — 采集 Qiita 内容
- [GitHub REST API](https://docs.github.com/en/rest) — 仓库与搜索数据
- [Railway](https://railway.com/) — 托管与定时任务
- [TranscriptAPI](https://transcriptapi.com/) — 补充 YouTube 字幕

<a id="license"></a>
## 许可证

X Collector 采用 [MIT License](LICENSE) 开源。
