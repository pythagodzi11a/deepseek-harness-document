# DeepSeek Harness 文档站（独立项目）

把 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 仓库的官方文档自动投影为一份
[Hextra](https://imfing.github.io/hextra/)（Hugo 主题）文档网站：**整个站点就是一份文档** —— 根 README 是首页，
五个平铺章节（入门指南 / 开发 / Cordis 教程 / 参考 / 子系统）直接挂在根下，左侧导航在任何页面都显示完整目录，
另有面包屑、全站搜索与中英双语（中文为默认语言，英文在 /en/ 前缀下）。

上游文档更新后**无需手动上传**：GitHub Actions 每日定时（也可手动触发）重新拉取上游文档、重新生成、构建并
自动部署到 GitHub Pages。

## 目录结构

    scripts/generate.ts               生成器：把上游 docs/ 投影到 content/ 与 static/（gitignored，可再生）
    hugo.yaml                         Hextra 站点配置（不设 baseURL，部署时用 --baseURL 覆盖）
    i18n/                             页脚署名文案（中 / 英）
    layouts/partials/custom/footer.html  页脚署名（MIT 合规，Hextra 标准扩展点）
    .github/workflows/deploy.yml      CI/CD：拉取上游 → 生成 → 构建 → 部署 GitHub Pages
    ATTRIBUTION.md                    版权与许可说明（MIT 合规）

## 本地开发

前置：Hugo（extended，>= 0.146）、Node >= 22.19、pnpm；以及一个上游仓库检出，默认取相邻目录
`../deepseek-harness`（与 CI 里 `UPSTREAM_DIR` 指向的检出等价）。

```sh
pnpm install
pnpm run generate   # 投影 content/ 与 static/（读取 $UPSTREAM_DIR，默认 ../deepseek-harness）
pnpm run dev        # generate + hugo server → http://localhost:1313/
pnpm run build      # generate + 生产构建到 public/
```

## CI/CD（GitHub Actions）

`.github/workflows/deploy.yml` 在以下时机运行：

- 每日 03:17 UTC —— 定时检查上游文档是否有更新；
- 手动触发 —— 仓库 Actions 页面 → Run workflow；
- 推送到 main —— 站点配置 / 脚本变更时。

流程：稀疏克隆上游仓库（docs/、website/、scripts/、根 README）→ 安装依赖 → 生成 content/ →
Hugo 构建（baseURL 按仓库名自动计算为 `https://<owner>.github.io/<repo>/`）→ 发布到 GitHub Pages。

### 一次性配置

仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
此后每次工作流运行都会自动发布，无需手动上传。

## 版权与许可

站点内容整理自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT License，
Copyright (c) 2026 DeepSeek），每个页面底部已带署名；完整说明见 ATTRIBUTION.md。
