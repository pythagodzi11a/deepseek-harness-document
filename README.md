# DeepSeek Harness 文档站

DeepSeek Harness 官方文档的 Hextra 文档站，中文为主、英文在 /en/：

**https://pythagodzi11a.github.io/deepseek-harness-document/**

内容由 [scripts/generate.ts](scripts/generate.ts) 从上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 `docs/` 与根 README 自动投影生成。上游更新后，GitHub Actions 每日自动重建并部署，无需手动上传。

## 本地开发

前置：Hugo（extended ≥ 0.146）、Node ≥ 22、pnpm；上游检出默认取 `../deepseek-harness`（可用 `UPSTREAM_DIR` 覆盖）。

```sh
pnpm install
pnpm run dev    # 生成内容并启动 http://localhost:1313/
pnpm run build  # 生成并构建到 public/
```

## 部署

`.github/workflows/deploy.yml`：每日 03:17 UTC、手动触发或推送 main 时自动构建并发布到 GitHub Pages。

## 版权

内容整理自 DeepSeek Harness（MIT License），页脚已带署名；完整说明见 [ATTRIBUTION.md](ATTRIBUTION.md)。
