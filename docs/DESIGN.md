# 设计与维护

## 边界

外部音乐读取属于 World。`src/index.ts` 默认导出 `WorldDefinition`，`cortico.kind=world`、`api=6`，默认不启用。运行时只导入公开的 `cortico/world.ts` 与类型，Cortico 作为开发依赖而非重复打包的运行依赖；正式宿主负责解析其框架模块。

情绪、记忆、人格由现有 Cormini 管理。本 World 只保留两类有界本地记录：听歌记忆（默认 100 首、30 位歌手，可调至 500/100）与用户明确表达的偏好画像（最多 50 条），分别存放在插件独立文件中，可单独清除，不写入 Cormini 的 Persona 或 Memory。进程内的最近 20 条曲目仍是观察缓存。

## 接口

| 名称 | 用途 |
| --- | --- |
| `netease-music.comment_opportunity` | 曲目稳定、非明确暂停、冷却结束后推送曲目和评论；external、snapshot、piggyback |
| `netease-music.comment_requested` | 可信内部机制提示，要求检查曲目并调用 pet_say；internal、snapshot、debounce；不包含任何外部曲目或评论原文 |
| `music_now_playing` | 当前曲目、观测时间、过期标志、评论开关、用户画像与听歌记忆摘要 |
| `music_recent_tracks` | 当前进程内最近 20 条曲目观测，不声称完整播放 |
| `music_listening_memory` | 本机听歌记忆：常听歌手、最常播放与最近曲目，以及当前曲目/歌手关联 |
| `music_song_comments` | 当前歌曲评论区参考；包含歌名歌手匹配、发行版本不确定性和来源链接 |
| `music_artist_context` | 当前歌手简介、别名、代表作品、专辑与第三方背景摘录 |
| `music_set_commentary` | 通过 `WorldContext.persist` 保存评论开关 |
| `music_comment_preference` | 记录用户明确表达的评论口味与主动互动频率 |

事件包含 JSON 曲目信息，来自外部的不可信数据按 external 投递；评论行为指导写入可编辑的 ENV_PROMPT.md。事件不代表已发言，也不强制 persona 发言。队列等待时可能已切换曲目，因此提示词要求先调用当前状态工具确认，再决定是否在已有桌宠渠道输出。

0.2.0 在事件发送前通过 music.163.com 的 `/api/search/get` 和 `/api/v1/resource/comments/R_SO_4_<id>` 获取评论参考。该接口不是正式稳定的开放 API。只请求第一页，保留配置条数（默认 10，范围 3–20；热门约六成，其余为最新）的短摘录，不收集用户身份字段。正缓存 30 分钟，负缓存 5 分钟，容量 40；单次请求超时 8 秒，正文限制 1 MB，卸载取消请求。获取期间重新检查曲目、暂停、设置与实例代次，避免把上一首的评论发给下一首。没有歌曲 ID 时不能核实发行版本，在结果和人格指导中明确告知。

0.4.0 把匹配从精确字符串扩展为：窗口标题正反顺序解析、歌手括号别名与合作歌手分隔、括号版本后缀的基础歌名比较、专辑软排序、搜索结果 50 条及失败后的基础歌名重试。专辑不一致不再直接判为无匹配，而是返回并标为版本未核实。评论条数成为热更新配置；缓存键包含条数，避免改设置后读到旧条数。

新增 `commentReference` 默认 true；老部署缺少此字段时也按启用处理，可在配置页关闭；`commentExcerpts` 缺省按 10 条处理。网络请求不使用桌宠或网易云的账号凭据。验证时直连网易云取得歌曲匹配与默认 10 条评论摘录，不读取评论者资料。

1.17.0 记忆位置、口味档案与接力点歌（借鉴 MIT 许可的 `coopani-world-music` 0.3.8 / 0.4.0）。新增 `src/storage.ts`：`resolveLayout()` 把配置里的 `memoryDir` 翻译成可用目录，写探针（建目录 + 写 `.write-test-<pid>` 再删）比 `accessSync` 更能识别网盘与移动硬盘的真实状态；配置为空、等于本机目录或探测失败都退回本机，失败原因写进 `problem`。`writeTextWithFallback()` 只写当前目录，失败时当次回落本机并记下 `lastWriteFallback()`；`readDirs()` / `readJsonVariants()` 让各存储合并读取两处。`listening.json` 按日期逐项相加（曲目、歌手、时段、客户端），`notes.json` / `tags.json` 同一首取更新的 `updatedAt`，`preferences.json` 按口味去重、画像取更晚的一份；`taste.json` 是派生快照，当前目录优先、缺失才读本机。各存储构造参数放宽为 `DirRef`（字符串或取值函数），`useLocal()` 指定合并来源，因此换目录热生效且旧记录仍读得到。新增 `src/soul.ts`：记忆目录根部的 `music-soul.md`，四节第一人称 Markdown，`parseSoul`/`renderSoul` 只认 `## 标题` 与 `- 条目`，`music_soul` 工具只做 read/add/drop，`promptText()` 整篇进入 `music.soul` 环境变量；`prune()` 只扫 `listening.json`，碰不到它。新增 `src/wants.ts`：`music_pick` 成功后把曲目写入想听清单（`wants.json`），`music_pick` 不带 query 列出清单、带 `from` 直接认领；`matchesWant()` 以歌名完全匹配 + 歌手按分隔符任一对上为准，同名翻唱不算。`tick()` 在状态提示前先判 `relayOpportunity()`：剩余 ≤35 秒、当前曲目是她递出的那首、该首未提醒过、链未满 6 时推 `netease-music.relay_pick`（内部提示带上候选 id），`playedAt` 只在她那首真被播到时写入，没播的棒不占名额。新增配置 `memoryDir`、`soulEnabled`、`relayPick` 与「记录与位置」分组；WebUI 设置页对 `memoryDir` 增加 `ctx.pickPath` 目录选择器，「数据一览」显示当前记忆位置、自定义/本机、失败原因与回落记录，并新增「口味档案」「想听清单」两行。

一次性迁移（1.17.0 同日补充）：`migrationPlan()` 逐个对比本机与新目录的记忆文件——新目录没有就 `copy`，两边大小相同视为 `same`，大小不同视为 `conflict` 不覆盖；`migrateMemory()` 只复制 `copy` 项，全部成功且无冲突后写 `memory-migrated.json`（记录来源目录），之后 `World.mergeLocal()` 对这台机器返回空字符串，存储层因此只读新目录，避免刚复制完又被合并成两倍；`ensureMigration()` 在 `start()` 与设置保存 `memoryDir` 后各触发一次，手动入口是「数据一览」的迁移按钮，迁移后 `resetStoreCaches()` 丢掉旧的合并缓存。冲突或复制失败时不写标记，退回原来的合并读取，并在数据一览里说明。

1.16.0 个人画像与陪听控制升级。`ListeningMemoryStore` 新增 `month()`/`day()`/`playerStats()`：月历只返回该自然月有记录的日期，点击日期读取当天 `tracks`/`artists`/`hours`/`players`；`HistoryTrack` 增加可选 `players`，`recordDay` 按客户端累计每首歌的来源，旧记录没有该字段时不参与拆分。`profileSnapshot()` 增加 `playerBreakdown`，`profile-analysis` 新增 `calendar`（参数 `YYYY-MM`）与 `day`（参数 `YYYY-MM-DD`）方法；WebUI 的每日播放改为月历，带上一月/下一月/本月、日期点击明细、JSON/CSV 导出与「播放器拆分」表。配置新增 `quietHours`/`quietStart`/`quietEnd`（跨零点安静时段）与 `actionCooldownSeconds`（动作建议最短间隔），`tick()` 在安静时段直接跳过自动评论，`style` 只在冷却结束后生成；`live-status` 增加下一段预览与安静状态。`NeteaseComments.preferredLabels()` 对除网易云外的播放器都先用 QQ 公开搜索补标签；Spotify 歌词先查 LRCLIB，`lrclibLyrics()` 增加专辑与时长参数/评分以挑选同名版本。

1.15.3 个人画像的可视化与占比口径。`buildTaste()` 为播放器与曲风分别维护分母：播放器只累计非 `unknown` 的日记录客户端，`playerPlays` 作为占比分母；曲风只在曲目有 `genreMap` 条目时累计一次 `genrePlays`，每个曲风仍按播放次数计数，因此多标签曲风会重复计入但分母只算一次播放。这样更新前只有累计排名、没有客户端或曲风信息的播放不会把比例稀释成 1%。WebUI 的「每日播放」改为日历热力图：`profileSnapshot()` 返回窗口内最近 `calendarDays` 天（7/30/90，「全部」按最早记录到今天，最多 365 天），并新增 `calendarDays` 字段；客户端用 7 行 × N 周的 CSS grid 生成日期格子、月份标签、星期标签与少→多图例，空格表示没有播放，悬停显示日期和次数。时段柱状图改为固定 160px 容器、柱区 flex:1、标签固定 14px，并在柱区底部画基线，保证 24 根柱子底边对齐。测试补充播放器 unknown 排除与曲风分母。

1.15.2 修复语音与无时间轴链路。`MusicWorld.voiceHint()` 统一追加到开场、分段与播放器状态内部提示，并在 `music_now_playing.nextAction` 与 `ENV_PROMPT.md` 中明确：若启用 gpt-sovits 等语音 World，必须在同一回复的 pet_say 之后调用 `sovits_speak`，否则只有气泡没有声音。`remember()` 与 `segmentClock()` 只在 `track.timeline !== false` 且 `positionSeconds` 存在时使用 SMTC 位置，避免网易云桌面版恒为 0 的位置每次采样把分段时钟重置；无时间轴时按墙上时间累计，单次最多 5 秒。新增 `sectionFor()`：段落优先用播放位置，缺失时用已播放时间与 `durationSeconds`/在线补齐的 `durationMs` 估算，副歌仍可生成 `style` 动作建议；提示词要求把 `style.actions` 写进 pet_say。`profileSnapshot()` 与 `music_taste` 始终把累计排名传给 `buildTaste`，`taste.ts` 新增 `mixed`：逐日记录与累计排名按曲目/歌手差值合并，`earlierPlays` 标明更新前记录，时段/每日/播放器仍只来自逐日数据。`live-status` 新增分段与动作两行，直接展示配置次数与形象动作数。测试覆盖无时间轴分段时钟、副歌 section/style、语音提示与画像合并。

1.15.1 修复 PowerShell 侧的播放器清单解析：Windows PowerShell 5.1 的 `ConvertFrom-Json` 不会枚举顶层 JSON 数组，`@($json | ConvertFrom-Json)` 得到的是单个 `Object[]`，`[string]$player.id` 会拼成 `netease qq kugou kuwo spotify`，使 `TrackSelector` 丢弃全部候选。新增 `scripts/players.ps1` 的 `Read-PlayerList` 显式展开数组，`media-session.ps1`（环境变量 `MUSIC_PLAYER_ORDER`）与 `control.ps1`（`-Priority`）共同使用。`ReaderDiagnostics` 新增 `invalidPlayers`，读取诊断页会列出候选里不在官方清单中的 id，避免同类字段问题再次静默无曲目；`tests/players.test.ts` 直接调用 PowerShell 验证解析结果。

1.15.0 把会话选择从 PowerShell 移到 `src/selection.ts` 的 `TrackSelector`。`scripts/media-session.ps1` 只读取并上报全部官方播放器 SMTC 会话与窗口候选（`sessions` / `windowCandidates`），字段含 app、player、status、曲目、歌手、专辑与 timeline；`src/state.ts` 的 `parseCandidates` 负责校验，`WindowsReader` 调用选择器后输出 `Snapshot`。选择器按 `playerPriority` 排序候选，优先 Playing；当前播放器仍在播放时，高优先级播放器需连续出现 2 次（约 4 秒）才切换，当前播放器暂停或消失时立即切换；同一播放器多个会话时保持已选中的应用，窗口标题来源同样有粘性。`Reader.diagnostics()` 暴露最近候选、选择结果、粘性与待切换状态；`MusicWorld.readerDiagnostics()` 合并优先级、当前曲目与错误，WebUI 新增 `reader-diagnostics` 面板（只读诊断 + `restart` 单独重启读取器）。`scripts/control.ps1` 新增 `-Player` / `-Session` / `-Priority`：优先控制当前曲目所属播放器，当前播放器没有可控制会话时明确失败，不再误操作其他播放器。`NeteaseComments.find()` 对 QQ 播放器先用 `searchQQ` 补充曲目标签，再按原曲目标签与补充标签检索网易云；Spotify、酷狗、酷我没有公开评论/百科来源，保持网易云回退。设置页优先级列表支持原生拖动排序；连接检查用 `currentPlayer` 标出正在读取的播放器。新增 `.github/workflows/ci.yml` 与 `release.yml`：推送/PR 跑类型检查、测试与配置检查；`v*` 标签校验版本后发布 npm 并创建 GitHub Release。

1.14.0 新增官方播放器清单 `PLAYERS`（`src/config.ts`）：网易云音乐、QQ 音乐、酷狗音乐、酷我音乐、Spotify，每项声明 SMTC 应用名正则、窗口进程正则、是否有时间轴与降级说明。配置以 `playerPriority` 有序数组替代 `sessionPattern` / `windowFallbackProcess`；`playerOrder` 只保留官方 id、去重并把缺失项补到末尾，`normalizeConfigPatch` 对 array 字段走同一归一化。`WindowsReader` 改为把 `MUSIC_PLAYER_ORDER` JSON（id/session/window）与 `MUSIC_WINDOW_FALLBACK` 传给 `scripts/media-session.ps1`；脚本按顺序遍历播放器，每个播放器内先找 `Playing`，全部没有播放中会话时才选优先级最高的暂停会话，窗口标题兜底也按同一顺序。SMTC 快照新增 `player` 与 `timeline`（是否读到 Position/EndTime），`Track` 与 `parseSnapshot` 保留这两个字段；`readingLabel()` 在 `timeline=false` 时显示「无进度」。WebUI 的 `settingsPayload()` 为 reader 组附带 `players` 元数据，设置页用只读列表 + 上移/下移，首末项禁用，不能增删或编辑。连接检查 `scripts/smtc-status.ps1` 扩展为五款播放器的安装表、进程与安装目录兜底；`connectionStatus()` 按 id 合并官方名称与说明，并用 `matchPlayer` 给每个 SMTC 会话标注 `player` / `supported`，面板新增「支持」列。旧配置由 `preflight` 归一化为默认顺序，旧正则不再读取。

1.13.0 新增 `src/notes.ts`（`notes.json`，单曲笔记，每首一条、120 字）、`src/tags.ts`（`tags.json`，听感标签与歌曲百科曲风缓存，最多 500 首）、`src/taste.ts`（`taste.json`，听歌口味分析快照）与 `src/playback-state.ts`（暂停/恢复/结束的状态机）。逐日历史合并进 `src/listening.ts` 的 `listening.json`（version 2，累计排名 + `days`），不按天数自动删除；首次加载会把旧 `history.json` 合并后删除。工具新增 `music_note`、`music_tag`、`music_history`、`music_taste`；事件新增 `netease-music.state_requested`，开场事件新增 `previous`（上一首已评论时）、`songNote`、`songTag`。`styleFromTag` 用已标听感覆盖副歌风格推断；`stateComments` 控制状态提示，60 秒冷却，状态提示后 15 秒内不触发普通评论。WebUI 新增 `profile-analysis` 面板，按 7/30/90/全部窗口读取 `listening.json` 并刷新 `taste.json`；子分区用 `foldSheet`（默认展开），时段分布用 CSS 柱状图并在进入页面时做高度过渡，播放器占比用 `conic-gradient` 饼图并做缩放/淡入，常听曲风同样用饼图展示前五、列表展示最多八种；`taste.json` 增加 `topGenres`，由 `tags.json` 的曲风缓存按播放次数加权。老用户只有累计排名、没有 `days` 时，`ListeningMemoryStore.cumulative()` 提供兜底：`buildTaste` 用累计曲目与歌手算总播放、常听歌手、循环曲与曲风，`scope` 标为 `cumulative`，时段、每日与播放器保持为空，等新播放写入 `days` 后自动回到窗口口径。`listening.json` 不再按天数自动清理；新增 `data-cleanup` 面板，可选 7/30/90/365 或自定义保留天数，选择时调用 `prunePreview()` 预览会删除与保留的天数、次数（不写文件），确认后 `prune()` 删除早于保留期的 `days`，按剩余日期重建 `tracks`、`artists` 与 `totalPlays`，并返回实际清理量供页面提示。清理只作用于 `listening.json`；`preferences.json`、`taste.json`、`notes.json` 与 `tags.json` 都是很小的文本，不参与清理。由于宿主的 `StoragePart` 不能改名或去掉清除按钮，`webUi()` 不再声明 `storage`，改用只读的 `data-overview` 面板：`overviewSnapshot()` 读取各 store 的 `storage()` 元数据并用 `stat` 取文件字节数，列出内容、大小与位置（含合计），不提供清除操作；面板顺序为 `live-status`、`connection-check`、`listening-ranking`、`profile-analysis`、`data-overview`、`data-cleanup`、`settings`。

1.12.0 新增 `src/action-vocab.ts`：从宿主 `data/home/companion/config.json` 读取当前形象，再读 `resources/app/node_modules/cortico-world-desktop-pet/web/<figure>/figure.json`，只取中文表情/动作名，过滤 `sleep` 与 `sleepy`；`envPromptVars` 增加 `music.actionVocab`、`music.actionHints`、`music.segmentCount`、`music.controlAllowed`，提示词要求用 `pet_say` 的【表情, 动作】写法。新增 `src/focus.ts`：按开场/分段轮换 `commentFocus`，只选本首未用过且数据可用的角度，数据不足时给 `variation`。新增 `src/style.ts`：从歌曲百科 genres/tags/BPM 粗分偏燃/偏柔/年代感/偏怪/中性，按形象动作词表过滤后作为副歌 `style.actions`。新增 `src/phase.ts`：按播放比例估 `intro/verse/chorus/bridge/outro`，超过 360 秒只给开头/前半段/中段/后半段/收尾段，事件字段为 `section`。`briefLyrics` 增加 `windowed` 参数，分段事件取当前播放位置附近的歌词窗口。`segmentPoints` 支持 `segmentCount` 1–4；有 SMTC 位置时按比例，无位置时按 `segmentEverySeconds` 与已播放时间分段。新增 `src/control.ts` 与 `scripts/control.ps1`，通过 SMTC 的 `TryPauseAsync/TryPlayAsync/TrySkipNextAsync/TrySkipPreviousAsync` 执行 `music_control`，默认关闭。新增 `src/picker.ts` 与 `music_pick`：搜索网易云/QQ 音乐并返回链接，明确不能自动点播。

1.11.0 借鉴 MIT 许可的 `Sakayume02/cortico-world-music`，在元数据架构内增加四项交互：LRCLIB 同步歌词兜底（`NeteaseComments.lrclibLyrics`，仅接受 syncedLyrics，结果标未核实版本）；同曲分段（`segmentPoints` 取 50%/80%，需要 SMTC 位置与时长，仍然受 `cooldownSeconds` 与安静开关约束）；切歌报幕（`announceTracks`，默认开，由内部 cue 要求先报歌名/歌手）；动作/表情提示（仅提示词，使用当前形象已有动作）。`ListeningState` 新增 `hasOffered` / `canOffer` 供同曲分段判断，事件附带 `phase` 与 `segment`。仍不采集音频、不需要额外 Key；归属见 `THIRD_PARTY_NOTICES.md`。

1.10.0 市场简介与安装说明补充 SMTC 前提，并新增「连接检查」面板。`scripts/smtc-status.ps1` 通过 WinRT 读取全部 SMTC 会话，并查询卸载表与进程名判断网易云/QQ 音乐是否安装、运行；World 的 `connectionStatus()` 用一次 PowerShell 调用返回 `apps`、`sessions` 与错误信息，面板按软件展示状态、开启路径和「重新检测」。该面板只读本机信息，不写入第三方配置，也不上传检测结果。

1.9.1 市场简介改为功能优先：先说明读取网易云与 QQ 音乐曲目、桌宠参考评论区/歌曲百科/歌手资料/官方歌词陪听，再说明听歌记忆与听歌排名；功能与 1.9.0 相同。

1.9.0 显示名改为「听搭子」：World 标签、市场显示名、设置面板与提示词标题同步更新，「一起听排名」面板和配置项改名为「听歌排名」。World ID `netease-music`、配置路径和 npm 包名保持不变，旧部署无需迁移。

1.8.0 移除标准配置页，配置入口统一到 World 页的「设置」面板，避免同一套字段出现两份表单。`settingsPayload()` 仍从 `configGroups` 读取分组、范围和当前值；面板保存改为 `ctx.invoke('save')`，由 `normalizeConfigPatch` 按同一份声明校验类型、数值范围与正则，再调用 World 的 `persist` 写入 `config.json` 并更新活配置。媒体读取三项标为 `x-hot=false`，修改后重启 World 生效。

1.7.0 曾把配置按用途拆成五个 `ConfigGroup`（陪听与评论、联网背景资料、歌词、一起听排名、媒体读取），并在 World 页增加「设置」面板；1.8.0 起标准配置页已移除。

1.6.0 新增歌词通道：新增 `src/lyrics.ts` 解析 LRC 时间标签、过滤制作名单、按 ±0.35 秒合并官方翻译，并提供当前行定位与摘要裁剪。`NeteaseComments.lyrics()` 复用歌曲匹配和节流；陪听事件只带前 N 行与当前行，完整歌词由 `music_lyrics` 按需读取（最多 200 行）。歌词不写入磁盘，读取失败不影响评论与听歌记忆。

1.5.0 增加单曲循环计数：有播放位置时按位置回绕计次；没有位置时读取曲目时长并按连续播放时间累计。暂停不计时，窗口标题降级不计数；手动拖动可能影响估算。

1.4.0 默认 SMTC 匹配加入 QQ 音乐，窗口标题降级的进程名改为可配置正则；QQ 音乐需在客户端开启 SMTC。曲目识别、听歌记忆与排名可直接使用，评论、百科和歌手资料仍通过网易云搜索，主流歌曲通常可匹配，独家内容可能降级。

1.3.0 新增本机听歌记忆与「一起听排名」：曲目连续稳定 10 秒后写入 `listening.json`，按歌名/歌手/专辑聚合出现次数，并单独聚合歌手；默认收录上限 100 首、30 位歌手，可热更新为 10–500 首、5–100 位；榜单显示范围可单独设为前 1–500 首、前 1–100 位，不影响收录上限。超过上限时从旧记录中淘汰「歌曲播放次数 + 歌手出现次数」最低的一首，同分随机，刚播放的这首先保留；歌手同理。事件与 `music_now_playing` 只带紧凑摘要和当前曲目/歌手关联，完整排名由面板与 `music_listening_memory` 按需读取。它是行为计数，不是评分、完整播放历史或用户情绪。

## 生命周期与故障

start 启动隐藏的 Windows PowerShell 读取进程和节流时钟；stop 清除时钟、重试任务并终止读取进程。generation 阻止停止后的旧回调污染新实例。进程异常退出后等待 10 秒重连；状态超过 10 秒无更新不再提供评论机会。进程崩溃会清除当前曲目并显示读取错误。

SMTC 单次调用有 5 秒等待上限，失败时可降级。只读取官方播放器清单内的媒体会话，不把浏览器、其他播放器的当前歌曲误当成目标播放器。会话与窗口降级进程都由 `playerPriority` 派生的官方清单决定，按顺序优先选择正在播放的播放器；窗口降级只能取「歌名 - 歌手」式标题，且播放状态不确定。酷狗通常没有播放位置与时长，酷我常退回窗口标题，二者在快照中标记 `timeline=false`。

## 发布

1. 保留稳定包名和 World ID；先在 npm 检查名字是否可用，必要时首次发布前改为自己的 scope，不能冒用官方身份。
2. 小版本新增配置时补默认值；更改已有配置语义时明确迁移。破坏性变更提高 major 版本，并遵循新宿主的契约迁移说明。
3. 更新 CHANGELOG.md 对应版本段；添加真实 repository、bugs 和作者字段。
4. 运行 README 的验证命令，检查 `npm pack --dry-run` 的文件列表，只包含必要源码、读取脚本和文档。
5. 在已登录的 npm 账号下由维护者运行 `npm publish`（需要 2FA），并推送对应 Git tag；发布后申请官方索引同步。
6. `cortico-world` keyword 用于宿主市场发现。官方索引提交规则见 https://github.com/Pal-AI-Lab/cortico-extensions ，在实际发布后申请收录。
7. 安装 npm 版本后使用宿主自己的更新、版本回退与兼容检查；不要添加自行下载执行代码的更新器。

## 验证记录（2026-10-22）

0.2.2 实机排查发现此前音乐事件已成功投递，模型却只调用 end_turn。补充内部机制请求、明确 pet_say 输出步骤以及当前曲目工具回执的下一步指导后，本机 15:41:29 实际调用 pet_say，回执「已开始显示，这段约 8 秒」，完成读取、评论参考、模型动作和气泡显示的端到端验证。此为一次成功验证，模型行为仍可能因当前对话和用户安静设置而变化。

- Node 24.14.1 / Windows，本机网易云窗口标题读取成功；SMTC 未得到匹配曲目，实际走 window-title 降级。
- Cortico 0.2.5 的 API 6 manifest、dry-mount、自描述一致性验证通过。
- 自动测试覆盖快切合并、去重、冷却、暂停恢复、静音、陈旧信息、历史上限、字段校验、外部事件、配置保存及卸载后的旧回调。
- 首版未完成气泡联调，后续 0.2.2 已验证实际 pet_say 展示（见本节开头）。SMTC 播放/暂停通道未做真实播放器联调，当前为状态机测试。
