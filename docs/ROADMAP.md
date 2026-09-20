# Proposed roadmap / 候选路线图

These are proposed development priorities, not a promised release schedule. Select a concrete task and acceptance criteria before implementation.

以下是候选开发方向，不是已承诺的功能或发布日期。每次开发先确定具体任务和验收标准。

| Priority / 优先级 | Candidate / 候选任务 | Acceptance / 验收方式 |
| --- | --- | --- |
| P0 | Make the effective app version and search state easy to see / 清楚展示运行版本及实际搜索状态 | A user can distinguish an older build, disabled search, unsupported native search, and a network error / 用户能区分旧版本、关闭搜索、接口不支持和网络错误 |
| P0 | Strengthen voice-session regression coverage / 完善语音会话回归验证 | Verify connect, interrupt, mute, reconnect, selected microphone, transcript lines, and answer delivery / 验证连接、打断、静音、重连、麦克风选择、转写换行与答案播报 |
| P1 | Improve diagnostics without exposing private settings / 完善不含隐私的排错信息 | Export useful error and timing evidence without keys, private endpoints, or conversation text / 导出有用的错误与耗时证据，不包含密钥、私人地址或对话内容 |
| P1 | Make upgrades easier to understand / 简化升级体验 | Users can identify the installed version and understand preserved settings / 用户能确认安装版本，理解升级后哪些配置仍会保留 |
| Later / 后续 | Add focused GPT-Live-1 examples / 增加具体场景示例 | Each example has a clear use case, minimal configuration, privacy review, and an executable validation procedure / 每个示例有明确用途、最少配置、隐私检查和可执行验证步骤 |

Keep the project easy to deploy. Additional services, broad rewrites, new authentication models, and multi-user hosting require a concrete agreed use case.

保持部署简单。新增外部服务、大规模重写、新鉴权体系和多人托管方案，应先有明确、已确认的实际需求。
