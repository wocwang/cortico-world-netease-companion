# 第三方代码与许可

本项目的部分实现参考或改编自以下 MIT 许可项目。

## Sakayume02/cortico-world-music

- 仓库：https://github.com/Sakayume02/cortico-world-music
- 用途：LRCLIB 同步歌词查询与歌名/歌手匹配思路；换歌报幕、同曲分段和动作提示词的交互思路。
- 许可：MIT

Copyright (c) 2026 cortico-world-music contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## coopani-world-music（交互思路参考，未复制代码）

- 包：https://www.npmjs.com/package/coopani-world-music
- 作者：Mr.Q
- 许可：MIT（仅见发布包 `package.json` 的 `license` 字段；该 tarball 未附带 LICENSE 文件）
- 用途：动作词表探测、按播放比例分段、播放控制与搜歌的交互思路参考。
- 说明：本项目的 `scripts/control.ps1` 针对 Windows SMTC 平台接口重写；未直接复制该包的源代码。若未来复用其代码，需要先取得其完整 MIT 版权声明与许可文本。
