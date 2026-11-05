# dsh-room-world · 大肥鱼的房间与小天地

DeepSeek Harness（DSH）插件：给 DSH 里的 AI 角色一个「房间」和一片「小天地」。她能感知桌面小屋里自己在做什么，还能自己经营农场、花园和池塘：种地、钓鱼、买卖、育种、收集图鉴。主人只能看，以及留心愿引导。

桌面画面由配套程序 **dafeiyu-room**（Electron 桌面小屋）显示，这是一个独立仓库。插件本身不依赖桌面程序：没有桌面程序时，小天地照样运转，QQ 等机器人也照样能读写。

## 功能

- **房间感知**：`room_world` 工具读取桌面小屋回报的真实动作、位置和时段，可以让她去看书、吃饭、睡觉等。房间离线超过 30 秒时，如实报告「无法确认」。
- **小天地**：
  - 内容：12 种作物、7 种花、8 种鱼，货币是贝壳；
  - 规则：作物分三段，每段都要浇水；成熟有采收窗口；鱼咬钩后要在窗口内收竿；
  - 大小：果实和鱼都有大小和等级，可以靠照料、施肥、育种、鱼饵去冲更大的；
  - 经济：每日行情、每日委托、商店分级、扩地、鱼缸，图鉴永久保存纪录；
  - 详见 [docs/2026-11-05-xiaotiandi-loop-plan.md](docs/2026-11-05-xiaotiandi-loop-plan.md)。
- **她自己经营**：她读「小屋简报」，调用 DSH 默认模型定下打算（默认每天最多 4 次）。执行器每 15 秒照着打算或勤快规则做一件事，不调用模型。
- **主人只能引导**：本机接口只允许查看、看商店、看图鉴、留心愿、请她重新规划。QQ 私聊里说到小天地的话，会自动记成心愿。
- **机器人适配器**：
  - `standalone`：自带人格；
  - `surfcore`：只读 SurfCore 当前人格、记忆、心境和主人 QQ 私聊；
  - 也可以通过 `registerAdapter` 接入其他机器人。
- **QQ 上下文**：SurfCore 模式下，通过 DSH 的 `agent/pre-step` 钩子，只在主人私聊会话里补入房间事实和小屋简报。

## 安装

需要 Node.js 22 及以上，以及 DSH。

```bash
git clone <this repo> dsh-room-world
cd dsh-room-world
npm test
```

**方式一：在 DSH 的插件管理里添加这个目录或 `npm pack` 生成的 tgz，并启用 bundle。** 默认使用 `adapter: standalone`，模型用 DSH 设置里的默认模型。

**方式二：用安装脚本**（Windows）：

```bash
node scripts/install-plugin.mjs desktop
```

- 修改 profile 前会先备份；
- 调用 DSH 官方包管理器，以 `link:` 方式登记本目录，离线安装，不运行依赖脚本；
- 默认在本仓库所在盘的 `DSH/DeepSeek Harness.exe` 找 DSH，装在别处时设置 `DSH_DESKTOP_EXE`；
- 能找到 SurfCore 时（`SURFCORE_ROOT` 指定的目录，或同级的 `surfcore` 目录），配置为 `surfcore` 适配器，并只给 SurfCore 的 QQ 工具白名单加上 `room_world`。

插件列表里显示的名字是「大肥鱼 · 房间与小天地」。安装后需要重载插件，或者重启 DSH。

DSH profile 的 `cordis.patch.yml` 配置示例（bundle 会自己插入插件行，不要重复 insert）：

```yaml
- id: dsh-room-world
  config:
    adapter: surfcore            # 或 standalone
    surfcoreRoot: /path/to/surfcore
    qqContext: true              # 在主人 QQ 私聊里补入房间事实
    planner:
      enabled: true              # 她自己定打算（调用 DSH 默认模型）
      maxPerDay: 4
```

`standalone` 模式可以加一个 `persona` 字段。

## 给 DSH / QQ 模型使用

```json
{"target":"room","action":"observe"}
{"target":"room","action":"rice"}
{"target":"world","action":"visit","area":"farm"}
{"target":"world","action":"observe"}
{"target":"world","action":"plant","area":"farm","species":"rice","requestId":"unique-plant-1"}
{"target":"world","action":"water","area":"farm","slot":0}
{"target":"world","action":"buy","item":"seed:radish","qty":2}
{"target":"world","action":"sell","itemId":"i12"}
{"target":"world","action":"plan","plan":{"goal":"冲一个大番茄","steps":[{"action":"plant","area":"farm","species":"tomato"}],"policy":{"keepSeedMinGrade":"l"}}}
{"target":"world","action":"auto","enabled":false}
```

工具名均为 `room_world`。房间动作排队返回 queued；真实 UI 回报 accepted / arrived / rejected / cancelled。未收到 arrived 不应声称已完成。

房间动作：`pet,walk,roam,tour,choosebook,read,computer,sleep,tea,snack,stretch,window,fish,feed,water,dance,rice,away,home,auto,pause,lamp-on,lamp-off`。

世界动作：`observe,visit,plant,water,harvest,fertilize,cast,collect,shop,buy,sell,deliver,cook,brew,craft,keep,release,decorate,codex,plan,auto`；区域 `room,farm,garden,pond`；地块编号从 0 开始（可扩建到 8 块）。物种、价格、生长时间见 `lib/species.js`；作物分三段，每段都要浇水；鱼咬钩后 10 分钟内要收竿。完整规则和自主规划见 [小天地方案](docs/2026-11-05-xiaotiandi-loop-plan.md)。工具返回简短结果加「小屋简报」(`brief`)，不再返回整份世界 JSON。

主人在 QQ 私聊里说到小天地的话（提到种地、钓鱼、买卖、物种名等，且不是「去吃白米饭」这类房间短指令），会在 10 分钟内自动记成心愿，即使 QQ 回合里她没有调用工具，这些引导也会进入她的下一次规划。工具输出统一转成无损 JSON（DSH 会拒绝含 `undefined` 的输出）；`status/look/check` 按 observe 处理，发给 world 的房间动作（如 walk）会转给房间。

主人通过本机接口只能 `observe/shop/codex/wish/replan`，其他世界动作返回 `OWNER_GUIDANCE_ONLY`；所有经营都由她（执行器或她的 `room_world` 调用）完成。

配置 `planner: { enabled: true, maxPerDay: 4 }` 控制她自己定打算时调用 DSH 默认模型的次数；关闭后只按勤快规则自主游玩。

回家用 `{target:"room",action:"home"}` 或 `{target:"world",action:"visit",area:"room"}`。兼容 `go_home/return_home/back_home` 回家，以及 `world` 下 `move/go_to` 前往指定 area。回家会同步世界区域，她会在家歇 30 分钟再自己继续，避免刚回来又被自动任务带出门。`observe` 不移动角色。无法识别的动作返回具体纠正提示。

QQ 的「去吃白米饭」「去看书」「回家」「关灯」等明确短指令自动执行；疑问、否定和转述不按命令处理。复杂意图与世界游玩由 QQ 模型调用工具。

SurfCore 模式下，每次主人 QQ 会话进入模型步骤时，独立插件通过 DSH `agent/pre-step` 自动补入当前房间事实、小屋简报和少量带来源的最近桌面对话。回答「房间接通了吗」「你在做什么」无需等模型自行选择工具。状态只进入 SurfCore 会话记录明确对应的主人私聊，不进入其他 DSH 会话或群聊，也不改写原人格和长期记忆。`qqContext: false` 可关闭自动补入；工具仍可手动读取事实。其他适配器实现 `matchesSession(agent)` 后也能使用同一机制。

活动感知不是实时图像：没有接入屏幕截图或实时房间视频。在线状态按 UI 心跳判断，超过 30 秒如实报告无法确认。新增上下文监听器需要重载插件或重启 DSH 后生效，现有聊天历史不会删除。

## 接入其他机器人

其他机器人在本插件启动前注册适配器，再把配置 adapter 设为注册名。模块通过同一个 `dsh-room-world` 包导入。

```js
import { registerAdapter, getRoomWorld } from 'dsh-room-world';
const off = registerAdapter('my-bot', {
  async context() {
    return { id: 'stable-character-id', name: '角色名', persona: '当前人格', memory: '当前记忆注入块' };
  },
  async messages() {
    // 可选；只返回获授权的主人私聊。messageId 必须稳定，at 为毫秒时间。
    return [{ key: 'private:123', ownerQQ: '123', role: 'user', text: '去看书', messageId: 'stable-id', at: Date.now(), characterId: 'stable-character-id' }];
  },
  matchesSession(agent) {
    // 从你的机器人自己的会话绑定中核对；不要匹配所有 DSH 会话。
    return agent.session.id === yourOwnerSessionId;
  },
});
// 在房间插件启用后读取信息，或主动控制。不要缓存过期的 context。
const facts = await getRoomWorld().tool({ target: 'room', action: 'observe' });
const promptBlock = facts.context + '\n' + facts.brief;
// 将 promptBlock 加到你的机器人当前轮系统上下文；无需替换原人格/记忆。
// 卸载适配器时 off()。
```

插件不向外部机器人的原记忆库擅自写入内容。桌面对话保存于本插件；机器人需要把经历写入自己的长期记忆时，使用自己的记忆接口。

## 本机接口与数据

桌面程序 dafeiyu-room 通过它自带的本机连接器访问下面的接口；其他前端也可以按同样的方式接入。

`~/.dsh/room-world/host.json` 提供当前 loopback 地址、API 前缀 `/dsh-room-world/api` 和本机 token。桌面主进程读取它，浏览器只得到短期连接器 session。拒绝跨站、非回环和无 token 请求。不要把 host.json、token.json、聊天或存档提交到 Git。

接口包括 GET `/status,/history,/room/events,/commands,/world,/qq-context`，POST `/chat,/room/state,/world`。`/status.qqContext` 报告监听注册状态、最近一次实际 QQ 注入时间与错误；`/qq-context` 只读干跑同一挂接路径，不向 QQ 发消息，也不把干跑计为实际注入。HTTP 请求头使用 `x-pet-token`（只用于本机接口，不是 SurfCore 的旧 token）。30 秒过期检测仅代表 UI 在线事实；世界存档可继续生长。

存档按角色哈希隔离在 `~/.dsh/room-world/characters/` 与 `pet/room-link/`。切换人格时取消尚未完成的旧人格模型回复。API 模型调用有 180 秒超时，桌面重试使用稳定 requestId 防止重复写入。

## 许可

代码使用 MIT 许可。插件里的「大肥鱼」角色设定（DeepSeek 鲸鱼娘）来自社区开源资产库 [deepseek-whale-girl](https://github.com/TreapGoGo/deepseek-whale-girl)。本仓库不包含任何立绘图片；桌面程序 dafeiyu-room 里的美术资源以 CC BY-NC-SA 4.0 单独授权。
