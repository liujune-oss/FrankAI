执行发布流程，按以下步骤顺序完成：

1. 读取 `version.json`，将 build 号 +1，写回文件
2. 运行 `npm run build`，如果失败立即停止并报告错误，不继续后续步骤
3. 将本次改动的文件 stage 并直接提交，commit message 格式为：`类型: 描述, vX.X.X`（版本号从 version.json 读取）
4. 更新 `TODO.md`：版本号更新
5. 执行 `git push`

每步完成后输出简短状态，失败则停止。全部完成后输出最终版本号。
