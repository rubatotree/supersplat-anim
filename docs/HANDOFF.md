# SuperSplat 动画交付状态

更新时间：2026-10-05（北京时间）。代码与测试已推送到
`rubatotree/supersplat-anim` 的 `main`，当前代码提交 `4adbeae`，完整本机验收证据提交 `5425a43`。

## 已交付

格式无关固定拓扑动画接口、秒时钟、严格 BGS 0.1 导入、CPU/DQ 参考求值、
GPU 共享变形、绑定颜色与四槽检查、基础姿态仿射编辑、历史与实例生命周期、
项目 v2 及旧项目读取、当前帧静态导出、截图/视频同步、标准 BGS 回写。
新版动画工作区包含标签、状态、样本信息、原生图标和响应式布局；动画面板
默认收起，经时间轴行按钮展开，绑定详情随面板常开。

主要提交顺序见 `git log --oneline`；最近的功能/测试节点是：

- `0c1ffc5 feat(ui): refine the animation workspace and binding inspector`
- `80a070f fix(animation): protect capture from editing shortcuts`
- `5425a43 test(animation): add integration coverage and acceptance records`
- `4adbeae fix(ci): initialize a complete software WebGPU rendering path`

所有提交通过常规 push 推送，没有强推；真实数据与生成的 70MB 压力资产
未加入仓库。最终文档补充由后续 `docs` 提交记录。

## 验证与复现

本机生产构建、类型检查、lint、本地化完整性、19 项 TS 单元测试、20 项
硬件 WebGPU 测试通过。最终软件 WebGPU 17 项通过，4 项真实/性能检查明确跳过；
额外的硬件适配器/画布预检也通过，确认 NVIDIA Lovelace 非 fallback。
原始参考数学测试 5/5、JS 自检、真实输入和两个重新导出的 BGS 包的
独立 Python 校验/manifest 检查通过。完整命令与误差、性能、截图见
[验收报告](animation-acceptance.md)，使用方式见 [指南](animation.md)。

真实资产：`/data/zhuyutian/data/bgs/samples/pick-the-block-20261004/`。
复现时运行 `npm run test:stress` 生成合成压力资产，之后执行
`npm run test:browser`。没有真实数据的环境按报告使用 skip 环境变量。

GitHub 远端验证：
[CI 37221389015](https://github.com/rubatotree/supersplat-anim/actions/runs/37221389015)。
全部作业通过：构建、类型检查/19 项单元测试、lint/本地化，以及
17 项软件 WebGPU 检查（4 项真实/性能检查明确跳过，约 4.3 分钟）。
机器可读运行状态见 [github-ci.json](acceptance/github-ci.json)。
初次运行 37219883465 的浏览器作业因画布共享图像初始化失败而超时，
已在本机复现并修正配置，不计作通过。

## 当前完成状态

本次 goal 与 ROADMAP M1–M10 完成，没有未完成的本次验收项。最终文档
提交后工作区应为干净状态；已由交付操作核对本地 main 与 origin/main。

## 已知范围与下一步

没有以损坏或不支持的格式代替标准 BGS。神经网络推理加载与动态拓扑是
后续新需求。当前资产 one-hot B 绑定、未优化人工校准且无释放片段，
不用于声称抓取物理、校准或重建质量通过。新语言条目除中/英文外使用
英文 fallback；更广泛浏览器/编码器、360 输出及逐像素视觉验收未覆盖。

如继续扩展，应先读取 ROADMAP.md、docs/dev_log.md 和 animation/types.ts，
保持姿态版本/取消机制、完整仿射协方差与 scene-frame SH 约定。
新增 provider 的渲染适配、逆编辑能力和格式特有验证需独立实现。

## 额度

账号升级后用户硬底线为周剩余 **80%**，旧 32% 规则失效。
新基线 87% 剩余，最新实时读数 **85%**，没有触达收尾或硬停止线。
重置时间为 2026-10-09 21:27:42 UTC（北京时间 10 月 10 日 05:27:42）。
本机账本 `.git/animation-quota.json` 与检查器 `.git/check-animation-quota.py`
不提交；未来会话必须重新读取实时用量，不能使用本文件中的历史读数授权工作。
