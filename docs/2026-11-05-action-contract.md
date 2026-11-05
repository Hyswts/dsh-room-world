# 回房间指令报未知动作

截图中的调用为 `world/move/room` 和 `room/go_home`。工具原来把 action 声明成任意字符串，没有列出目标对应动作或回家示例；实际后端仅接受 world/visit 与 room/home，导致模型猜参后反复报错。

修复：工具 schema 列举允许动作并说明 target 规则；兼容 move/go_to→visit、go_home/return_home/back_home→home，未知动作仍拒绝，返回 ok:false、code、error、hint 及正确回家示例，不退化成任意动作执行。

连带修复：room/home 同步世界位置回到 room；手动回家暂停户外自主游玩，避免下一次 tick 又被带出去；world/observe 仅观察，不再次排队出门。回家返回 queued，角色真实抵达仍以 UI arrived 回报为准。

验证：用截图原样参数回归，检查世界位置、自主游玩状态、home 队列、观察无移动，以及未知动作/缺目的地错误提示。运行 npm test。修复位于独立 DSH 插件，桌面 exe 无需重新构建；重载插件或重启 DSH 后生效。

后续修订（2026-11-05）：小天地改为完全由她自己经营后，「回家」不再关闭自主游玩，而是让她在家歇 30 分钟，然后自己继续。
