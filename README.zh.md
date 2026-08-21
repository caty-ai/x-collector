# X Collector

<div align="center">

[🇺🇸 English](README.md) ｜ [🇯🇵 日本語](README.ja.md) ｜ **🇨🇳 简体中文** ｜ [🇹🇭 ไทย](README.th.md)

![X Collector 主视觉：收集的帖子流汇织成一份报纸，一位女士正在阅读 —— "One information base, read by people and agents alike."](assets/hero.jpg)

<h4>一款免费开源的软件，运行在你自己的电脑或服务器上——<br>把散落各处的 AI 与科技资讯汇集成每天一份报纸和一个可搜索的信息流。</h4>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Prisma + PostgreSQL](https://img.shields.io/badge/Prisma-PostgreSQL-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/docs/orm/overview/databases/postgresql)
[![Hosted on Railway](https://img.shields.io/badge/hosting-Railway-0B0D0E?logo=railway&logoColor=white)](https://railway.com/)
[![Test](https://github.com/caty-ai/x-collector/actions/workflows/test.yml/badge.svg)](https://github.com/caty-ai/x-collector/actions/workflows/test.yml)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)

[它能做什么](#what) ｜ [你需要准备什么](#requirements) ｜ [开始使用](#start) ｜ [为什么值得信赖](#safety) ｜ [了解更多](#more)

有用的信息散落在社交网络、专业网站和项目主页上，<br>
想跟上动态就得每天巡视很多地方——即便如此，重要的来龙去脉还是会漏掉。<br>
X Collector 从你选定的信息源收集更新，整理归类并把相关话题串联起来，<br>
再把同样一份「整理好的信息」同时送到人和 AI 智能体面前。

**不用再到处巡视——资讯送到你手上时已经整理好了。**

🔧 [工程师文档](docs/engineering.md)（英文） ｜ 📘 [详细规格](docs/reference.md)（英文）

</div>

---

## 是不是很熟悉？

只要有一条戳中你，X Collector 就是为你准备的。

- 你在 X、Reddit、GitHub 和十几个网站上追 AI 新闻——却还是错过了重大发布
- 每天把所有信息源看一遍要花一小时，其中大半还是同一件事的重复报道
- 你已经分不清关注的账号里，哪些还值得继续关注
- 你的 AI 助手没法根据*你*信任的信息源回答「这周发生了什么？」

原因其实很简单：**信息从来没有汇集到一个整理好的地方。**X Collector 把这份收集和整理的工作整个接过来。

---

<a id="what"></a>

## 它能做什么

四个步骤，顺序始终如一。

```mermaid
flowchart LR
    A["① 收集<br/>来自 8 种信息源"] --> B["② 整理<br/>分类并关联"]
    B --> C["③ 出报<br/>每天一份报纸"]
    C --> D["④ 送达<br/>给人和 AI 智能体"]
```

- 📥 **收集**

  从 X（Twitter）、Instagram、Facebook、Reddit、Qiita、GitHub 以及 RSS/YouTube 订阅源收集更新。用哪些信息源，完全由你决定。

- 🗂️ **整理**

  把每条内容归入分类，把重复报道和后续进展关联起来，并为每个信息源近期的可信程度打分。

- 📰 **出报**

  把选出的内容排成一份 13 个版面的报纸，每天自动出刊。

- 🤖 **同时服务人和 AI**

  你在网页上阅读报纸和可搜索的信息流；你的 AI 智能体则通过 API 和 MCP 服务器（AI 工具接入数据的一种标准方式）读取完全相同的数据。

- ✅ **决定权始终在人手里**

  它可以推荐自己发现的有潜力的新信息源，但未经你明确批准，任何信息源都不会加入你的收藏。

---

<a id="requirements"></a>

## 你需要准备什么

只需三样。完整的兼容环境表见[工程师文档](docs/engineering.md#supported-environments)（英文）。

- **一个运行的地方** — 你自己的电脑或服务器，装有 Node.js 20 或更新版本
- **一个 PostgreSQL 数据库** — 用来存放收集到的内容
- **API 密钥，只需准备你要用的功能对应的那几个** — 见下表

| 你想做什么 | 需要什么 |
|---|---|
| 登录网页界面 | Google OAuth 凭据（免费） |
| 从 X、Instagram、Facebook、Reddit 收集 | 一个 [ScrapeCreators](https://scrapecreators.com/) 密钥 |
| 用 AI 分类并编排报纸 | 一个 [OpenRouter](https://openrouter.ai/) 密钥 |
| 给报道附上 YouTube 字幕文本 | 一个 [TranscriptAPI](https://transcriptapi.com/) 密钥（可选） |
| 从 Qiita、GitHub、RSS 收集 | 不需要密钥 |

关于费用：登录必须用到 Google OAuth，但它是免费的——那只是一种登录方式，不是付费 API。ScrapeCreators 和 OpenRouter 是按用量付费的收费服务，最新价格请查看它们的官网。就算一个付费密钥都没有，应用也能启动、能登录，不需要密钥的信息源也能正常收集——只是 AI 相关的步骤（分类和每日报纸）会保持关闭，直到你添加 OpenRouter 密钥。密钥可以以后再逐个添加。

---

<a id="start"></a>

## 开始使用

### 让 AI 智能体帮你安装

如果你在用 AI 编程智能体（Claude Code、Codex CLI 等类似工具），最快的方式就是把仓库交给它：

```text
请在这台机器上安装并配置 https://github.com/caty-ai/x-collector。
参照 .env.example，一步步引导我完成需要的设置。
```

智能体会完成克隆和安装，只向你询问它无法替你决定的值，比如数据库地址和登录密钥。如果某个问题你答不上来，直说就好——准备 PostgreSQL 数据库、配置 Google OAuth 这些事，智能体也能一步步陪你完成。

### 自己动手安装

第 1 步 — 下载并安装：

```bash
git clone https://github.com/caty-ai/x-collector.git
cd x-collector
npm install
cp .env.example .env
```

第 2 步 — 用任意文本编辑器打开 `.env`，填写必需的值。前 5 个用于数据库和登录；后 2 个让信息流和报纸页面正常工作：

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/x_collector
AUTH_SECRET=replace_with_a_long_random_secret
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
NEXTAUTH_URL=http://localhost:3000

# 单机本地安装时，让应用指向它自己，
# 并自己编一个足够长的随机密钥
RAILWAY_API_BASE_URL=http://localhost:3000
FEED_API_KEY=any_long_random_string_you_issue_yourself
```

第 3 步 — 启动：

```bash
npm run migrate
npm run dev
```

打开 `http://localhost:3000` 并登录，在 `/settings` 页面登记你的信息源。如果想先用示例信息源立即体验，可以运行一次 `npm run seed`。等收集用的密钥准备好后，再打开一个终端窗口，运行 `npm run collect` 就能开始收集。

<details>
<summary>遇到问题时</summary>

<br>

**提示 `command not found: npm`**

说明还没有安装 Node.js。请从 [nodejs.org](https://nodejs.org/) 下载 20 或更新版本，然后重新打开终端再试一次。

**连接不上数据库**

请确认 PostgreSQL 正在运行，并且 `DATABASE_URL` 里写的用户名、密码和数据库名确实存在。最常见的疏漏是忘了先创建一个名为 `x_collector` 的数据库。

**Google 登录报错**

Google OAuth 凭据可以在 [Google Cloud Console](https://console.cloud.google.com/) 免费创建（APIs & Services → Credentials → Create credentials → OAuth client ID）。请检查 `NEXTAUTH_URL` 是否与你在浏览器里打开的地址一致，以及在 Google Cloud 上登记的 OAuth 重定向 URI 是否为 `http://localhost:3000/api/auth/callback/google`。

</details>

---

<a id="safety"></a>

## 为什么值得信赖

X Collector 的设计原则是：绝不让自动化悄悄接管一切。

- **每个新信息源都由你亲自批准** — 发现的候选会打分并呈现给你，但只有人才能让它转正
- **手动添加的信息源永远不会被自动停用** — 自动退役只针对系统自己发现的信息源，而且必须连续两次通过每周检查才会执行
- **信息源质量每天打分** — 可信度分数会影响报纸的排序，来自低可信或未经验证信息源的报道会带上警示标记，而不是被悄悄当成可靠信息处理
- **智能体的访问是只读的** — MCP 服务器只能搜索和阅读，不能改动任何东西
- **你的数据始终属于你** — 它运行在你自己的服务器和数据库上，采用 MIT 许可证

## 项目状态

[![Test](https://github.com/caty-ai/x-collector/actions/workflows/test.yml/badge.svg)](https://github.com/caty-ai/x-collector/actions/workflows/test.yml)

- **CI**：上方徽章显示实时状态 — 每个 pull request 以及每次 push 到 main 时都会运行 Vitest 和 TypeScript 检查
- **已验证环境**：push 到 main 的 CI 在 Ubuntu 和 macOS 上固定使用 Node.js 20；pull request 门禁使用 runner 默认的 Node.js（当前为 22+）
- **成熟度**：核心流水线已在日常生产环境中使用，并得到积极维护
- **已知限制**：与外部平台通信的采集器需要你自己的 API 凭据，CI 不会运行这些采集器

自行运行检查：`make test` / `make lint`（封装了 `npm test` 和 TypeScript 检查 — 参见 [CONTRIBUTING](CONTRIBUTING.md)）。

---

<a id="more"></a>

## 了解更多

社区来源目录与贡献指南：[docs/community-sources.md](docs/community-sources.md) — 目录条目仅为建议，绝不会被自动订阅。

按目的选择入口。

| 你想了解什么 | 去哪里看 |
|---|---|
| 工作原理：架构、完整安装、运维（面向工程师） | [docs/engineering.md](docs/engineering.md)（英文） |
| 精确规格：环境变量、API、MCP 工具 | [docs/reference.md](docs/reference.md)（英文） |
| 所有设置、定时任务和运维细节的完整汇总 | [docs/operations.md](docs/operations.md)（日文） |
| 如何参与贡献 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 如何报告缺陷或安全漏洞 | [SECURITY.md](SECURITY.md) |

<!-- family:generated:family-footer:start -->

---

本仓库属于 **Caty AI 家族** — 用于运营 AI 智能体家族的开源工具集。完整地图（包括仍在准备公开的模块）见 [Family OS](https://github.com/caty-ai/family-os)。

| 轴 | 模块 | 做什么 | 状态 |
| --- | --- | --- | --- |
| 地图 | [Family OS](https://github.com/caty-ai/family-os) | 整个家族的地图 — 模块、状态与结构 | 已公开・MIT |
| 规则 | [Family Dev Handbook](https://github.com/caty-ai/family-dev-handbook) | 开发的交通规则 — Issue、PR、worktree、交接与并行开发 | 已公开・MIT |
| 纵轴・基座 | [Caty Agent Harness](https://github.com/caty-ai/caty-agent-harness) | AI 智能体的任务基座 — 重试、检查点与完成判定 | 已公开・MIT |
| 纵轴 | [context-kit](https://github.com/caty-ai/context-kit) | 面向单个智能体的六件上下文卫生工具组 — 限制大输出、委托简报校验、安全防护、记忆检索、worktree 快照 | 已公开・MIT |
| 纵轴 | [Persona Engine](https://github.com/caty-ai/persona-engine) | 为智能体赋予人格 — 分层人格与情感渐变 | 已公开・MIT |
| 纵轴 | [Persona Growth Loop](https://github.com/caty-ai/persona-growth-loop) | 让人格本身成长 — 以最小且幂等的提案 | 已公开・MIT |
| 纵轴 | **X Collector** | 把 X 与网络素材汇成每日一份摘要 — 给人也给智能体 | 已公开・MIT |
| 纵轴 | [Self Growth Loop](https://github.com/caty-ai/self-growth-loop) | 让智能体自我成长的循环 — 提案、治理与采用记录 | 已公开・MIT |
| 横轴・基座 | [Family Memory Architecture](https://github.com/caty-ai/family-memory-architecture) | 记忆总线 — 家族共享所知的一层 | 已公开・MIT |
| 横轴 | [Sitter](https://github.com/caty-ai/sitter) | 替你盯着委派出去的智能体 — 监视、留证、重启 | 已公开・MIT |

<!-- family:generated:family-footer:end -->

---

## 致谢

X Collector 建立在这些服务之上：[ScrapeCreators](https://scrapecreators.com/)（社交平台采集 API）、[OpenRouter](https://openrouter.ai/)（AI 分类与报纸编排）、[Qiita API v2](https://qiita.com/api/v2/docs)、[GitHub REST API](https://docs.github.com/en/rest)、[Railway](https://railway.com/)（托管）以及 [TranscriptAPI](https://transcriptapi.com/)（YouTube 字幕）。

---

## 许可证

[MIT](LICENSE) © 2026 Caty

我们希望任何人都能自由使用 X Collector——运行它、修改它、把它集成进你自己的产品。只要保留版权声明，商业使用和再分发都欢迎。

---

<div align="center">

**每天一份报纸** ｜ **8 种信息源** ｜ **同时服务人和 AI 智能体**

</div>
