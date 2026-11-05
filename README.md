# dsh-room-world · 大肥鱼的房间与小天地

DeepSeek Harness（DSH）插件：给 DSH 里的 AI 角色一个「房间」和一片「小天地」。她能感知桌面小屋里自己在做什么，还能自己经营农场、花园和池塘：种地、钓鱼、买卖、育种、收集图鉴。主人只能看，以及留心愿引导。

桌面画面由配套程序 **[dafeiyu-room](https://github.com/amimi-wenke/dafeiyu-room)**（Electron 桌面小屋）显示，这是一个独立仓库。插件本身不依赖桌面程序：没有桌面程序时，小天地照样运转，QQ 等机器人也照样能读写。

## 功能

- **房间感知**：`room_world` 工具读取桌面小屋回报的真实动作、位置和时段，可以让她去看书、吃饭、睡觉等。房间离线超过 30 秒时，如实报告「无法确认」。
- **小天地**：
  - 内容：12 种作物、7 种花、8 种鱼，货币是贝壳；
  - 规则：作物分三段，每段都要浇水；成熟有采收窗口；鱼咬钩后要在窗口内收竿；
  - 大小：果实和鱼都有大小和等级，可以靠照料、施肥、育种、鱼饵去冲更大的；
  - 经济：每日行情、每日委托、商店分级、扩地、鱼缸，图鉴永久保存纪录；
  - 详见 [docs/2026-11-05-xiaotiandi-loop-plan.md](docs/2026-11-05-xiaotiandi-loop-plan.md)。
- **她自己经营**：她读「小屋简报」，调用 DSH 默认模型定下打算（默认每天最多 4 次）。执行器每 15 秒照着打算或勤快规则做一件事，不调用模型。
- **田园小摊和镇上集市**：
  - 田园小摊：不用出门就能卖收成，但价格只有八成；
  - 镇上集市：买种子、扩地、交委托、全价卖东西都在这里。她需要时会自己出门去集市（最多半小时），办完就回来，这段时间小天地的活先放着；
  - 集市也可以纯逛。
- **出门**：她可以出门走走（默认 2 小时，最长 12 小时），去处有集市、小镇、海边、花海、夜市。出门期间她不在房间，也不在小天地，小天地的活先放着，到点自己回来。主人可以让她出门，也可以随时叫她回来。
- **主人只能引导**：本机接口只允许查看、看商店、看图鉴、留心愿、请她重新规划、让她出门、叫她回来。QQ 私聊里说到小天地的话，会自动记成心愿。
- **机器人适配器**：
  - `standalone`：自带人格；
  - 自定义适配器：接入你自己的 QQ 等聊天机器人，读取它的人格、记忆、心境和主人私聊（见下文「接入其他机器人」）；
  - 也可以通过 `registerAdapter` 接入其他机器人。
- **QQ 上下文**：接入机器人后，通过 DSH 的 `agent/pre-step` 钩子，只在主人私聊会话里补入房间事实和小屋简报。

## 安装

### 准备

- Windows 上已安装并打开过一次 **DSH**（DeepSeek Harness），并且在 DSH 设置里选好了**默认模型**。聊天和她的规划都用这个模型。
- 已安装 **Node.js 22** 或更新版本。在命令行输入 `node -v` 能看到版本号即可。
- 可选：一个运行在 DSH 里的 QQ 等聊天机器人。不接也能用，插件会用自带的大肥鱼人格。

### 第一步：下载插件

任选一种：

- 用 git：

  ```bash
  git clone https://github.com/amimi-wenke/dsh-room-world.git
  ```

- 不会用 git：在本仓库页面点 **Code → Download ZIP**，解压到一个**固定的位置**，比如 `D:\dsh-plugins\dsh-room-world`。插件是以链接方式装进 DSH 的，装好后不要移动或删除这个文件夹。

### 第二步：装进 DSH

**方式一：安装脚本（推荐）**

在插件文件夹里打开命令行，运行：

```bash
node scripts/install-plugin.mjs desktop
```

- `desktop` 是 DSH 的 profile 名，大多数人就是这个。不确定的话，看 `%USERPROFILE%\.dsh\profiles\` 下面的文件夹名。
- 脚本默认在插件所在盘的 `\DSH\DeepSeek Harness.exe` 找 DSH。装在别处的话，先设置环境变量再运行：

  ```bash
  set DSH_DESKTOP_EXE=C:\你的路径\DeepSeek Harness.exe
  node scripts/install-plugin.mjs desktop
  ```

- 脚本默认把插件配置为独立模式（`adapter: standalone`）。要接自己的机器人，按下文「接入其他机器人」写一个适配器，再在「配置」里把 `adapter` 改成它的名字。如果你的机器人限制了 QQ 会话能用的工具，记得把 `room_world` 加进它的白名单。
- 脚本修改 DSH 配置前会备份到 `%USERPROFILE%\.dsh\room-world\install-backups\`；安装过程离线，不运行任何依赖脚本。

**方式二：DSH 插件管理**

在 [Releases](https://github.com/amimi-wenke/dsh-room-world/releases) 下载 `dsh-room-world-<版本>.tgz`，或者直接用插件文件夹，在 DSH 的插件管理里添加它，然后启用 bundle。用这种方式装时默认是 `adapter: standalone`。

### 第三步：重启 DSH 并确认装好

1. 完全退出 DSH，再重新打开。
2. 在 DSH 的插件列表里能看到「大肥鱼 · 房间与小天地」。
3. 文件 `%USERPROFILE%\.dsh\room-world\host.json` 已经生成，说明插件已经在运行。
4. 打开桌面小屋 [dafeiyu-room](https://github.com/amimi-wenke/dafeiyu-room)，点「连接 DSH」，再打开「小天地」，就能看到她开始经营了。

### 更新插件

- 用 git 装的：在插件文件夹里运行 `git pull`，然后重启 DSH。
- 用 zip 装的：下载新版，覆盖原文件夹里的文件，然后重启 DSH。

小天地存档会自动升级，升级前的旧存档会备份成 `world.json.v1-backup.json`。

### 配置

在 DSH profile 的 `cordis.patch.yml` 里修改，路径是 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`。bundle 会自己插入插件行，只需要写这一段覆盖配置，不要重复 insert：

```yaml
- id: dsh-room-world
  config:
    adapter: standalone          # 或你注册的适配器名
    qqContext: true              # 在主人 QQ 私聊里补入房间事实和小屋简报
    planner:
      enabled: true              # 她自己定打算（调用 DSH 默认模型）
      maxPerDay: 4               # 每天最多规划几次，0~12
```

`standalone` 模式可以加一个 `persona` 字段，自定义人格。改完要重启 DSH。

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

世界动作：`observe,visit,plant,water,harvest,fertilize,cast,collect,shop,buy,sell,deliver,cook,brew,craft,keep,release,decorate,codex,plan,auto,outing,recall`（`outing` 可带 `hours`。`buy`、`deliver` 和 `sell {at:"market"}` 会自动开始一趟去集市的短途出门，在集市里可以连续买卖，没事可做时她自己回来；不在外面时，普通的 `sell` 在田园小摊卖，价格八成。`outing` 可带 `place`（`market`/`town`/`seaside`/`flower-sea`/`night-market`），只有在集市才能买卖。出门期间除了查看、规划、买卖和 `visit`/`recall` 回来，其他动作都返回 `OUTING_AWAY`）；区域 `room,farm,garden,pond`；地块编号从 0 开始（可扩建到 8 块）。物种、价格、生长时间见 `lib/species.js`；作物分三段，每段都要浇水；鱼咬钩后 10 分钟内要收竿。完整规则和自主规划见 [小天地方案](docs/2026-11-05-xiaotiandi-loop-plan.md)。工具返回简短结果加「小屋简报」(`brief`)，不再返回整份世界 JSON。

主人在 QQ 私聊里说到小天地的话（提到种地、钓鱼、买卖、物种名等，且不是「去吃白米饭」这类房间短指令），会在 10 分钟内自动记成心愿，即使 QQ 回合里她没有调用工具，这些引导也会进入她的下一次规划。工具输出统一转成无损 JSON（DSH 会拒绝含 `undefined` 的输出）；`status/look/check` 按 observe 处理，发给 world 的房间动作（如 walk）会转给房间。

主人通过本机接口只能 `observe/shop/codex/wish/replan/outing/recall`，其他世界动作返回 `OWNER_GUIDANCE_ONLY`；所有经营都由她（执行器或她的 `room_world` 调用）完成。

配置 `planner: { enabled: true, maxPerDay: 4 }` 控制她自己定打算时调用 DSH 默认模型的次数；关闭后只按勤快规则自主游玩。

回家用 `{target:"room",action:"home"}` 或 `{target:"world",action:"visit",area:"room"}`。兼容 `go_home/return_home/back_home` 回家，以及 `world` 下 `move/go_to` 前往指定 area。回家会同步世界区域，她会在家歇 30 分钟再自己继续，避免刚回来又被自动任务带出门。`observe` 不移动角色。无法识别的动作返回具体纠正提示。

QQ 的「去吃白米饭」「去看书」「回家」「关灯」等明确短指令自动执行；疑问、否定和转述不按命令处理。复杂意图与世界游玩由 QQ 模型调用工具。

接入机器人后，每次主人 QQ 会话进入模型步骤时，独立插件通过 DSH `agent/pre-step` 自动补入当前房间事实、小屋简报和少量带来源的最近桌面对话。回答「房间接通了吗」「你在做什么」无需等模型自行选择工具。状态只进入适配器确认的主人私聊（适配器需实现 `matchesSession(agent)`），不进入其他 DSH 会话或群聊，也不改写原人格和长期记忆。`qqContext: false` 可关闭自动补入；工具仍可手动读取事实。

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

接口包括 GET `/status,/history,/room/events,/commands,/world,/qq-context`，POST `/chat,/room/state,/world`。`/status.qqContext` 报告监听注册状态、最近一次实际 QQ 注入时间与错误；`/qq-context` 只读干跑同一挂接路径，不向 QQ 发消息，也不把干跑计为实际注入。HTTP 请求头使用 `x-pet-token`（只用于本机接口）。30 秒过期检测仅代表 UI 在线事实；世界存档可继续生长。

存档按角色哈希隔离在 `~/.dsh/room-world/characters/` 与 `pet/room-link/`。切换人格时取消尚未完成的旧人格模型回复。API 模型调用有 180 秒超时，桌面重试使用稳定 requestId 防止重复写入。

## 许可

代码使用 MIT 许可。插件里的「大肥鱼」角色设定（DeepSeek 鲸鱼娘）来自社区开源资产库 [deepseek-whale-girl](https://github.com/TreapGoGo/deepseek-whale-girl)。本仓库不包含任何立绘图片；桌面程序 dafeiyu-room 里的美术资源以 CC BY-NC-SA 4.0 单独授权。
